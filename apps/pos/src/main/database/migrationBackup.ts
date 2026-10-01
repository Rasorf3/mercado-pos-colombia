import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

// VACUUM INTO reads a consistent SQLite snapshot, including committed WAL pages.
// The retained file permits an offline rollback to v9 without reversing business data.
export function retainPreSyncBackup(database: Database.Database, filePath: string): string | null {
  if (filePath === ":memory:") return null;
  const old = database.prepare("SELECT 1 FROM schema_migrations WHERE version=9").get();
  const migrated = database.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get();
  if (!old || migrated) return null;
  return retainVerifiedBackup(database,filePath,"pre-sync-v9");
}

export function retainPreEnrollmentBackup(database:Database.Database):string|null {
  return database.name===":memory:" ? null : retainVerifiedBackup(database,database.name,"pre-enrollment");
}

function retainVerifiedBackup(database:Database.Database,filePath:string,label:"pre-sync-v9"|"pre-enrollment"):string {
  const backupPath = `${filePath}.${label}-${randomUUID()}.sqlite`;
  database.prepare("VACUUM INTO ?").run(backupPath);
  const backup = new Database(backupPath, { readonly: true });
  try {
    if (backup.pragma("quick_check", { simple: true }) !== "ok") throw new Error("No se pudo verificar el respaldo previo a la migración.");
  } finally { backup.close(); }
  return backupPath;
}
