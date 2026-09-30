import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { INITIAL_CATALOG_MIGRATION } from "../src/main/database/migrations/001_catalog_inventory.ts";
import { randomUUID } from "node:crypto";

const directory = mkdtempSync(join(tmpdir(), "mercado-pos-sales-migration-"));
const filePath = join(directory, "legacy.sqlite");

test("la migración de ventas conserva catálogo y movimientos de una base v1", (context) => {
  const legacy = new Database(filePath);
  legacy.defaultSafeIntegers(true);
  legacy.pragma("foreign_keys = ON");
  legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL) STRICT`);
  INITIAL_CATALOG_MIGRATION.apply(legacy);
  legacy.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run("2026-01-01T00:00:00.000Z");

  const productId = randomUUID();
  legacy.prepare(`INSERT INTO products (
    id, name, internal_code, barcode, cost_cop, sale_price_cop, unit, active,
    stock_milli, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(
    productId, "Producto legado", "LEGACY-01", "000987", 800n, 1200n, "kg", 4500n,
    "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"
  );
  legacy.prepare(`INSERT INTO inventory_movements (
    id, product_id, type, quantity_milli, stock_before_milli, stock_after_milli, note, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), productId, "initial", 3125n, 0n, 3125n, "Existencia inicial", "2026-01-01T00:00:00.000Z"
  );
  legacy.prepare(`INSERT INTO inventory_movements (
    id, product_id, type, quantity_milli, stock_before_milli, stock_after_milli, note, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), productId, "entry", 1375n, 3125n, 4500n, "Entrada anterior a ventas", "2026-01-02T00:00:00.000Z"
  );
  legacy.close();

  const upgraded = openPosDatabase(filePath);
  context.after(() => {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const catalog = new CatalogService(upgraded);
  const preserved = catalog.listProducts({ query: "LEGACY-01", includeInactive: false })[0];
  assert.equal(preserved.stock, "4.5");
  assert.equal(preserved.barcode, "000987");
  assert.deepEqual(catalog.listMovements(productId).map(({ type, saleId }) => ({ type, saleId })), [
    { type: "entry", saleId: null },
    { type: "initial", saleId: null }
  ]);
  assert.equal(upgraded.prepare("SELECT max(version) AS version FROM schema_migrations").get().version, 7n);
});
