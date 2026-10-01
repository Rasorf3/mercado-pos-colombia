import { Pool } from "pg";

export interface SqlConnection { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> }
export interface SyncDatabase extends SqlConnection { transaction<T>(action: (connection: SqlConnection) => Promise<T>): Promise<T>; close(): Promise<void> }

export function postgresDatabase(connectionString: string): SyncDatabase {
  const pool = new Pool({ connectionString, max:10, connectionTimeoutMillis:5000 });
  return {
    query: async (sql, values) => pool.query(sql,values),
    transaction: async (action) => {
      const client = await pool.connect();
      try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    close: async () => pool.end()
  };
}

export async function migrateSyncDatabase(database: SyncDatabase): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.query(`
      CREATE TABLE IF NOT EXISTS sync_schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS sync_merchants(id UUID PRIMARY KEY, seed_owner UUID);
      CREATE TABLE IF NOT EXISTS sync_devices(merchant_id UUID NOT NULL REFERENCES sync_merchants(id), id UUID NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT true, bootstrap_allowed BOOLEAN NOT NULL DEFAULT false, PRIMARY KEY(merchant_id,id));
      CREATE TABLE IF NOT EXISTS sync_entities(merchant_id UUID NOT NULL REFERENCES sync_merchants(id), table_name TEXT NOT NULL, row_key TEXT NOT NULL, data JSONB NOT NULL, head UUID NOT NULL, source_device_id UUID NOT NULL, PRIMARY KEY(merchant_id,table_name,row_key));
      CREATE UNIQUE INDEX IF NOT EXISTS sync_unique_barcode ON sync_entities(merchant_id,(data->>'barcode')) WHERE table_name='products' AND data->>'barcode' IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS sync_unique_client ON sync_entities(merchant_id,lower(data->>'document_type'),lower(data->>'document_number')) WHERE table_name='clients' AND data->>'document_type' IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS sync_initial_stock ON sync_entities(merchant_id,(data->>'product_id')) WHERE table_name='inventory_movements' AND data->>'type'='initial';
      CREATE TABLE IF NOT EXISTS sync_events(sequence BIGSERIAL PRIMARY KEY, merchant_id UUID NOT NULL REFERENCES sync_merchants(id), operation_id UUID NOT NULL, device_id UUID NOT NULL, request_hash TEXT NOT NULL, payload JSONB NOT NULL, UNIQUE(merchant_id,operation_id));
      CREATE INDEX IF NOT EXISTS sync_events_feed ON sync_events(merchant_id,sequence);
      CREATE TABLE IF NOT EXISTS sync_data_conflicts(id UUID PRIMARY KEY, merchant_id UUID NOT NULL REFERENCES sync_merchants(id), entity_id TEXT NOT NULL, payload JSONB NOT NULL, resolved BOOLEAN NOT NULL DEFAULT false, reviewed_by JSONB, review_note TEXT);
      CREATE TABLE IF NOT EXISTS sync_credit_reservations(merchant_id UUID NOT NULL REFERENCES sync_merchants(id), id UUID NOT NULL, device_id UUID NOT NULL, client_id UUID NOT NULL, delta_cop BIGINT NOT NULL CHECK(delta_cop!=0), state TEXT NOT NULL CHECK(state IN ('reserved','consumed','cancelled')), PRIMARY KEY(merchant_id,id));
      INSERT INTO sync_schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
    `);
  });
}
