import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { SYNC_TABLES, SyncOperationSchema, type SyncEvent, type SyncTableSpec, type SyncTable } from "@mercado-pos/contracts";
import { Value } from "@sinclair/typebox/value";
import { canonicalJson } from "@mercado-pos/domain";
import { rebuildStock, settings, snapshotRows } from "./syncJournal.ts";

const order = Object.keys(SYNC_TABLES) as SyncTable[];
export function applySyncEvent(database:Database.Database,event:SyncEvent):void {
  if(!/^(0|[1-9][0-9]*)$/.test(event.sequence) || !Value.Check(SyncOperationSchema as never,event.operation)) throw new Error("El servidor devolvió una operación inválida.");
  database.transaction(()=>{
    if(database.prepare("SELECT 1 FROM sync_inbox WHERE operation_id=?").get(event.operation.id)) return;
    database.prepare("UPDATE sync_context SET importing=1 WHERE id=1").run();
    const pending=database.prepare("SELECT payload FROM sync_outbox WHERE acknowledged=0").all() as Array<{payload:string}>;
    const pendingKeys=new Set(pending.flatMap((p)=>JSON.parse(p.payload).changes.map((c:{table:string;key:string})=>`${c.table}:${c.key}`)));
    for(const actor of event.operation.actors) {
      const existing=database.prepare("SELECT 1 FROM pos_users WHERE id=?").get(actor.id);
      if(!existing) database.prepare("INSERT INTO pos_users(id,username,password_salt,password_hash,role,active,created_at,updated_at,remote_actor) VALUES(?,?,?,?,'employee',0,?,?,1)").run(actor.id,`${actor.username.slice(0,40)}@${event.deviceId.slice(0,8)}-${actor.id.slice(0,8)}`,randomBytes(16).toString("hex"),randomBytes(64).toString("hex"),event.operation.createdAt,event.operation.createdAt);
    }
    const changes=[...event.operation.changes].sort((a,b)=>order.indexOf(a.table)-order.indexOf(b.table));
    for(const c of changes) {
      const spec:SyncTableSpec=SYNC_TABLES[c.table];
      const currentHead=(database.prepare("SELECT operation_id FROM sync_heads WHERE table_name=? AND row_key=?").get(c.table,c.key) as {operation_id:string}|undefined)?.operation_id;
      if(spec.mutable && c.table!=="clients" && pendingKeys.has(`${c.table}:${c.key}`) && currentHead!==event.operation.id) continue;
      const where=spec.keys.map((key)=>`${key}=?`).join(" AND ");
      const keys=spec.keys.map((key)=>c.row[key]!);
      const existing=snapshotRows(database,c.table,`WHERE ${where}`,keys)[0];
      if(existing && canonicalJson(existing.row)===canonicalJson(c.row)) {
        database.prepare("INSERT INTO sync_heads VALUES(?,?,?) ON CONFLICT(table_name,row_key) DO UPDATE SET operation_id=excluded.operation_id").run(c.table,c.key,c.headId??event.operation.id);
        continue;
      }
      if(existing && !spec.mutable) throw new Error("Un registro histórico recibido difiere del guardado. La sincronización se detuvo para conservarlo.");
      const columns=[...spec.text,...spec.integers];
      const values=columns.map((field)=>c.row[field]===null ? null : spec.integers.includes(field) ? BigInt(c.row[field]!) : c.row[field]);
      if(!existing) {
        if(c.table==="products") { columns.push("stock_milli");values.push(0n); }
        database.prepare(`INSERT INTO ${c.table}(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...values);
      } else database.prepare(`UPDATE ${c.table} SET ${columns.map((col)=>`${col}=?`).join(",")} WHERE ${where}`).run(...values,...keys);
      database.prepare("INSERT INTO sync_heads VALUES(?,?,?) ON CONFLICT(table_name,row_key) DO UPDATE SET operation_id=excluded.operation_id").run(c.table,c.key,c.headId??event.operation.id);
    }
    if(settings(database).enabled===1n) rebuildStock(database);
    database.prepare("INSERT INTO sync_inbox VALUES(?,?)").run(event.operation.id,event.sequence);
    database.prepare("UPDATE sync_context SET importing=0 WHERE id=1").run();
  }).immediate();
}
