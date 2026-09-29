import type Database from "better-sqlite3";

export const CATALOG_AND_SALE_DISCOUNTS_MIGRATION = {
  version: 6,
  apply(database: Database.Database): void {
    database.exec(`
      ALTER TABLE products ADD COLUMN promotion_discount_type TEXT
        CHECK(promotion_discount_type IS NULL OR promotion_discount_type IN ('percentage', 'fixed'));
      ALTER TABLE products ADD COLUMN promotion_discount_value INTEGER
        CHECK(promotion_discount_value IS NULL OR promotion_discount_value > 0);
      ALTER TABLE products ADD COLUMN promotion_starts_on TEXT;
      ALTER TABLE products ADD COLUMN promotion_ends_on TEXT;

      CREATE TRIGGER product_promotion_validate_insert
      BEFORE INSERT ON products
      WHEN
        (NEW.promotion_discount_type IS NULL) != (NEW.promotion_discount_value IS NULL)
        OR (NEW.promotion_discount_type IS NULL) != (NEW.promotion_starts_on IS NULL)
        OR (NEW.promotion_discount_type IS NULL) != (NEW.promotion_ends_on IS NULL)
        OR (NEW.promotion_discount_type = 'percentage' AND NEW.promotion_discount_value > 10000)
        OR (NEW.promotion_discount_type = 'fixed' AND NEW.promotion_discount_value > NEW.sale_price_cop)
        OR (NEW.promotion_starts_on IS NOT NULL AND NEW.promotion_ends_on < NEW.promotion_starts_on)
      BEGIN SELECT RAISE(ABORT, 'product promotion is invalid'); END;

      CREATE TRIGGER product_promotion_validate_update
      BEFORE UPDATE OF promotion_discount_type, promotion_discount_value,
        promotion_starts_on, promotion_ends_on, sale_price_cop ON products
      WHEN
        (NEW.promotion_discount_type IS NULL) != (NEW.promotion_discount_value IS NULL)
        OR (NEW.promotion_discount_type IS NULL) != (NEW.promotion_starts_on IS NULL)
        OR (NEW.promotion_discount_type IS NULL) != (NEW.promotion_ends_on IS NULL)
        OR (NEW.promotion_discount_type = 'percentage' AND NEW.promotion_discount_value > 10000)
        OR (NEW.promotion_discount_type = 'fixed' AND NEW.promotion_discount_value > NEW.sale_price_cop)
        OR (NEW.promotion_starts_on IS NOT NULL AND NEW.promotion_ends_on < NEW.promotion_starts_on)
      BEGIN SELECT RAISE(ABORT, 'product promotion is invalid'); END;

      ALTER TABLE sale_items ADD COLUMN discount_type TEXT
        CHECK(discount_type IS NULL OR discount_type IN ('percentage', 'fixed'));
      ALTER TABLE sale_items ADD COLUMN discount_value INTEGER
        CHECK(discount_value IS NULL OR discount_value > 0);
      ALTER TABLE sale_items ADD COLUMN discount_total_cop INTEGER NOT NULL DEFAULT 0
        CHECK(discount_total_cop >= 0);

      CREATE TRIGGER sale_item_discount_validate_insert
      BEFORE INSERT ON sale_items
      WHEN
        (NEW.discount_type IS NULL) != (NEW.discount_value IS NULL)
        OR (NEW.discount_type IS NULL AND NEW.discount_total_cop != 0)
        OR (NEW.discount_type = 'percentage' AND NEW.discount_value > 10000)
        OR (NEW.discount_type = 'fixed' AND NEW.discount_value > NEW.unit_price_cop)
      BEGIN SELECT RAISE(ABORT, 'sale item discount is invalid'); END;
    `);
  }
} as const;
