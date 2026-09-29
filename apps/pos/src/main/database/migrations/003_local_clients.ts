import type Database from "better-sqlite3";

export const LOCAL_CLIENTS_MIGRATION = {
  version: 3,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
        document_type TEXT,
        document_number TEXT,
        email TEXT,
        active INTEGER NOT NULL CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK((document_type IS NULL) = (document_number IS NULL)),
        CHECK(document_type IS NULL OR length(trim(document_type)) BETWEEN 1 AND 32),
        CHECK(document_number IS NULL OR length(trim(document_number)) BETWEEN 1 AND 64),
        CHECK(email IS NULL OR length(trim(email)) BETWEEN 3 AND 254)
      ) STRICT;

      CREATE UNIQUE INDEX clients_document_unique
        ON clients(lower(document_type), lower(document_number))
        WHERE document_type IS NOT NULL AND document_number IS NOT NULL;
      CREATE INDEX clients_name_search ON clients(name COLLATE NOCASE);
      CREATE INDEX clients_email_search ON clients(email COLLATE NOCASE);

      CREATE TABLE sale_buyer_snapshots (
        sale_id TEXT PRIMARY KEY NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
        client_id TEXT REFERENCES clients(id) ON DELETE RESTRICT,
        buyer_name TEXT,
        document_type TEXT,
        document_number TEXT,
        email TEXT,
        created_at TEXT NOT NULL,
        CHECK((document_type IS NULL) = (document_number IS NULL)),
        CHECK(
          (client_id IS NULL AND buyer_name IS NULL AND document_type IS NULL
            AND document_number IS NULL AND email IS NULL)
          OR (client_id IS NOT NULL AND buyer_name IS NOT NULL
            AND length(trim(buyer_name)) BETWEEN 1 AND 120)
        )
      ) STRICT;

      INSERT INTO sale_buyer_snapshots (
        sale_id, client_id, buyer_name, document_type, document_number, email, created_at
      )
      SELECT id, NULL, NULL, NULL, NULL, NULL, created_at FROM sales;

      CREATE TRIGGER sale_buyer_snapshot_immutable_update
      BEFORE UPDATE ON sale_buyer_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'sale buyer snapshot is immutable');
      END;

      CREATE TRIGGER sale_buyer_snapshot_immutable_delete
      BEFORE DELETE ON sale_buyer_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'sale buyer snapshot is immutable');
      END;
    `);
  }
} as const;
