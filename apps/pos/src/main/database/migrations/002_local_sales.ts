import type Database from "better-sqlite3";

export const LOCAL_SALES_MIGRATION = {
  version: 2,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL CHECK(status = 'local_pending_invoice'),
        total_cop INTEGER NOT NULL CHECK(total_cop >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sales_created_at ON sales(created_at DESC);

      CREATE TABLE sale_items (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL CHECK(length(trim(product_name)) > 0),
        unit TEXT NOT NULL CHECK(unit IN ('unit', 'kg', 'g', 'l', 'ml', 'm')),
        quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0),
        unit_price_cop INTEGER NOT NULL CHECK(unit_price_cop >= 0),
        line_total_cop INTEGER NOT NULL CHECK(line_total_cop >= 0),
        UNIQUE(sale_id, product_id)
      ) STRICT;

      CREATE INDEX sale_items_sale ON sale_items(sale_id);

      CREATE TABLE sale_payments (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
        method_id TEXT NOT NULL CHECK(method_id IN (
          'cash', 'debit_card', 'credit_card', 'bank_transfer', 'nequi', 'daviplata', 'bre_b'
        )),
        amount_paid_cop INTEGER NOT NULL CHECK(amount_paid_cop >= 0),
        change_cop INTEGER NOT NULL CHECK(change_cop >= 0),
        reference TEXT CHECK(reference IS NULL OR (length(trim(reference)) > 0 AND length(reference) <= 120)),
        authorization_code TEXT CHECK(authorization_code IS NULL OR (length(trim(authorization_code)) > 0 AND length(authorization_code) <= 64)),
        created_at TEXT NOT NULL,
        CHECK(reference IS NULL OR method_id IN ('bank_transfer', 'nequi', 'daviplata', 'bre_b')),
        CHECK(authorization_code IS NULL OR method_id IN ('debit_card', 'credit_card'))
      ) STRICT;

      CREATE TRIGGER sale_payment_validate_insert
      BEFORE INSERT ON sale_payments
      BEGIN
        SELECT CASE WHEN
          (SELECT COALESCE(SUM(line_total_cop), 0) FROM sale_items WHERE sale_id = NEW.sale_id)
          != (SELECT total_cop FROM sales WHERE id = NEW.sale_id)
        THEN RAISE(ABORT, 'sale payment total does not match sale items') END;

        SELECT CASE WHEN
          NEW.amount_paid_cop < (SELECT total_cop FROM sales WHERE id = NEW.sale_id)
          OR (NEW.method_id != 'cash' AND NEW.amount_paid_cop != (SELECT total_cop FROM sales WHERE id = NEW.sale_id))
          OR NEW.change_cop != CASE
            WHEN NEW.method_id = 'cash' THEN NEW.amount_paid_cop - (SELECT total_cop FROM sales WHERE id = NEW.sale_id)
            ELSE 0
          END
        THEN RAISE(ABORT, 'sale payment amount is invalid') END;
      END;

      CREATE TABLE inventory_movements_next (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        sale_id TEXT REFERENCES sales(id) ON DELETE RESTRICT,
        type TEXT NOT NULL CHECK(type IN ('initial', 'entry', 'adjustment', 'sale_out')),
        quantity_milli INTEGER NOT NULL,
        stock_before_milli INTEGER NOT NULL CHECK(stock_before_milli >= 0),
        stock_after_milli INTEGER NOT NULL CHECK(stock_after_milli >= 0),
        note TEXT NOT NULL CHECK(length(trim(note)) > 0),
        created_at TEXT NOT NULL,
        CHECK(stock_after_milli = stock_before_milli + quantity_milli),
        CHECK(
          (type = 'initial' AND quantity_milli >= 0 AND stock_before_milli = 0 AND sale_id IS NULL)
          OR (type = 'entry' AND quantity_milli > 0 AND sale_id IS NULL)
          OR (type = 'adjustment' AND quantity_milli != 0 AND sale_id IS NULL)
          OR (type = 'sale_out' AND quantity_milli < 0 AND sale_id IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO inventory_movements_next (
        id, product_id, sale_id, type, quantity_milli, stock_before_milli,
        stock_after_milli, note, created_at
      )
      SELECT id, product_id, NULL, type, quantity_milli, stock_before_milli,
             stock_after_milli, note, created_at
      FROM inventory_movements;

      DROP TABLE inventory_movements;
      ALTER TABLE inventory_movements_next RENAME TO inventory_movements;

      CREATE UNIQUE INDEX inventory_one_initial_movement
        ON inventory_movements(product_id)
        WHERE type = 'initial';

      CREATE INDEX inventory_movements_product_created
        ON inventory_movements(product_id, created_at DESC);

      CREATE INDEX inventory_movements_sale ON inventory_movements(sale_id);

      CREATE TRIGGER sale_movement_validate_insert
      BEFORE INSERT ON inventory_movements
      WHEN NEW.type = 'sale_out'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM sale_items
          WHERE sale_id = NEW.sale_id
            AND product_id = NEW.product_id
            AND quantity_milli = -NEW.quantity_milli
        ) THEN RAISE(ABORT, 'sale inventory movement does not match sale item') END;

        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM products
          WHERE id = NEW.product_id AND stock_milli = NEW.stock_after_milli
        ) THEN RAISE(ABORT, 'sale inventory movement does not match product stock') END;
      END;
    `);
  }
} as const;
