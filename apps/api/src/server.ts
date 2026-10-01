import { buildApp } from "./app.js";
import { migrateSyncDatabase, postgresDatabase } from "./sync/database.js";
import { SyncStore } from "./sync/syncStore.js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

let database:ReturnType<typeof postgresDatabase>|null=null;
try {
  const envPath=fileURLToPath(new URL("../../../.env",import.meta.url));
  if(existsSync(envPath))loadEnvFile(envPath);
  database=process.env.DATABASE_URL ? postgresDatabase(process.env.DATABASE_URL) : null;
  const sync=database ? new SyncStore(database,process.env.SYNC_PAIRING_KEY??"") : undefined;
  if(database)await migrateSyncDatabase(database);
  const app=buildApp({sync});
  if(database)app.addHook("onClose",async()=>database?.close());
  const host=process.env.HOST??"127.0.0.1",port=Number(process.env.PORT??3000);
  await app.listen({ host, port });
  console.log(`API escuchando en http://${host}:${port}`);
  for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{void app.close();});
} catch {
  // Connection errors may include a URL with credentials; never log the raw error.
  console.error("La API no pudo iniciar. Revisa puerto, conexión PostgreSQL y clave de vinculación en la configuración privada.");
  await database?.close();
  process.exitCode = 1;
}
