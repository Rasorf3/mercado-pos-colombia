import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  ClientCreditAccount,
  ClientCreditAccountSummary,
  ClientCreditEntry,
  CreditPaymentInput,
  PaymentMethod,
  ReceivablesSearchInput
} from "@mercado-pos/contracts";
import { normalizeCreditPayment } from "@mercado-pos/domain";

interface AccountRow {
  client_id: string;
  name: string;
  document_type: string | null;
  document_number: string | null;
  phone: string | null;
  address: string | null;
  active: bigint;
  credit_limit_cop: bigint;
  balance_cop: bigint;
}

interface EntryRow {
  id: string;
  entry_type: "sale_charge" | "payment";
  sale_id: string | null;
  amount_cop: bigint;
  method_id: PaymentMethod | null;
  reference: string | null;
  authorization_code: string | null;
  created_by_username: string | null;
  created_at: string;
}

const ACCOUNT_CTE = `
  WITH account_balances AS (
    SELECT c.id AS client_id, c.name, c.document_type, c.document_number, c.phone, c.address,
           c.active, c.credit_limit_cop,
           COALESCE((
             SELECT SUM(CASE WHEN e.entry_type = 'sale_charge' THEN e.amount_cop ELSE -e.amount_cop END)
             FROM client_credit_entries e WHERE e.client_id = c.id
           ), 0) AS balance_cop
    FROM clients c
  )
`;

export class ReceivablesService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  listAccounts(input: ReceivablesSearchInput): ClientCreditAccountSummary[] {
    const query = input.query.trim();
    const rows = this.database.prepare(`
      ${ACCOUNT_CTE}
      SELECT client_id, name, document_type, document_number, phone, credit_limit_cop, balance_cop
      FROM account_balances
      WHERE (? = '' AND balance_cop > 0) OR (
        ? != '' AND (
          instr(lower(name), lower(?)) > 0
          OR instr(lower(COALESCE(document_type, '')), lower(?)) > 0
          OR instr(lower(COALESCE(document_number, '')), lower(?)) > 0
          OR instr(lower(COALESCE(phone, '')), lower(?)) > 0
        )
      )
      ORDER BY balance_cop DESC, name COLLATE NOCASE
      LIMIT 100
    `).all(query, query, query, query, query, query) as Array<Pick<AccountRow,
      "client_id" | "name" | "document_type" | "document_number" | "phone" | "credit_limit_cop" | "balance_cop">>;
    return rows.map(toSummary);
  }

  getAccount(clientId: string): ClientCreditAccount {
    const row = this.getAccountRow(clientId);
    if (!row) throw new Error("No se encontró la cuenta del cliente.");
    const entries = this.database.prepare(`
      SELECT e.id, e.entry_type, e.sale_id, e.amount_cop, e.method_id, e.reference,
             e.authorization_code, u.username AS created_by_username, e.created_at
      FROM client_credit_entries e
      LEFT JOIN pos_users u ON u.id = e.created_by_user_id
      WHERE e.client_id = ?
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 100
    `).all(clientId) as EntryRow[];
    return {
      ...toSummary(row),
      address: row.address,
      active: row.active === 1n,
      entries: entries.map(toEntry)
    };
  }

  recordPayment(input: CreditPaymentInput, actorUserId: string | null = null): ClientCreditAccount {
    const record = this.database.transaction(() => {
      const row = this.getAccountRow(input.clientId);
      if (!row) throw new Error("No se encontró la cuenta del cliente.");
      const payment = normalizeCreditPayment(input, row.balance_cop);
      const cashSession = this.database.prepare("SELECT id FROM cash_sessions WHERE status = 'open'")
        .get() as { id: string } | undefined;
      if (payment.method === "cash" && !cashSession) {
        throw new Error("Para recibir un abono en efectivo debe haber una caja abierta.");
      }
      this.database.prepare(`
        INSERT INTO client_credit_entries (
          id, client_id, entry_type, sale_id, cash_session_id, amount_cop, method_id,
          reference, authorization_code, created_by_user_id, created_at
        ) VALUES (?, ?, 'payment', NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), input.clientId, cashSession?.id ?? null, payment.amountCop, payment.method,
        payment.reference, payment.authorizationCode, actorUserId, new Date().toISOString()
      );
      return this.getAccount(input.clientId);
    });
    return record.immediate();
  }

  private getAccountRow(clientId: string): AccountRow | undefined {
    return this.database.prepare(`
      ${ACCOUNT_CTE}
      SELECT * FROM account_balances WHERE client_id = ?
    `).get(clientId) as AccountRow | undefined;
  }
}

function toSummary(row: Pick<AccountRow,
  "client_id" | "name" | "document_type" | "document_number" | "phone" | "credit_limit_cop" | "balance_cop">): ClientCreditAccountSummary {
  return {
    clientId: row.client_id,
    name: row.name,
    documentType: row.document_type,
    documentNumber: row.document_number,
    phone: row.phone,
    creditLimitCop: row.credit_limit_cop.toString(),
    balanceCop: row.balance_cop.toString(),
    availableCreditCop: (row.credit_limit_cop - row.balance_cop).toString()
  };
}

function toEntry(row: EntryRow): ClientCreditEntry {
  return {
    id: row.id,
    kind: row.entry_type,
    saleId: row.sale_id,
    amountCop: row.amount_cop.toString(),
    method: row.method_id,
    reference: row.reference,
    authorizationCode: row.authorization_code,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at
  };
}
