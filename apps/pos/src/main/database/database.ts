import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { INITIAL_CATALOG_MIGRATION } from "./migrations/001_catalog_inventory.ts";
import { LOCAL_SALES_MIGRATION } from "./migrations/002_local_sales.ts";
import { LOCAL_CLIENTS_MIGRATION } from "./migrations/003_local_clients.ts";
import { USERS_AND_ROLES_MIGRATION } from "./migrations/004_users_and_roles.ts";
import { PRODUCT_PACKAGE_WEIGHT_MIGRATION } from "./migrations/005_product_package_weight.ts";
import { CATALOG_AND_SALE_DISCOUNTS_MIGRATION } from "./migrations/006_catalog_and_sale_discounts.ts";
import { CASH_SESSIONS_MIGRATION } from "./migrations/007_cash_sessions.ts";
import { CLIENT_CREDIT_MIGRATION } from "./migrations/008_client_credit.ts";

const MIGRATIONS = [
  INITIAL_CATALOG_MIGRATION,
  LOCAL_SALES_MIGRATION,
  LOCAL_CLIENTS_MIGRATION,
  USERS_AND_ROLES_MIGRATION,
  PRODUCT_PACKAGE_WEIGHT_MIGRATION,
  CATALOG_AND_SALE_DISCOUNTS_MIGRATION,
  CASH_SESSIONS_MIGRATION,
  CLIENT_CREDIT_MIGRATION
];

export function openPosDatabase(filePath: string): Database.Database {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const database = new Database(filePath);
  database.defaultSafeIntegers(true);
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = WAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  for (const migration of MIGRATIONS) {
    const applied = database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(BigInt(migration.version)) as { version: bigint } | undefined;

    if (!applied) {
      const runMigration = database.transaction(() => {
        migration.apply(database);
        database
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(BigInt(migration.version), new Date().toISOString());
      });
      runMigration.immediate();
    }
  }

  return database;
}
