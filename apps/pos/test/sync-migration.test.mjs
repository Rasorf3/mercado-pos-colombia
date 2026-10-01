import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openPosDatabase } from "../src/main/database/database.ts";

test("v10 conserva v9 y crea un respaldo verificado antes de cambiar restricciones", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pos-migration-sync-"));
  const file = join(directory, "pos.sqlite");
  let database;
  try {
    database = new Database(file);
    database.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const name of ["001_catalog_inventory", "002_local_sales", "003_local_clients", "004_users_and_roles", "005_product_package_weight", "006_catalog_and_sale_discounts", "007_cash_sessions", "008_client_credit", "009_company_profile"]) {
      const module = await import(`../src/main/database/migrations/${name}.ts`);
      const migration = Object.values(module)[0];
      database.transaction(() => { migration.apply(database); database.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(migration.version, new Date().toISOString()); })();
    }
    const actor = "11111111-1111-4111-8111-111111111111";
    database.prepare("INSERT INTO pos_users(id,username,password_salt,password_hash,role,active,created_at,updated_at) VALUES(?,?,?,?,'admin',1,'2026-10-01','2026-10-01')").run(actor,"admin", "0".repeat(32), "0".repeat(128));
    database.prepare("INSERT INTO cash_sessions(id,status,opening_cash_cop,opened_at,opened_by_user_id) VALUES('22222222-2222-4222-8222-222222222222','open',1234,'2026-10-01',?)").run(actor);
    database.close();
    database = openPosDatabase(file);
    assert.equal(database.prepare("SELECT opening_cash_cop FROM cash_sessions").get().opening_cash_cop,1234n);
    assert.deepEqual(database.pragma("foreign_key_check"),[]);
    assert.equal(database.pragma("quick_check",{ simple:true }),"ok");
    const backups = readdirSync(directory).filter((name) => name.includes(".pre-sync-v9-"));
    assert.equal(backups.length,1);
    const backup = new Database(join(directory,backups[0]),{ readonly:true });
    try {
      assert.equal(backup.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version,9);
      assert.equal(backup.prepare("SELECT opening_cash_cop FROM cash_sessions").get().opening_cash_cop,1234);
    } finally { backup.close(); }
    database.close();
    database = openPosDatabase(file);
    assert.equal(readdirSync(directory).filter((name) => name.includes(".pre-sync-v9-")).length,1);
  } finally { if (database?.open) database.close(); rmSync(directory,{ recursive:true,force:true }); }
});
