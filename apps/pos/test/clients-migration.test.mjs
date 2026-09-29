import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { openPosDatabase } from "../src/main/database/database.ts";
import { INITIAL_CATALOG_MIGRATION } from "../src/main/database/migrations/001_catalog_inventory.ts";
import { LOCAL_SALES_MIGRATION } from "../src/main/database/migrations/002_local_sales.ts";

const directory = mkdtempSync(join(tmpdir(), "mercado-pos-clients-migration-"));
const filePath = join(directory, "version-two.sqlite");

test("la migración v4 conserva las ventas previas y sus compradores vacíos", (context) => {
  const legacy = new Database(filePath);
  legacy.defaultSafeIntegers(true);
  legacy.pragma("foreign_keys = ON");
  legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL) STRICT");
  INITIAL_CATALOG_MIGRATION.apply(legacy);
  LOCAL_SALES_MIGRATION.apply(legacy);
  legacy.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1n, "2026-01-01T00:00:00.000Z");
  legacy.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(2n, "2026-01-02T00:00:00.000Z");
  const saleId = randomUUID();
  legacy.prepare("INSERT INTO sales (id, status, total_cop, created_at) VALUES (?, 'local_pending_invoice', 0, ?)")
    .run(saleId, "2026-01-03T00:00:00.000Z");
  legacy.close();

  const upgraded = openPosDatabase(filePath);
  context.after(() => {
    upgraded.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(upgraded.prepare("SELECT max(version) AS version FROM schema_migrations").get().version, 4n);
  assert.equal(upgraded.prepare("SELECT created_by_user_id FROM sales WHERE id = ?").get(saleId).created_by_user_id, null);
  assert.deepEqual(upgraded.prepare(`
    SELECT client_id, buyer_name, document_type, document_number, email
    FROM sale_buyer_snapshots WHERE sale_id = ?
  `).get(saleId), {
    client_id: null,
    buyer_name: null,
    document_type: null,
    document_number: null,
    email: null
  });
});
