import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SYNC_TABLES, type SyncTableSpec } from "@mercado-pos/contracts";

// Applied inside openPosDatabase's existing immediate transaction, after a verified
// v9 snapshot. No sales, movements, payments, users or cash snapshots are deleted.
export const SYNC_MIGRATION = {
  version: 10,
  apply(database: Database.Database): void {
    const deviceId = randomUUID();
    database.exec(`
      CREATE TABLE sync_settings (id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT NOT NULL UNIQUE, device_name TEXT, merchant_id TEXT, server_url TEXT, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), cursor TEXT NOT NULL DEFAULT '0', last_sync_at TEXT) STRICT;
      CREATE TABLE sync_context (id INTEGER PRIMARY KEY CHECK(id=1), operation_id TEXT, importing INTEGER NOT NULL DEFAULT 0) STRICT;
      INSERT INTO sync_context(id) VALUES(1);
      CREATE TABLE sync_capture (operation_id TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(operation_id,table_name,row_key)) STRICT;
      CREATE TABLE sync_outbox (sequence INTEGER PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1))) STRICT;
      CREATE TABLE sync_heads (table_name TEXT NOT NULL, row_key TEXT NOT NULL, operation_id TEXT NOT NULL, PRIMARY KEY(table_name,row_key)) STRICT;
      CREATE TABLE sync_inbox (operation_id TEXT PRIMARY KEY, server_sequence TEXT NOT NULL UNIQUE) STRICT;
      CREATE TABLE sync_conflicts (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE sync_credit_intents (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, delta_cop TEXT NOT NULL, committed INTEGER NOT NULL DEFAULT 0, operation_id TEXT) STRICT;
      ALTER TABLE pos_users ADD COLUMN remote_actor INTEGER NOT NULL DEFAULT 0 CHECK(remote_actor IN (0,1));
      ALTER TABLE cash_sessions ADD COLUMN origin_device_id TEXT NOT NULL DEFAULT '${deviceId}';
      DROP INDEX cash_sessions_one_open;
      CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions(origin_device_id) WHERE status='open';
      DROP TRIGGER sale_movement_validate_insert;
      CREATE TRIGGER sale_movement_validate_insert BEFORE INSERT ON inventory_movements WHEN NEW.type='sale_out' BEGIN
        SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sale_items WHERE sale_id=NEW.sale_id AND product_id=NEW.product_id AND quantity_milli=-NEW.quantity_milli)
          THEN RAISE(ABORT,'sale inventory movement does not match sale item') END;
        SELECT CASE WHEN (SELECT importing FROM sync_context WHERE id=1)=0 AND NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND stock_milli=NEW.stock_after_milli)
          THEN RAISE(ABORT,'sale inventory movement does not match product stock') END;
      END;
    `);
    database.prepare("INSERT INTO sync_settings(id,device_id) VALUES(1,?)").run(deviceId);
    for (const [table, rawSpec] of Object.entries(SYNC_TABLES)) {
      const spec: SyncTableSpec = rawSpec;
      const columns = [...spec.text, ...spec.integers];
      const json = `json_object(${columns.flatMap((c) => [`'${c}'`, spec.integers.includes(c) ? `CAST(NEW.${c} AS TEXT)` : `NEW.${c}`]).join(",")})`;
      const key = spec.keys.map((c) => `NEW.${c}`).join(" || ':' || ");
      for (const action of spec.mutable ? ["INSERT", "UPDATE"] : ["INSERT"]) {
        const changed = action === "UPDATE" ? ` AND (${columns.filter((c) => !["updated_at", "updated_by_user_id"].includes(c)).map((c) => `OLD.${c} IS NOT NEW.${c}`).join(" OR ")})` : "";
        database.exec(`CREATE TRIGGER sync_${table}_${action.toLowerCase()} AFTER ${action} ON ${table}
          WHEN (SELECT operation_id FROM sync_context WHERE id=1) IS NOT NULL AND (SELECT importing FROM sync_context WHERE id=1)=0${changed}
          BEGIN INSERT INTO sync_capture(operation_id,table_name,row_key,payload) VALUES((SELECT operation_id FROM sync_context WHERE id=1),'${table}',${key},${json})
            ON CONFLICT(operation_id,table_name,row_key) DO UPDATE SET payload=excluded.payload; END;`);
      }
    }
  }
} as const;
