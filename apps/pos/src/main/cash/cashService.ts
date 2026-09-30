import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  CashAvailability,
  CashCreditPaymentTotal,
  CashOverview,
  CashPaymentTotal,
  CashSession,
  CloseCashSessionInput,
  OpenCashSessionInput,
  PaymentMethod
} from "@mercado-pos/contracts";
import { MAX_SQLITE_INTEGER, parseCopInteger } from "@mercado-pos/domain";

const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "cash", "debit_card", "credit_card", "bank_transfer", "nequi", "daviplata", "bre_b"
];
const RECENT_SESSION_LIMIT = 20;

interface SessionRow {
  id: string;
  status: "open" | "closed";
  opening_cash_cop: bigint;
  opened_at: string;
  opened_by_username: string | null;
  closed_at: string | null;
  closed_by_username: string | null;
  expected_cash_cop: bigint | null;
  counted_cash_cop: bigint | null;
  variance_cash_cop: bigint | null;
  sales_count: bigint | null;
  total_sales_cop: bigint | null;
  cash_sales_cop: bigint | null;
  credit_payments_cop: bigint | null;
  cash_credit_payments_cop: bigint | null;
}

interface PaymentRow {
  id: string;
  total_cop: bigint;
  settlement_type: "paid" | "on_account";
  method_id: PaymentMethod | null;
  amount_paid_cop: bigint | null;
  change_cop: bigint | null;
}

interface MethodTotal {
  amountCop: bigint;
  salesCount: number;
}

interface CreditPaymentRow {
  amount_cop: bigint;
  method_id: PaymentMethod;
}

interface SessionTotals {
  salesCount: number;
  totalSalesCop: bigint;
  cashSalesCop: bigint;
  creditPaymentsCop: bigint;
  cashCreditPaymentsCop: bigint;
  expectedCashCop: bigint;
  paymentTotals: CashPaymentTotal[];
  creditPaymentTotals: CashCreditPaymentTotal[];
}

export class CashService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  availability(): CashAvailability {
    const row = this.database.prepare(`
      SELECT cs.opened_at, u.username AS opened_by_username
      FROM cash_sessions cs
      JOIN pos_users u ON u.id = cs.opened_by_user_id
      WHERE cs.status = 'open'
    `).get() as { opened_at: string; opened_by_username: string } | undefined;
    return row
      ? { isOpen: true, openedAt: row.opened_at, openedByUsername: row.opened_by_username }
      : { isOpen: false, openedAt: null, openedByUsername: null };
  }

  overview(): CashOverview {
    return this.database.transaction(() => {
      const activeRow = this.getSessionRow("open");
      const activeSession = activeRow
        ? this.toOpenSummary(activeRow, this.calculateTotals(activeRow.id, activeRow.opening_cash_cop))
        : null;
      const recentRows = this.database.prepare(`
        ${this.sessionSelect()}
        WHERE cs.status = 'closed'
        ORDER BY cs.closed_at DESC, cs.rowid DESC
        LIMIT ?
      `).all(RECENT_SESSION_LIMIT) as SessionRow[];
      return {
        activeSession,
        recentSessions: recentRows.map((row) => this.toClosedSummary(row))
      };
    }).deferred();
  }

  openSession(input: OpenCashSessionInput, actorUserId: string): CashSession {
    const openingCashCop = parseCopInteger(input.openingCashCop);
    const open = this.database.transaction(() => {
      if (this.getSessionRow("open")) {
        throw new Error("Ya hay un turno de caja abierto. Ciérralo antes de iniciar otro.");
      }
      const id = randomUUID();
      const openedAt = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO cash_sessions (id, status, opening_cash_cop, opened_at, opened_by_user_id)
        VALUES (?, 'open', ?, ?, ?)
      `).run(id, openingCashCop, openedAt, actorUserId);
      const row = this.getSessionRowById(id)!;
      return this.toOpenSummary(row, this.calculateTotals(id, openingCashCop));
    });
    return open.immediate();
  }

  closeSession(input: CloseCashSessionInput, actorUserId: string): CashSession {
    const countedCashCop = parseCopInteger(input.countedCashCop);
    const close = this.database.transaction(() => {
      const row = this.getSessionRow("open");
      if (!row) throw new Error("No hay un turno de caja abierto para cerrar.");

      const totals = this.calculateTotals(row.id, row.opening_cash_cop);
      const varianceCashCop = countedCashCop - totals.expectedCashCop;
      const closedAt = new Date().toISOString();
      const result = this.database.prepare(`
        UPDATE cash_sessions
        SET status = 'closed', closed_at = ?, closed_by_user_id = ?,
            expected_cash_cop = ?, counted_cash_cop = ?, variance_cash_cop = ?,
            sales_count = ?, total_sales_cop = ?, cash_sales_cop = ?,
            credit_payments_cop = ?, cash_credit_payments_cop = ?
        WHERE id = ? AND status = 'open'
      `).run(
        closedAt, actorUserId, totals.expectedCashCop, countedCashCop, varianceCashCop,
        BigInt(totals.salesCount), totals.totalSalesCop, totals.cashSalesCop,
        BigInt(totals.creditPaymentsCop), BigInt(totals.cashCreditPaymentsCop), row.id
      );
      if (result.changes !== 1) throw new Error("El turno de caja cambió mientras se intentaba cerrar.");

      const insertPaymentTotal = this.database.prepare(`
        INSERT INTO cash_session_payment_totals (cash_session_id, method_id, total_cop, sales_count)
        VALUES (?, ?, ?, ?)
      `);
      for (const total of totals.paymentTotals) {
        insertPaymentTotal.run(row.id, total.method, BigInt(total.amountCop), BigInt(total.salesCount));
      }

      const insertCreditTotal = this.database.prepare(`
        INSERT INTO cash_session_credit_payment_totals (cash_session_id, method_id, total_cop, payments_count)
        VALUES (?, ?, ?, ?)
      `);
      for (const total of totals.creditPaymentTotals) {
        insertCreditTotal.run(row.id, total.method, BigInt(total.amountCop), BigInt(total.paymentsCount));
      }

      return this.toClosedSummary(this.getSessionRowById(row.id)!);
    });
    return close.immediate();
  }

  private calculateTotals(sessionId: string, openingCashCop: bigint): SessionTotals {
    const rows = this.database.prepare(`
      SELECT s.id, s.total_cop, s.settlement_type, p.method_id, p.amount_paid_cop, p.change_cop
      FROM sales s
      LEFT JOIN sale_payments p ON p.sale_id = s.id
      WHERE s.cash_session_id = ?
      ORDER BY s.created_at, s.rowid
    `).all(sessionId) as PaymentRow[];

    let totalSalesCop = 0n;
    let cashSalesCop = 0n;
    const methods = new Map<PaymentMethod, MethodTotal>();
    for (const row of rows) {
      if (!row.method_id || row.amount_paid_cop === null || row.change_cop === null ||
          !PAYMENT_METHODS.includes(row.method_id)) {
        const charge = row.settlement_type === "on_account"
          ? this.database.prepare(`
            SELECT amount_cop FROM client_credit_entries
            WHERE sale_id = ? AND entry_type = 'sale_charge'
          `).get(row.id) as { amount_cop: bigint } | undefined
          : undefined;
        if (!charge || charge.amount_cop !== row.total_cop) {
          throw new Error("Una venta asociada a esta caja no tiene un pago o fiado válido.");
        }
        totalSalesCop = addCop(totalSalesCop, row.total_cop, "Las ventas acumuladas");
        continue;
      }
      const saleTotal = row.total_cop;
      const appliedAmount = row.amount_paid_cop - row.change_cop;
      if (appliedAmount !== saleTotal) throw new Error("El pago guardado no coincide con el total de su venta.");

      totalSalesCop = addCop(totalSalesCop, saleTotal, "Las ventas acumuladas");
      if (row.method_id === "cash") cashSalesCop = addCop(cashSalesCop, appliedAmount, "Las ventas en efectivo");
      const methodTotal = methods.get(row.method_id) ?? { amountCop: 0n, salesCount: 0 };
      methodTotal.amountCop = addCop(methodTotal.amountCop, appliedAmount, "El total por medio de pago");
      methodTotal.salesCount += 1;
      methods.set(row.method_id, methodTotal);
    }

    const creditRows = this.database.prepare(`
      SELECT amount_cop, method_id FROM client_credit_entries
      WHERE cash_session_id = ? AND entry_type = 'payment'
      ORDER BY created_at, id
    `).all(sessionId) as CreditPaymentRow[];
    let creditPaymentsCop = 0n;
    let cashCreditPaymentsCop = 0n;
    const creditMethods = new Map<PaymentMethod, MethodTotal>();
    for (const row of creditRows) {
      creditPaymentsCop = addCop(creditPaymentsCop, row.amount_cop, "Los abonos recibidos");
      if (row.method_id === "cash") {
        cashCreditPaymentsCop = addCop(cashCreditPaymentsCop, row.amount_cop, "Los abonos en efectivo");
      }
      const total = creditMethods.get(row.method_id) ?? { amountCop: 0n, salesCount: 0 };
      total.amountCop = addCop(total.amountCop, row.amount_cop, "El total de abonos por medio");
      total.salesCount += 1;
      creditMethods.set(row.method_id, total);
    }

    const expectedCashCop = addCop(addCop(openingCashCop, cashSalesCop, "El efectivo esperado"), cashCreditPaymentsCop, "El efectivo esperado");
    const paymentTotals = PAYMENT_METHODS.flatMap((method) => {
      const total = methods.get(method);
      return total ? [{ method, amountCop: total.amountCop.toString(), salesCount: total.salesCount }] : [];
    });
    const creditPaymentTotals = PAYMENT_METHODS.flatMap((method) => {
      const total = creditMethods.get(method);
      return total ? [{ method, amountCop: total.amountCop.toString(), paymentsCount: total.salesCount }] : [];
    });
    return {
      salesCount: rows.length, totalSalesCop, cashSalesCop, creditPaymentsCop,
      cashCreditPaymentsCop, expectedCashCop, paymentTotals, creditPaymentTotals
    };
  }

  private toOpenSummary(row: SessionRow, totals: SessionTotals): CashSession {
    return {
      id: row.id,
      status: "open",
      openingCashCop: row.opening_cash_cop.toString(),
      openedAt: row.opened_at,
      openedByUsername: row.opened_by_username,
      closedAt: null,
      closedByUsername: null,
      salesCount: totals.salesCount,
      totalSalesCop: totals.totalSalesCop.toString(),
      cashSalesCop: totals.cashSalesCop.toString(),
      creditPaymentsCop: totals.creditPaymentsCop.toString(),
      cashCreditPaymentsCop: totals.cashCreditPaymentsCop.toString(),
      expectedCashCop: totals.expectedCashCop.toString(),
      countedCashCop: null,
      varianceCashCop: null,
      paymentTotals: totals.paymentTotals,
      creditPaymentTotals: totals.creditPaymentTotals
    };
  }

  private toClosedSummary(row: SessionRow): CashSession {
    if (row.status !== "closed" || row.closed_at === null || row.expected_cash_cop === null ||
        row.counted_cash_cop === null || row.variance_cash_cop === null || row.sales_count === null ||
        row.total_sales_cop === null || row.cash_sales_cop === null || row.credit_payments_cop === null ||
        row.cash_credit_payments_cop === null) {
      throw new Error("El cierre guardado de la caja está incompleto.");
    }
    const paymentTotals = this.database.prepare(`
      SELECT method_id, total_cop, sales_count
      FROM cash_session_payment_totals WHERE cash_session_id = ?
      ORDER BY rowid
    `).all(row.id) as Array<{ method_id: PaymentMethod; total_cop: bigint; sales_count: bigint }>;
    const creditPaymentTotals = this.database.prepare(`
      SELECT method_id, total_cop, payments_count
      FROM cash_session_credit_payment_totals WHERE cash_session_id = ?
      ORDER BY rowid
    `).all(row.id) as Array<{ method_id: PaymentMethod; total_cop: bigint; payments_count: bigint }>;
    return {
      id: row.id,
      status: "closed",
      openingCashCop: row.opening_cash_cop.toString(),
      openedAt: row.opened_at,
      openedByUsername: row.opened_by_username,
      closedAt: row.closed_at,
      closedByUsername: row.closed_by_username,
      salesCount: Number(row.sales_count),
      totalSalesCop: row.total_sales_cop.toString(),
      cashSalesCop: row.cash_sales_cop.toString(),
      creditPaymentsCop: row.credit_payments_cop.toString(),
      cashCreditPaymentsCop: row.cash_credit_payments_cop.toString(),
      expectedCashCop: row.expected_cash_cop.toString(),
      countedCashCop: row.counted_cash_cop.toString(),
      varianceCashCop: row.variance_cash_cop.toString(),
      paymentTotals: paymentTotals.map((total) => ({
        method: total.method_id,
        amountCop: total.total_cop.toString(),
        salesCount: Number(total.sales_count)
      })),
      creditPaymentTotals: creditPaymentTotals.map((total) => ({
        method: total.method_id,
        amountCop: total.total_cop.toString(),
        paymentsCount: Number(total.payments_count)
      }))
    };
  }

  private getSessionRow(status: "open" | "closed"): SessionRow | undefined {
    return this.database.prepare(`${this.sessionSelect()} WHERE cs.status = ?`).get(status) as SessionRow | undefined;
  }

  private getSessionRowById(id: string): SessionRow | undefined {
    return this.database.prepare(`${this.sessionSelect()} WHERE cs.id = ?`).get(id) as SessionRow | undefined;
  }

  private sessionSelect(): string {
    return `
      SELECT cs.id, cs.status, cs.opening_cash_cop, cs.opened_at,
             opened.username AS opened_by_username, cs.closed_at,
             closed.username AS closed_by_username, cs.expected_cash_cop,
             cs.counted_cash_cop, cs.variance_cash_cop, cs.sales_count,
             cs.total_sales_cop, cs.cash_sales_cop, cs.credit_payments_cop,
             cs.cash_credit_payments_cop
      FROM cash_sessions cs
      JOIN pos_users opened ON opened.id = cs.opened_by_user_id
      LEFT JOIN pos_users closed ON closed.id = cs.closed_by_user_id
    `;
  }
}

function addCop(current: bigint, increment: bigint, label: string): bigint {
  const total = current + increment;
  if (total < 0n || total > MAX_SQLITE_INTEGER) {
    throw new Error(`${label} exceden el máximo entero permitido por SQLite.`);
  }
  return total;
}
