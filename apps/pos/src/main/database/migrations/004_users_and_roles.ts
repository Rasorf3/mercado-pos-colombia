import type Database from "better-sqlite3";

export const USERS_AND_ROLES_MIGRATION = {
  version: 4,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE pos_users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin_master', 'admin', 'employee_manager', 'employee')),
        active INTEGER NOT NULL CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT,
        CHECK(length(trim(username)) BETWEEN 3 AND 64),
        CHECK(length(password_salt) = 32),
        CHECK(length(password_hash) = 128)
      ) STRICT;

      CREATE INDEX pos_users_active_role ON pos_users(active, role);
      ALTER TABLE products ADD COLUMN created_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
      ALTER TABLE products ADD COLUMN updated_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
      ALTER TABLE inventory_movements ADD COLUMN created_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
      ALTER TABLE clients ADD COLUMN created_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
      ALTER TABLE clients ADD COLUMN updated_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
      ALTER TABLE sales ADD COLUMN created_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT;
    `);
  }
} as const;
