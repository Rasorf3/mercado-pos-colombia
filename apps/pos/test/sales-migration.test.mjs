import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import { CatalogService } from "../src/main/catalog/catalogService.ts";
import { openPosDatabase } from "../src/main/database/database.ts";
import { INITIAL_CATALOG_MIGRATION } from "../src/main/database/migrations/001_catalog_inventory.ts";

const directory = mkdtempSync(join(tmpdir(), "mercado-pos-sales-migration-"));
const filePath = join(directory, "legacy.sqlite");

test("la migración de ventas conserva catálogo y movimientos de una base v1", (context) => {
  const legacy = new Database(filePath);
  legacy.defaultSafeIntegers(true);
  legacy.pragma("foreign_keys = ON");
  legacy.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL) STRICT`);
  INITIAL_CATALOG_MIGRATION.apply(legacy);
  legacy.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run("2026-01-01T00:00:00.000Z");

  const legacyCatalog = new CatalogService(legacy);
  const product = legacyCatalog.createProduct({
    name: "Producto legado",
    internalCode: "LEGACY-01",
    barcode: "000987",
    costCop: "800",
    salePriceCop: "1200",
    unit: "kg",
    initialStock: "3.125"
  });
  legacyCatalog.recordEntry({ productId: product.id, quantity: "1.375", note: "Entrada anterior a ventas" });
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
  assert.deepEqual(catalog.listMovements(product.id).map(({ type, saleId }) => ({ type, saleId })), [
    { type: "entry", saleId: null },
    { type: "initial", saleId: null }
  ]);
  assert.equal(upgraded.prepare("SELECT max(version) AS version FROM schema_migrations").get().version, 3n);
});
