import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  applyStockDelta,
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
  active: bigint;
  stock_milli: bigint;
  created_at: string;
  updated_at: string;
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
      SELECT id, name, internal_code, barcode, cost_cop, sale_price_cop,
             unit, active, stock_milli, created_at, updated_at
      FROM products
      WHERE (? = 1 OR active = 1)
        AND (
          ? = ''
          OR instr(lower(name), lower(?)) > 0
          OR instr(lower(internal_code), lower(?)) > 0
          OR instr(COALESCE(barcode, ''), ?) > 0
        )
      ORDER BY CASE WHEN barcode = ? THEN 0 ELSE 1 END,
               active DESC, name COLLATE NOCASE
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
    return this.listProducts({ query: query.trim(), includeInactive: false })
      .map(({ id, name, internalCode, barcode, salePriceCop, unit, active, stock }) => ({
        id, name, internalCode, barcode, salePriceCop, unit, active, stock
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
          unit, active, stock_milli, created_at, updated_at,
          created_by_user_id, updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        id,
        draft.name,
        draft.internalCode,
        draft.barcode,
        draft.costCop,
        draft.salePriceCop,
        draft.unit,
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
    const draft = normalizeProductDraft(input);
    const updated = this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE products
        SET name = ?, internal_code = ?, barcode = ?, cost_cop = ?,
            sale_price_cop = ?, unit = ?, active = ?, updated_at = ?, updated_by_user_id = ?
        WHERE id = ?
      `).run(
        draft.name,
        draft.internalCode,
        draft.barcode,
        draft.costCop,
        draft.salePriceCop,
        draft.unit,
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
      SELECT id, product_id, type, quantity_milli, stock_before_milli,
             stock_after_milli, note, created_at, sale_id
      FROM inventory_movements
      WHERE product_id = ?
      ORDER BY created_at DESC, rowid DESC
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
        createdAt
      } satisfies InventoryMovement;
    });

    return record.immediate();
  }

  private getProduct(id: string): Product {
    const row = this.database.prepare(`
      SELECT id, name, internal_code, barcode, cost_cop, sale_price_cop,
             unit, active, stock_milli, created_at, updated_at
      FROM products WHERE id = ?
    `).get(id) as ProductRow | undefined;

    if (!row) {
      throw new CatalogNotFoundError("No se encontró el producto.");
    }
    return toProduct(row);
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
    active: row.active === 1n,
    stock: formatQuantityMilli(row.stock_milli),
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
    createdAt: row.created_at
  };
}

function translateDatabaseError(error: unknown): Error {
  if (error instanceof Error && /UNIQUE constraint failed: products\.barcode/.test(error.message)) {
    return new DuplicateBarcodeError();
  }
  return error instanceof Error ? error : new Error("No se pudo guardar el producto.");
}
