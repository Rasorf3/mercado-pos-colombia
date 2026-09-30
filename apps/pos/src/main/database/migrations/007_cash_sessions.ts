import type Database from "better-sqlite3";

export const CASH_SESSIONS_MIGRATION = {
  version: 7,
  apply(database: Database.Database): void {
    database.exec(`
      CREATE TABLE cash_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
        opening_cash_cop INTEGER NOT NULL CHECK(opening_cash_cop >= 0),
        opened_at TEXT NOT NULL,
        opened_by_user_id TEXT NOT NULL REFERENCES pos_users(id) ON DELETE RESTRICT,
        closed_at TEXT,
        closed_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT,
        expected_cash_cop INTEGER CHECK(expected_cash_cop IS NULL OR expected_cash_cop >= 0),
        counted_cash_cop INTEGER CHECK(counted_cash_cop IS NULL OR counted_cash_cop >= 0),
        variance_cash_cop INTEGER,
        sales_count INTEGER CHECK(sales_count IS NULL OR sales_count >= 0),
        total_sales_cop INTEGER CHECK(total_sales_cop IS NULL OR total_sales_cop >= 0),
        cash_sales_cop INTEGER CHECK(cash_sales_cop IS NULL OR cash_sales_cop >= 0),
        CHECK(
          (status = 'open'
            AND closed_at IS NULL AND closed_by_user_id IS NULL
            AND expected_cash_cop IS NULL AND counted_cash_cop IS NULL
            AND variance_cash_cop IS NULL AND sales_count IS NULL
            AND total_sales_cop IS NULL AND cash_sales_cop IS NULL)
          OR
          (status = 'closed'
            AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL
            AND expected_cash_cop IS NOT NULL AND counted_cash_cop IS NOT NULL
            AND variance_cash_cop IS NOT NULL AND sales_count IS NOT NULL
            AND total_sales_cop IS NOT NULL AND cash_sales_cop IS NOT NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX cash_sessions_one_open
        ON cash_sessions(status) WHERE status = 'open';
      CREATE INDEX cash_sessions_opened_at ON cash_sessions(opened_at DESC);

      CREATE TABLE cash_session_payment_totals (
        cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        method_id TEXT NOT NULL CHECK(method_id IN (
          'cash', 'debit_card', 'credit_card', 'bank_transfer', 'nequi', 'daviplata', 'bre_b'
        )),
        total_cop INTEGER NOT NULL CHECK(total_cop >= 0),
        sales_count INTEGER NOT NULL CHECK(sales_count > 0),
        PRIMARY KEY (cash_session_id, method_id)
      ) STRICT;

      CREATE TRIGGER cash_session_payment_totals_immutable_update
      BEFORE UPDATE ON cash_session_payment_totals
      BEGIN SELECT RAISE(ABORT, 'cash session payment totals are immutable'); END;

      CREATE TRIGGER cash_session_payment_totals_immutable_delete
      BEFORE DELETE ON cash_session_payment_totals
      BEGIN SELECT RAISE(ABORT, 'cash session payment totals are immutable'); END;

      CREATE TRIGGER cash_sessions_close_once
      BEFORE UPDATE ON cash_sessions
      WHEN OLD.status != 'open' OR NEW.status != 'closed'
        OR NEW.id != OLD.id
        OR NEW.opening_cash_cop != OLD.opening_cash_cop
        OR NEW.opened_at != OLD.opened_at
        OR NEW.opened_by_user_id != OLD.opened_by_user_id
        OR NEW.closed_at IS NULL OR NEW.closed_by_user_id IS NULL
        OR NEW.expected_cash_cop IS NULL OR NEW.counted_cash_cop IS NULL
        OR NEW.variance_cash_cop IS NULL OR NEW.sales_count IS NULL
        OR NEW.total_sales_cop IS NULL OR NEW.cash_sales_cop IS NULL
        OR NEW.variance_cash_cop != NEW.counted_cash_cop - NEW.expected_cash_cop
      BEGIN SELECT RAISE(ABORT, 'cash session close snapshot is invalid or immutable'); END;

      CREATE TRIGGER cash_sessions_immutable_delete
      BEFORE DELETE ON cash_sessions
      BEGIN SELECT RAISE(ABORT, 'cash sessions are immutable'); END;

      ALTER TABLE sales ADD COLUMN cash_session_id TEXT
        REFERENCES cash_sessions(id) ON DELETE RESTRICT;
      CREATE INDEX sales_cash_session ON sales(cash_session_id, created_at);
    `);
  }
} as const;
