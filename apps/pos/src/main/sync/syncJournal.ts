import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SYNC_TABLES, type SyncChange, type SyncOperation, type SyncTable, type SyncTableSpec, type SyncRow } from "@mercado-pos/contracts";
import { inventoryBalance, syncRowKey, validateSyncOperation } from "@mercado-pos/domain";

export interface SyncSettings { device_id: string; device_name: string | null; merchant_id: string | null; server_url: string | null; enabled: bigint; cursor: string; last_sync_at: string | null }
export function settings(database: Database.Database): SyncSettings { return database.prepare("SELECT * FROM sync_settings WHERE id=1").get() as SyncSettings; }
interface Permit { id: string; clientId: string; deltaCop: string }
const permits = new WeakMap<Database.Database, Permit>();

export function withCreditPermit<T>(database: Database.Database, permit: Permit, action: () => T): T {
  if (permits.has(database)) throw new Error("Ya hay una operación de cartera en curso.");
  permits.set(database, permit);
  try { return action(); } finally { permits.delete(database); }
}

export function trackedTransaction<T>(database: Database.Database, kind: SyncOperation["kind"], userId: string | null, action: () => T) {
  return database.transaction(() => {
    if (settings(database).enabled !== 1n) return action();
    const id = randomUUID();
    database.prepare("UPDATE sync_context SET operation_id=? WHERE id=1").run(id);
    const result = action();
    const captured = database.prepare("SELECT table_name,row_key,payload FROM sync_capture WHERE operation_id=? ORDER BY rowid").all(id) as Array<{ table_name: SyncTable; row_key: string; payload: string }>;
    if (captured.length) {
      const changes = captured.map((r) => ({ table: r.table_name, key: r.row_key, row: JSON.parse(r.payload) as SyncRow, baseId: head(database, r.table_name, r.row_key) }));
      const ledger = changes.filter((c) => c.table === "client_credit_entries");
      const permit = permits.get(database);
      if (ledger.length) {
        const delta = ledger.reduce((total, c) => total + (c.row.entry_type === "sale_charge" ? 1n : -1n) * BigInt(c.row.amount_cop!), 0n);
        if (!permit || ledger.some((c) => c.row.client_id !== permit.clientId) || delta !== BigInt(permit.deltaCop)) throw new Error("Para registrar fiados o abonos compartidos se necesita autorización del servidor.");
      }
      const actor = userId ? database.prepare("SELECT id,username,role FROM pos_users WHERE id=? AND active=1 AND remote_actor=0").get(userId) as SyncOperation["actor"] : null;
      if (!actor) throw new Error("La operación compartida requiere un usuario identificado.");
      const operation = makeOperation(database, id, kind, changes, actor, permit?.id ?? null);
      validateSyncOperation(operation);
      queue(database, operation);
      if (permit && ledger.length) database.prepare("UPDATE sync_credit_intents SET committed=1,operation_id=? WHERE id=?").run(id, permit.id);
      if (changes.some((c) => c.table === "inventory_movements")) rebuildStock(database);
    }
    database.prepare("DELETE FROM sync_capture WHERE operation_id=?").run(id);
    database.prepare("UPDATE sync_context SET operation_id=NULL WHERE id=1").run();
    return result;
  });
}

export function rebuildStock(database: Database.Database): void {
  const totals = new Map<string, string[]>();
  for (const row of database.prepare("SELECT product_id,quantity_milli FROM inventory_movements").iterate() as Iterable<{ product_id: string; quantity_milli: bigint }>) {
    const values = totals.get(row.product_id) ?? [];
    values.push(row.quantity_milli.toString()); totals.set(row.product_id, values);
  }
  const update = database.prepare("UPDATE products SET stock_milli=? WHERE id=?");
  for (const [id, deltas] of totals) update.run(inventoryBalance(deltas).available, id);
}

export function signedStock(database: Database.Database, productId: string): bigint {
  const rows = database.prepare("SELECT quantity_milli FROM inventory_movements WHERE product_id=?").all(productId) as Array<{ quantity_milli: bigint }>;
  return inventoryBalance(rows.map((r) => r.quantity_milli.toString())).signed;
}

function head(database: Database.Database, table: SyncTable, key: string): string | null {
  return (database.prepare("SELECT operation_id FROM sync_heads WHERE table_name=? AND row_key=?").get(table,key) as { operation_id: string } | undefined)?.operation_id ?? null;
}

export function queue(database: Database.Database, operation: SyncOperation): void {
  database.prepare("INSERT INTO sync_outbox(operation_id,payload) VALUES(?,?)").run(operation.id,JSON.stringify(operation));
  for (const c of operation.changes) database.prepare("INSERT INTO sync_heads VALUES(?,?,?) ON CONFLICT(table_name,row_key) DO UPDATE SET operation_id=excluded.operation_id").run(c.table,c.key,operation.id);
}

export function makeOperation(database: Database.Database, id: string, kind: SyncOperation["kind"], changes: SyncChange[], actor: SyncOperation["actor"], creditReservationId: string | null = null): SyncOperation {
  const actors = new Map<string,{ id: string; username: string }>();
  for (const c of changes) for (const [field, value] of Object.entries(c.row)) {
    if (field.endsWith("_user_id") && value) {
      const user = database.prepare("SELECT id,username FROM pos_users WHERE id=?").get(value) as { id: string; username: string } | undefined;
      if (user) actors.set(user.id,user);
    }
  }
  return { id,kind,actor,actors:[...actors.values()],createdAt:new Date().toISOString(),creditReservationId,changes };
}

export function snapshotRows(database: Database.Database, table: SyncTable, where = "", args: string[] = []): SyncChange[] {
  const spec: SyncTableSpec = SYNC_TABLES[table];
  const columns = [...spec.text,...spec.integers];
  const rows = database.prepare(`SELECT ${columns.join(",")} FROM ${table} ${where}`).all(...args) as Record<string,unknown>[];
  return rows.map((data) => {
    const row = Object.fromEntries(columns.map((c) => [c, data[c] === null ? null : String(data[c])])) as SyncRow;
    const key = syncRowKey(table,row);
    return { table,key,row,baseId:head(database,table,key) };
  });
}

// Enrollment uploads the existing installation in dependency order. Each sale
// stays in one event; no history is reseeded on a retry or subsequent startup.
export function seedExistingDatabase(database: Database.Database): void {
  const append = (changes: SyncChange[]) => { if (changes.length) queue(database,makeOperation(database,randomUUID(),"bootstrap",changes,null)); };
  for (const c of snapshotRows(database,"products")) append([c,...snapshotRows(database,"inventory_movements","WHERE product_id=? AND type='initial'",[c.key])]);
  for (const c of snapshotRows(database,"clients")) append([c]);
  const sessions = snapshotRows(database,"cash_sessions");
  for (const c of sessions) append([c]);
  for (const c of snapshotRows(database,"sales")) append([c,...(["sale_buyer_snapshots","sale_items","sale_payments","client_credit_entries","inventory_movements"] as SyncTable[]).flatMap((table) => snapshotRows(database,table,"WHERE sale_id=?",[c.key]))]);
  for (const c of snapshotRows(database,"inventory_movements","WHERE sale_id IS NULL AND type!='initial'")) append([c]);
  for (const c of snapshotRows(database,"client_credit_entries","WHERE entry_type='payment'")) append([c]);
  for (const c of snapshotRows(database,"client_credit_limit_events")) append([c]);
  for (const c of sessions.filter((s) => s.row.status === "closed")) append([...snapshotRows(database,"cash_session_payment_totals","WHERE cash_session_id=?",[c.key]),...snapshotRows(database,"cash_session_credit_payment_totals","WHERE cash_session_id=?",[c.key])]);
}
