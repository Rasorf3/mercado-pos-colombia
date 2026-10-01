import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { trackedTransaction } from "../sync/syncJournal.ts";
import { SaleIdSchema, type SalesListInput, type SalesPage } from "@mercado-pos/contracts";
import { salesDateBounds, validateSalesRequest } from "./salesRequests.ts";
import {
  applyStockDelta,
  activePromotionDiscount,
  calculateSaleAmounts,
  combineSaleQuantities,
  discountFromStored,
  formatBogotaDate,
  formatDiscountDraft,
  formatQuantityMilli,
  normalizeDiscount,
  normalizeSalePayment,
  validateSaleStock
} from "@mercado-pos/domain";
import type {
  PaymentMethod,
  ProductDiscount,
  BuyerSnapshot,
  ProductUnit,
  Sale,
  SaleCreateInput,
  SaleLine,
  SalePayment,
  SaleStatus,
  SaleSummary
} from "@mercado-pos/contracts";

interface ProductForSaleRow {
  id: string;
  name: string;
  unit: ProductUnit;
  sale_price_cop: bigint;
  promotion_discount_type: ProductDiscount["type"] | null;
  promotion_discount_value: bigint | null;
  promotion_starts_on: string | null;
  promotion_ends_on: string | null;
  active: bigint;
  stock_milli: bigint;
}

interface SaleRow {
  id: string;
  cash_session_id: string | null;
  status: SaleStatus;
  settlement_type: "paid" | "on_account";
  total_cop: bigint;
  created_at: string;
  created_by_username: string | null;
}

interface SaleItemRow {
  product_id: string;
  product_name: string;
  unit: ProductUnit;
  quantity_milli: bigint;
  unit_price_cop: bigint;
  discount_type: ProductDiscount["type"] | null;
  discount_value: bigint | null;
  discount_total_cop: bigint;
  line_total_cop: bigint;
}

interface SalePaymentRow {
  method_id: PaymentMethod;
  amount_paid_cop: bigint;
  change_cop: bigint;
  reference: string | null;
  authorization_code: string | null;
}

interface BuyerSnapshotRow {
  client_id: string | null;
  buyer_name: string | null;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface ClientForSaleRow {
  id: string;
  name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  credit_limit_cop: bigint;
  credit_balance_cop: bigint;
  active: bigint;
}

export class SaleNotFoundError extends Error {
  constructor() {
    super("No se encontró la venta local.");
    this.name = "SaleNotFoundError";
  }
}

export class SalesService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  createSale(input: SaleCreateInput, actorUserId: string | null = null): Sale {
    const settlement = input.settlement ?? "paid";
    if (settlement === "on_account" && input.payment) {
      throw new Error("Una venta fiada no puede registrar un pago inicial.");
    }
    if (settlement === "paid" && !input.payment) {
      throw new Error("Selecciona un medio de pago o marca la venta como fiada.");
    }
    if (settlement === "on_account" && !input.clientId) {
      throw new Error("Para fiar una venta debes seleccionar un cliente.");
    }
    const requestedDiscounts = new Map<string, { provided: boolean; discount: ProductDiscount | null }>();
    for (const line of input.items) {
      const selection = {
        provided: Object.prototype.hasOwnProperty.call(line, "discount"),
        discount: line.discount ?? null
      };
      const previous = requestedDiscounts.get(line.productId);
      if (previous && (previous.provided !== selection.provided
        || JSON.stringify(previous.discount) !== JSON.stringify(selection.discount))) {
          throw new Error("Un mismo producto no puede tener descuentos distintos en una sola venta.");
      }
      requestedDiscounts.set(line.productId, selection);
    }
    const requestedLines = combineSaleQuantities(input.items);
    const create = trackedTransaction(this.database, "sale", actorUserId, () => {
      const createdAt = new Date().toISOString();
      const today = formatBogotaDate(new Date(createdAt));
      const cashSession = this.database.prepare("SELECT id FROM cash_sessions WHERE status = 'open' AND origin_device_id=(SELECT device_id FROM sync_settings WHERE id=1)")
        .get() as { id: string } | undefined;
      if (!cashSession) {
        throw new Error("No hay una caja abierta. Pide a un usuario Admin o EmpleadoJefe que inicie el turno.");
      }
      const buyer = input.clientId ? this.getActiveBuyer(input.clientId) : null;
      const lines = requestedLines.map((requested) => {
        const product = this.database.prepare(`
          SELECT id, name, unit, sale_price_cop, active, stock_milli,
                 promotion_discount_type, promotion_discount_value,
                 promotion_starts_on, promotion_ends_on
          FROM products WHERE id = ?
        `).get(requested.productId) as ProductForSaleRow | undefined;

        if (!product || product.active !== 1n) {
          throw new Error("Uno de los productos ya no está disponible para la venta.");
        }
        validateSaleStock(
          formatQuantityMilli(requested.quantityMilli),
          formatQuantityMilli(product.stock_milli),
          product.name
        );

        const storedPromotion = product.promotion_discount_type === null
          ? null
          : {
            discount: normalizeDiscount(
              discountFromStored(product.promotion_discount_type, product.promotion_discount_value),
              product.sale_price_cop
            )!,
            startsOn: product.promotion_starts_on!,
            endsOn: product.promotion_ends_on!
          };
        const configuredDiscount = activePromotionDiscount(storedPromotion, today);
        const selection = requestedDiscounts.get(product.id);
        const discountDraft = selection?.provided
          ? selection.discount
          : formatDiscountDraft(configuredDiscount);
        const discount = normalizeDiscount(discountDraft, product.sale_price_cop);

        return {
          product,
          quantityMilli: requested.quantityMilli,
          discount,
          stockAfterMilli: applyStockDelta(product.stock_milli, -requested.quantityMilli)
        };
      });

      const amounts = calculateSaleAmounts(lines.map(({ product, quantityMilli, discount }) => ({
        quantity: formatQuantityMilli(quantityMilli),
        unitPriceCop: product.sale_price_cop.toString(),
        discount: formatDiscountDraft(discount)
      })));
      let payment: ReturnType<typeof normalizeSalePayment> | null = null;
      if (settlement === "on_account") {
        if (!buyer) throw new Error("Para fiar una venta debes seleccionar un cliente activo.");
        if (amounts.totalCop === 0n) throw new Error("Una venta fiada debe tener un total mayor que cero.");
        if (buyer.credit_balance_cop + amounts.totalCop > buyer.credit_limit_cop) {
          throw new Error("La venta supera el límite de fiado disponible para este cliente. Ajusta el límite o registra un abono.");
        }
      } else {
        payment = normalizeSalePayment(input.payment!, amounts.totalCop);
      }
      const saleId = randomUUID();

      this.database.prepare(`
        INSERT INTO sales (id, status, total_cop, created_at, created_by_user_id, cash_session_id, settlement_type)
        VALUES (?, 'local_pending_invoice', ?, ?, ?, ?, ?)
      `).run(saleId, amounts.totalCop, createdAt, actorUserId, cashSession.id, settlement);

      this.database.prepare(`
        INSERT INTO sale_buyer_snapshots (
          sale_id, client_id, buyer_name, document_type, document_number, email, phone, address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        saleId,
        buyer?.clientId ?? null,
        buyer?.name ?? null,
        buyer?.documentType ?? null,
        buyer?.documentNumber ?? null,
        buyer?.email ?? null,
        buyer?.phone ?? null,
        buyer?.address ?? null,
        createdAt
      );

      const insertItem = this.database.prepare(`
        INSERT INTO sale_items (
          id, sale_id, product_id, product_name, unit, quantity_milli,
          unit_price_cop, discount_type, discount_value, discount_total_cop, line_total_cop
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      lines.forEach(({ product, quantityMilli, discount }, index) => {
        insertItem.run(
          randomUUID(),
          saleId,
          product.id,
          product.name,
          product.unit,
          quantityMilli,
          product.sale_price_cop,
          discount?.type ?? null,
          discount?.value ?? null,
          amounts.lineDiscountsCop[index],
          amounts.lineTotalsCop[index]
        );
      });

      if (payment) {
        this.database.prepare(`
          INSERT INTO sale_payments (
            id, sale_id, method_id, amount_paid_cop, change_cop,
            reference, authorization_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), saleId, payment.method, payment.amountPaidCop, payment.changeCop,
          payment.reference, payment.authorizationCode, createdAt
        );
      } else {
        this.database.prepare(`
          INSERT INTO client_credit_entries (
            id, client_id, entry_type, sale_id, amount_cop, method_id,
            reference, authorization_code, created_by_user_id, created_at
          ) VALUES (?, ?, 'sale_charge', ?, ?, NULL, NULL, NULL, ?, ?)
        `).run(randomUUID(), buyer!.clientId, saleId, amounts.totalCop, actorUserId, createdAt);
      }

      const updateStock = this.database.prepare(`
        UPDATE products
        SET stock_milli = ?, updated_at = ?, updated_by_user_id = ?
        WHERE id = ? AND active = 1 AND stock_milli = ?
      `);
      const insertMovement = this.database.prepare(`
        INSERT INTO inventory_movements (
          id, product_id, sale_id, type, quantity_milli, stock_before_milli,
          stock_after_milli, note, created_at, created_by_user_id
        ) VALUES (?, ?, ?, 'sale_out', ?, ?, ?, ?, ?, ?)
      `);

      for (const { product, quantityMilli, stockAfterMilli } of lines) {
        const update = updateStock.run(stockAfterMilli, createdAt, actorUserId, product.id, product.stock_milli);
        if (update.changes !== 1) {
          throw new Error(`No se pudo actualizar la existencia de ${product.name}.`);
        }
        insertMovement.run(
          randomUUID(),
          product.id,
          saleId,
          -quantityMilli,
          product.stock_milli,
          stockAfterMilli,
          `Venta local ${saleId}`,
          createdAt,
          actorUserId
        );
      }

      return this.getSale(saleId);
    });

    return create.immediate();
  }

  getSaleCreatorId(id: string): string | null {
    validateSalesRequest<string>(SaleIdSchema, id);
    const row = this.database.prepare("SELECT created_by_user_id FROM sales WHERE id = ?")
      .get(id) as { created_by_user_id: string | null } | undefined;
    if (!row) throw new SaleNotFoundError();
    return row.created_by_user_id;
  }

  quoteCredit(input: SaleCreateInput): string {
    if (!input.clientId) throw new Error("Para fiar una venta debes seleccionar un cliente.");
    this.getActiveBuyer(input.clientId);
    const today = formatBogotaDate();
    return calculateSaleAmounts(combineSaleQuantities(input.items).map((line) => {
      const p = this.database.prepare("SELECT * FROM products WHERE id=? AND active=1").get(line.productId) as ProductForSaleRow | undefined;
      if (!p) throw new Error("Uno de los productos ya no está disponible.");
      const requested = input.items.find((i) => i.productId === line.productId)!;
      const promotion = p.promotion_discount_type === null ? null : { discount: normalizeDiscount(discountFromStored(p.promotion_discount_type,p.promotion_discount_value),p.sale_price_cop)!, startsOn:p.promotion_starts_on!,endsOn:p.promotion_ends_on! };
      const discount = Object.prototype.hasOwnProperty.call(requested,"discount") ? requested.discount ?? null : formatDiscountDraft(activePromotionDiscount(promotion,today));
      return { quantity:formatQuantityMilli(line.quantityMilli), unitPriceCop:p.sale_price_cop.toString(),discount };
    })).totalCop.toString();
  }

  listRecentSales(): SaleSummary[] {
    return this.listSales({ page: 1, pageSize: 20 }).sales;
  }

  listSales(input: SalesListInput): SalesPage {
    const { from, until } = salesDateBounds(input);
    const conditions: string[] = [];
    const parameters: string[] = [];
    const buyerQuery = input.buyerQuery?.trim() ?? "";
    if (from) { conditions.push("s.created_at >= ?"); parameters.push(from); }
    if (until) { conditions.push("s.created_at < ?"); parameters.push(until); }
    if (buyerQuery) {
      conditions.push(`EXISTS (
        SELECT 1 FROM sale_buyer_snapshots buyer
        WHERE buyer.sale_id = s.id AND (
          instr(lower(COALESCE(buyer.buyer_name, '')), lower(?)) > 0
          OR instr(lower(COALESCE(buyer.document_type, '')), lower(?)) > 0
          OR instr(lower(COALESCE(buyer.document_number, '')), lower(?)) > 0
          OR instr(lower(COALESCE(buyer.phone, '')), lower(?)) > 0
          OR instr(lower(COALESCE(buyer.address, '')), lower(?)) > 0
        )
      )`);
      parameters.push(buyerQuery, buyerQuery, buyerQuery, buyerQuery, buyerQuery);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.database.transaction(() => {
      const count = this.database.prepare(`SELECT count(*) AS total FROM sales s ${where}`)
        .get(...parameters) as { total: bigint };
      const rows = this.database.prepare(`
        SELECT s.id, s.cash_session_id, s.status, s.settlement_type, s.total_cop, s.created_at, u.username AS created_by_username
        FROM sales s LEFT JOIN pos_users u ON u.id = s.created_by_user_id ${where}
        ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?
      `).all(...parameters, input.pageSize, (input.page - 1) * input.pageSize) as SaleRow[];
      return {
        page: input.page,
        pageSize: input.pageSize,
        total: Number(count.total),
        sales: rows.map((row) => ({
          id: row.id,
          cashSessionId: row.cash_session_id,
          status: row.status,
          settlement: row.settlement_type,
          totalCop: row.total_cop.toString(),
          createdByUsername: row.created_by_username,
          payment: this.getPayment(row.id),
          buyer: this.getBuyer(row.id),
          createdAt: row.created_at
        }))
      };
    }).deferred();
  }

  getSale(id: string): Sale {
    validateSalesRequest<string>(SaleIdSchema, id);
    const row = this.database.prepare(`
      SELECT s.id, s.cash_session_id, s.status, s.settlement_type, s.total_cop, s.created_at, u.username AS created_by_username
      FROM sales s LEFT JOIN pos_users u ON u.id = s.created_by_user_id WHERE s.id = ?
    `).get(id) as SaleRow | undefined;
    if (!row) throw new SaleNotFoundError();

    const items = this.database.prepare(`
      SELECT product_id, product_name, unit, quantity_milli,
             unit_price_cop, discount_type, discount_value, discount_total_cop, line_total_cop
      FROM sale_items WHERE sale_id = ? ORDER BY rowid
    `).all(id) as SaleItemRow[];

    return {
      id: row.id,
      cashSessionId: row.cash_session_id,
      status: row.status,
      settlement: row.settlement_type,
      totalCop: row.total_cop.toString(),
      createdByUsername: row.created_by_username,
      items: items.map(toSaleLine),
      payment: this.getPayment(id),
      buyer: this.getBuyer(id),
      createdAt: row.created_at
    };
  }

  private getPayment(saleId: string): SalePayment | null {
    const row = this.database.prepare(`
      SELECT method_id, amount_paid_cop, change_cop, reference, authorization_code
      FROM sale_payments WHERE sale_id = ?
    `).get(saleId) as SalePaymentRow | undefined;
    if (!row) return null;
    return {
      method: row.method_id,
      amountPaidCop: row.amount_paid_cop.toString(),
      changeCop: row.change_cop.toString(),
      reference: row.reference,
      authorizationCode: row.authorization_code
    };
  }

  private getActiveBuyer(clientId: string): BuyerSnapshot & { credit_limit_cop: bigint; credit_balance_cop: bigint } {
    const row = this.database.prepare(`
      SELECT c.id, c.name, c.document_type, c.document_number, c.email, c.phone, c.address,
             c.credit_limit_cop, c.active,
             COALESCE((
               SELECT SUM(CASE WHEN e.entry_type = 'sale_charge' THEN e.amount_cop ELSE -e.amount_cop END)
               FROM client_credit_entries e WHERE e.client_id = c.id
             ), 0) AS credit_balance_cop
      FROM clients c WHERE c.id = ?
    `).get(clientId) as ClientForSaleRow | undefined;
    if (!row || row.active !== 1n) {
      throw new Error("El cliente seleccionado no existe o está inactivo.");
    }
    return {
      clientId: row.id,
      name: row.name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      email: row.email,
      phone: row.phone,
      address: row.address,
      credit_limit_cop: row.credit_limit_cop,
      credit_balance_cop: row.credit_balance_cop
    };
  }

  private getBuyer(saleId: string): BuyerSnapshot | null {
    const row = this.database.prepare(`
      SELECT client_id, buyer_name, document_type, document_number, email, phone, address
      FROM sale_buyer_snapshots WHERE sale_id = ?
    `).get(saleId) as BuyerSnapshotRow | undefined;
    if (!row) throw new Error("La venta no tiene su instantánea de comprador registrada.");
    if (row.client_id === null) return null;
    if (row.buyer_name === null) throw new Error("La instantánea del comprador está incompleta.");
    return {
      clientId: row.client_id,
      name: row.buyer_name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      email: row.email,
      phone: row.phone,
      address: row.address
    };
  }
}

function toSaleLine(row: SaleItemRow): SaleLine {
  return {
    productId: row.product_id,
    productName: row.product_name,
    unit: row.unit,
    quantity: formatQuantityMilli(row.quantity_milli),
    unitPriceCop: row.unit_price_cop.toString(),
    discount: discountFromStored(row.discount_type, row.discount_value) as SaleLine["discount"],
    discountTotalCop: row.discount_total_cop.toString(),
    lineTotalCop: row.line_total_cop.toString()
  };
}
