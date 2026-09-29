import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
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
  status: SaleStatus;
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
}

interface ClientForSaleRow {
  id: string;
  name: string;
  document_type: string | null;
  document_number: string | null;
  email: string | null;
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
    const create = this.database.transaction(() => {
      const createdAt = new Date().toISOString();
      const today = formatBogotaDate(new Date(createdAt));
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
      const payment = normalizeSalePayment(input.payment, amounts.totalCop);
      const saleId = randomUUID();

      this.database.prepare(`
        INSERT INTO sales (id, status, total_cop, created_at, created_by_user_id)
        VALUES (?, 'local_pending_invoice', ?, ?, ?)
      `).run(saleId, amounts.totalCop, createdAt, actorUserId);

      this.database.prepare(`
        INSERT INTO sale_buyer_snapshots (
          sale_id, client_id, buyer_name, document_type, document_number, email, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        saleId,
        buyer?.clientId ?? null,
        buyer?.name ?? null,
        buyer?.documentType ?? null,
        buyer?.documentNumber ?? null,
        buyer?.email ?? null,
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

      this.database.prepare(`
        INSERT INTO sale_payments (
          id, sale_id, method_id, amount_paid_cop, change_cop,
          reference, authorization_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        saleId,
        payment.method,
        payment.amountPaidCop,
        payment.changeCop,
        payment.reference,
        payment.authorizationCode,
        createdAt
      );

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

  listRecentSales(): SaleSummary[] {
    return this.listSales({ page: 1, pageSize: 20 }).sales;
  }

  listSales(input: SalesListInput): SalesPage {
    const { from, until } = salesDateBounds(input);
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (from) { conditions.push("s.created_at >= ?"); parameters.push(from); }
    if (until) { conditions.push("s.created_at < ?"); parameters.push(until); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.database.transaction(() => {
      const count = this.database.prepare(`SELECT count(*) AS total FROM sales s ${where}`)
        .get(...parameters) as { total: bigint };
      const rows = this.database.prepare(`
        SELECT s.id, s.status, s.total_cop, s.created_at, u.username AS created_by_username
        FROM sales s LEFT JOIN pos_users u ON u.id = s.created_by_user_id ${where}
        ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?
      `).all(...parameters, input.pageSize, (input.page - 1) * input.pageSize) as SaleRow[];
      return {
        page: input.page,
        pageSize: input.pageSize,
        total: Number(count.total),
        sales: rows.map((row) => ({
          id: row.id,
          status: row.status,
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
      SELECT s.id, s.status, s.total_cop, s.created_at, u.username AS created_by_username
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
      status: row.status,
      totalCop: row.total_cop.toString(),
      createdByUsername: row.created_by_username,
      items: items.map(toSaleLine),
      payment: this.getPayment(id),
      buyer: this.getBuyer(id),
      createdAt: row.created_at
    };
  }

  private getPayment(saleId: string): SalePayment {
    const row = this.database.prepare(`
      SELECT method_id, amount_paid_cop, change_cop, reference, authorization_code
      FROM sale_payments WHERE sale_id = ?
    `).get(saleId) as SalePaymentRow | undefined;
    if (!row) throw new Error("La venta local no tiene un registro de pago.");
    return {
      method: row.method_id,
      amountPaidCop: row.amount_paid_cop.toString(),
      changeCop: row.change_cop.toString(),
      reference: row.reference,
      authorizationCode: row.authorization_code
    };
  }

  private getActiveBuyer(clientId: string): BuyerSnapshot {
    const row = this.database.prepare(`
      SELECT id, name, document_type, document_number, email, active
      FROM clients WHERE id = ?
    `).get(clientId) as ClientForSaleRow | undefined;
    if (!row || row.active !== 1n) {
      throw new Error("El cliente seleccionado no existe o está inactivo.");
    }
    return {
      clientId: row.id,
      name: row.name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      email: row.email
    };
  }

  private getBuyer(saleId: string): BuyerSnapshot | null {
    const row = this.database.prepare(`
      SELECT client_id, buyer_name, document_type, document_number, email
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
      email: row.email
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
