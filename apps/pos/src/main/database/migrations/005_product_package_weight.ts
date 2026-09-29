import type Database from "better-sqlite3";

export const PRODUCT_PACKAGE_WEIGHT_MIGRATION = {
  version: 5,
  apply(database: Database.Database): void {
    database.exec(`
      ALTER TABLE products ADD COLUMN weight_per_unit_milli INTEGER
        CHECK(weight_per_unit_milli IS NULL OR weight_per_unit_milli > 0);
      ALTER TABLE products ADD COLUMN weight_unit TEXT
        CHECK(weight_unit IS NULL OR weight_unit IN ('g', 'kg', 'lb'));
    `);
  }
} as const;
