import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  applyStockDelta,
  discountFromStored,
  formatBogotaDate,
  formatQuantityMilli,
  normalizeProductDraft,
  parseQuantityDeltaMilli,
  parseQuantityMilli,
  validateMovementNote
} from "@mercado-pos/domain";
import type {
  InventoryAdjustmentInput,
  InventoryEntryInput,
  InventoryMovement,
  Product,
  ProductCreateInput,
  ProductDiscount,
  ProductSearchInput,
  SaleProduct,
  ProductUpdateInput
} from "@mercado-pos/contracts";

interface ProductRow {
  id: string;
  name: string;
  internal_code: string;
  barcode: string | null;
  cost_cop: bigint;
  sale_price_cop: bigint;
  unit: Product["unit"];
  weight_per_unit_milli: bigint | null;
  weight_unit: Product["weightUnit"];
  promotion_discount_type: ProductDiscount["type"] | null;
  promotion_discount_value: bigint | null;
  promotion_starts_on: string | null;
  promotion_ends_on: string | null;
  active: bigint;
  stock_milli: bigint;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
}

interface MovementRow {
  id: string;
  product_id: string;
  sale_id: string | null;
  type: InventoryMovement["type"];
  quantity_milli: bigint;
  stock_before_milli: bigint;
  stock_after_milli: bigint;
  note: string;
  created_at: string;
  created_by_username: string | null;
}

export class CatalogNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogNotFoundError";
  }
}

export class DuplicateBarcodeError extends Error {
  constructor() {
    super("Ese código de barras ya está asignado a otro producto.");
    this.name = "DuplicateBarcodeError";
  }
}

export class CatalogService {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  listProducts(search: ProductSearchInput): Product[] {
    const query = search.query.trim();
    const rows = this.database.prepare(`
      SELECT p.id, p.name, p.internal_code, p.barcode, p.cost_cop, p.sale_price_cop,
             p.unit, p.weight_per_unit_milli, p.weight_unit,
             p.promotion_discount_type, p.promotion_discount_value,
             p.promotion_starts_on, p.promotion_ends_on,
             p.active, p.stock_milli, p.created_at, p.updated_at,
             creator.username AS created_by_username
      FROM products p LEFT JOIN pos_users creator ON creator.id = p.created_by_user_id
      WHERE (? = 1 OR p.active = 1)
        AND (
          ? = ''
          OR instr(lower(p.name), lower(?)) > 0
          OR instr(lower(p.internal_code), lower(?)) > 0
          OR instr(COALESCE(p.barcode, ''), ?) > 0
        )
      ORDER BY CASE WHEN p.barcode = ? THEN 0 ELSE 1 END,
               p.active DESC, p.name COLLATE NOCASE
    `).all(
      search.includeInactive ? 1n : 0n,
      query,
      query,
      query,
      query,
      query
    ) as ProductRow[];

    return rows.map(toProduct);
  }

  listProductsForSale(query: string): SaleProduct[] {
    const today = formatBogotaDate();
    return this.listProducts({ query: query.trim(), includeInactive: false })
      .map(({ id, name, internalCode, barcode, salePriceCop, unit, active, stock, promotion }) => ({
        id, name, internalCode, barcode, salePriceCop, unit, active, stock,
        activePromotion: promotion && today >= promotion.startsOn && today <= promotion.endsOn
          ? promotion.discount
          : null
      }));
  }

  createProduct(input: ProductCreateInput, actorUserId: string | null = null): Product {
    const draft = normalizeProductDraft(input);
    const initialStock = parseQuantityMilli(input.initialStock);
    const id = randomUUID();
    const now = new Date().toISOString();

    const create = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO products (
          id, name, internal_code, barcode, cost_cop, sale_price_cop,
          unit, weight_per_unit_milli, weight_unit,
          promotion_discount_type, promotion_discount_value, promotion_starts_on, promotion_ends_on,
          active, stock_milli, created_at, updated_at,
          created_by_user_id, updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        id,
        draft.name,
        draft.internalCode,
        draft.barcode,
        draft.costCop,
        draft.salePriceCop,
        draft.unit,
        draft.weightPerUnitMilli,
        draft.weightUnit,
        draft.promotion?.discount.type ?? null,
        draft.promotion?.discount.value ?? null,
        draft.promotion?.startsOn ?? null,
        draft.promotion?.endsOn ?? null,
        initialStock,
        now,
        now,
        actorUserId,
        actorUserId
      );

      this.database.prepare(`
        INSERT INTO inventory_movements (
          id, product_id, type, quantity_milli, stock_before_milli,
          stock_after_milli, note, created_at, created_by_user_id
        ) VALUES (?, ?, 'initial', ?, 0, ?, ?, ?, ?)
      `).run(randomUUID(), id, initialStock, initialStock, "Existencia inicial", now, actorUserId);

      return this.getProduct(id);
    });

    try {
      return create.immediate();
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  updateProduct(id: string, input: ProductUpdateInput, actorUserId: string | null = null): Product {
    const updated = this.database.transaction(() => {
      const existing = this.getProduct(id);
      const draft = normalizeProductDraft({
        ...input,
        promotion: input.promotion === undefined ? existing.promotion : input.promotion
      });
      const result = this.database.prepare(`
        UPDATE products
        SET name = ?, internal_code = ?, barcode = ?, cost_cop = ?,
            sale_price_cop = ?, unit = ?, weight_per_unit_milli = ?, weight_unit = ?,
            promotion_discount_type = ?, promotion_discount_value = ?,
            promotion_starts_on = ?, promotion_ends_on = ?,
            active = ?, updated_at = ?, updated_by_user_id = ?
        WHERE id = ?
      `).run(
        draft.name,
        draft.internalCode,
        draft.barcode,
        draft.costCop,
        draft.salePriceCop,
        draft.unit,
        draft.weightPerUnitMilli,
        draft.weightUnit,
        draft.promotion?.discount.type ?? null,
        draft.promotion?.discount.value ?? null,
        draft.promotion?.startsOn ?? null,
        draft.promotion?.endsOn ?? null,
        input.active ? 1n : 0n,
        new Date().toISOString(),
        actorUserId,
        id
      );

      if (result.changes === 0) {
        throw new CatalogNotFoundError("No se encontró el producto.");
      }

      return this.getProduct(id);
    });

    try {
      return updated.immediate();
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  recordEntry(input: InventoryEntryInput, actorUserId: string | null = null): InventoryMovement {
    const quantity = parseQuantityMilli(input.quantity);
    if (quantity === 0n) {
      throw new Error("La entrada debe ser mayor que cero.");
    }
    return this.recordMovement(input.productId, "entry", quantity, input.note, actorUserId);
  }

  recordAdjustment(input: InventoryAdjustmentInput, actorUserId: string | null = null): InventoryMovement {
    const delta = parseQuantityDeltaMilli(input.delta);
    if (delta === 0n) {
      throw new Error("El ajuste debe ser diferente de cero.");
    }
    return this.recordMovement(input.productId, "adjustment", delta, input.note, actorUserId);
  }

  listMovements(productId: string): InventoryMovement[] {
    this.getProduct(productId);
    const rows = this.database.prepare(`
      SELECT m.id, m.product_id, m.type, m.quantity_milli, m.stock_before_milli,
             m.stock_after_milli, m.note, m.created_at, m.sale_id,
             actor.username AS created_by_username
      FROM inventory_movements m
      LEFT JOIN pos_users actor ON actor.id = m.created_by_user_id
      WHERE m.product_id = ?
      ORDER BY m.created_at DESC, m.rowid DESC
      LIMIT 200
    `).all(productId) as MovementRow[];

    return rows.map(toMovement);
  }

  private recordMovement(
    productId: string,
    type: "entry" | "adjustment",
    delta: bigint,
    note: string,
    actorUserId: string | null
  ): InventoryMovement {
    const reason = validateMovementNote(note);
    const record = this.database.transaction(() => {
      const product = this.database
        .prepare("SELECT stock_milli FROM products WHERE id = ?")
        .get(productId) as { stock_milli: bigint } | undefined;

      if (!product) {
        throw new CatalogNotFoundError("No se encontró el producto.");
      }

      const before = product.stock_milli;
      const after = applyStockDelta(before, delta);
      const createdAt = new Date().toISOString();
      const id = randomUUID();

      this.database.prepare(`
        UPDATE products SET stock_milli = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?
      `).run(after, createdAt, actorUserId, productId);

      this.database.prepare(`
        INSERT INTO inventory_movements (
          id, product_id, type, quantity_milli, stock_before_milli,
          stock_after_milli, note, created_at, created_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, productId, type, delta, before, after, reason, createdAt, actorUserId);

      return {
        id,
        productId,
        saleId: null,
        type,
        quantity: formatQuantityMilli(delta),
        stockBefore: formatQuantityMilli(before),
        stockAfter: formatQuantityMilli(after),
        note: reason,
        createdByUsername: this.getUsername(actorUserId),
        createdAt
      } satisfies InventoryMovement;
    });

    return record.immediate();
  }

  private getProduct(id: string): Product {
    const row = this.database.prepare(`
      SELECT p.id, p.name, p.internal_code, p.barcode, p.cost_cop, p.sale_price_cop,
             p.unit, p.weight_per_unit_milli, p.weight_unit,
             p.promotion_discount_type, p.promotion_discount_value,
             p.promotion_starts_on, p.promotion_ends_on,
             p.active, p.stock_milli, p.created_at, p.updated_at,
             creator.username AS created_by_username
      FROM products p LEFT JOIN pos_users creator ON creator.id = p.created_by_user_id
      WHERE p.id = ?
    `).get(id) as ProductRow | undefined;

    if (!row) {
      throw new CatalogNotFoundError("No se encontró el producto.");
    }
    return toProduct(row);
  }

  private getUsername(userId: string | null): string | null {
    if (!userId) return null;
    const row = this.database.prepare("SELECT username FROM pos_users WHERE id = ?")
      .get(userId) as { username: string } | undefined;
    return row?.username ?? null;
  }
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    internalCode: row.internal_code,
    barcode: row.barcode,
    costCop: row.cost_cop.toString(),
    salePriceCop: row.sale_price_cop.toString(),
    unit: row.unit,
    weightPerUnit: row.weight_per_unit_milli === null ? null : formatQuantityMilli(row.weight_per_unit_milli),
    weightUnit: row.weight_unit,
    promotion: row.promotion_discount_type === null
      ? null
      : {
        discount: discountFromStored(row.promotion_discount_type, row.promotion_discount_value)!,
        startsOn: row.promotion_starts_on!,
        endsOn: row.promotion_ends_on!
      },
    active: row.active === 1n,
    stock: formatQuantityMilli(row.stock_milli),
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMovement(row: MovementRow): InventoryMovement {
  return {
    id: row.id,
    productId: row.product_id,
    saleId: row.sale_id,
    type: row.type,
    quantity: formatQuantityMilli(row.quantity_milli),
    stockBefore: formatQuantityMilli(row.stock_before_milli),
    stockAfter: formatQuantityMilli(row.stock_after_milli),
    note: row.note,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at
  };
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof Error && /UNIQUE constraint failed: products\.barcode/.test(error.message)) {
    return new DuplicateBarcodeError();
  }
  return error instanceof Error ? error : new Error("No se pudo guardar el producto.");
}
