import type Database from "better-sqlite3";

export const INITIAL_CATALOG_MIGRATION = {
  version: 1,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        internal_code TEXT NOT NULL CHECK(length(trim(internal_code)) > 0),
        barcode TEXT,
        cost_cop INTEGER NOT NULL CHECK(cost_cop >= 0),
        sale_price_cop INTEGER NOT NULL CHECK(sale_price_cop >= 0),
        unit TEXT NOT NULL CHECK(unit IN ('unit', 'kg', 'g', 'l', 'ml', 'm')),
        active INTEGER NOT NULL CHECK(active IN (0, 1)),
        stock_milli INTEGER NOT NULL CHECK(stock_milli >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX products_barcode_unique
        ON products(barcode)
        WHERE barcode IS NOT NULL;

      CREATE INDEX products_name_search ON products(name COLLATE NOCASE);
      CREATE INDEX products_internal_code_search ON products(internal_code COLLATE NOCASE);

      CREATE TABLE inventory_movements (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        type TEXT NOT NULL CHECK(type IN ('initial', 'entry', 'adjustment')),
        quantity_milli INTEGER NOT NULL,
        stock_before_milli INTEGER NOT NULL CHECK(stock_before_milli >= 0),
        stock_after_milli INTEGER NOT NULL CHECK(stock_after_milli >= 0),
        note TEXT NOT NULL CHECK(length(trim(note)) > 0),
        created_at TEXT NOT NULL,
        CHECK(stock_after_milli = stock_before_milli + quantity_milli),
        CHECK(
          (type = 'initial' AND quantity_milli >= 0 AND stock_before_milli = 0)
          OR (type = 'entry' AND quantity_milli > 0)
          OR (type = 'adjustment' AND quantity_milli != 0)
        )
      ) STRICT;

      CREATE UNIQUE INDEX inventory_one_initial_movement
        ON inventory_movements(product_id)
        WHERE type = 'initial';

      CREATE INDEX inventory_movements_product_created
        ON inventory_movements(product_id, created_at DESC);
    `);
  }
} as const;
