import type Database from "better-sqlite3";

export const CLIENT_CREDIT_MIGRATION = {
  version: 8,
  apply(database: Database.Database): void {
    database.exec(`
      ALTER TABLE clients ADD COLUMN phone TEXT
        CHECK(phone IS NULL OR length(trim(phone)) BETWEEN 1 AND 32);
      ALTER TABLE clients ADD COLUMN address TEXT
        CHECK(address IS NULL OR length(trim(address)) BETWEEN 1 AND 240);
      ALTER TABLE clients ADD COLUMN credit_limit_cop INTEGER NOT NULL DEFAULT 300000
        CHECK(credit_limit_cop >= 0);

      ALTER TABLE sale_buyer_snapshots ADD COLUMN phone TEXT
        CHECK(phone IS NULL OR length(trim(phone)) BETWEEN 1 AND 32);
      ALTER TABLE sale_buyer_snapshots ADD COLUMN address TEXT
        CHECK(address IS NULL OR length(trim(address)) BETWEEN 1 AND 240);

      ALTER TABLE sales ADD COLUMN settlement_type TEXT NOT NULL DEFAULT 'paid'
        CHECK(settlement_type IN ('paid', 'on_account'));

      CREATE TABLE client_credit_entries (
        id TEXT PRIMARY KEY NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        entry_type TEXT NOT NULL CHECK(entry_type IN ('sale_charge', 'payment')),
        sale_id TEXT UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
        cash_session_id TEXT REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        amount_cop INTEGER NOT NULL CHECK(amount_cop > 0),
        method_id TEXT CHECK(method_id IS NULL OR method_id IN (
          'cash', 'debit_card', 'credit_card', 'bank_transfer', 'nequi', 'daviplata', 'bre_b'
        )),
        reference TEXT CHECK(reference IS NULL OR (length(trim(reference)) > 0 AND length(reference) <= 120)),
        authorization_code TEXT CHECK(authorization_code IS NULL OR (length(trim(authorization_code)) > 0 AND length(authorization_code) <= 64)),
        created_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        CHECK(
          (entry_type = 'sale_charge' AND sale_id IS NOT NULL AND cash_session_id IS NULL
            AND method_id IS NULL AND reference IS NULL AND authorization_code IS NULL)
          OR (entry_type = 'payment' AND sale_id IS NULL AND method_id IS NOT NULL)
        ),
        CHECK(reference IS NULL OR method_id IN ('bank_transfer', 'nequi', 'daviplata', 'bre_b')),
        CHECK(authorization_code IS NULL OR method_id IN ('debit_card', 'credit_card'))
      ) STRICT;

      CREATE INDEX client_credit_entries_client_created
        ON client_credit_entries(client_id, created_at DESC, id DESC);
      CREATE INDEX client_credit_entries_sale
        ON client_credit_entries(sale_id) WHERE sale_id IS NOT NULL;
      CREATE INDEX client_credit_entries_cash_session
        ON client_credit_entries(cash_session_id, method_id) WHERE cash_session_id IS NOT NULL;

      ALTER TABLE cash_sessions ADD COLUMN credit_payments_cop INTEGER NOT NULL DEFAULT 0
        CHECK(credit_payments_cop >= 0);
      ALTER TABLE cash_sessions ADD COLUMN cash_credit_payments_cop INTEGER NOT NULL DEFAULT 0
        CHECK(cash_credit_payments_cop >= 0);

      CREATE TABLE cash_session_credit_payment_totals (
        cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
        method_id TEXT NOT NULL CHECK(method_id IN (
          'cash', 'debit_card', 'credit_card', 'bank_transfer', 'nequi', 'daviplata', 'bre_b'
        )),
        total_cop INTEGER NOT NULL CHECK(total_cop > 0),
        payments_count INTEGER NOT NULL CHECK(payments_count > 0),
        PRIMARY KEY (cash_session_id, method_id)
      ) STRICT;

      CREATE TABLE client_credit_limit_events (
        id TEXT PRIMARY KEY NOT NULL,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        previous_limit_cop INTEGER NOT NULL CHECK(previous_limit_cop >= 0),
        new_limit_cop INTEGER NOT NULL CHECK(new_limit_cop >= 0),
        changed_by_user_id TEXT REFERENCES pos_users(id) ON DELETE RESTRICT,
        created_at TEXT NOT NULL,
        CHECK(previous_limit_cop != new_limit_cop)
      ) STRICT;

      CREATE INDEX client_credit_limit_events_client_created
        ON client_credit_limit_events(client_id, created_at DESC);

      CREATE TRIGGER client_credit_limit_not_below_balance
      BEFORE UPDATE OF credit_limit_cop ON clients
      WHEN NEW.credit_limit_cop < COALESCE((
        SELECT SUM(CASE WHEN entry_type = 'sale_charge' THEN amount_cop ELSE -amount_cop END)
        FROM client_credit_entries WHERE client_id = OLD.id
      ), 0)
      BEGIN SELECT RAISE(ABORT, 'credit limit cannot be lower than current balance'); END;

      CREATE TRIGGER cash_sessions_credit_close_validate
      BEFORE UPDATE ON cash_sessions
      WHEN NEW.status = 'closed' AND (
        NEW.credit_payments_cop != COALESCE((
          SELECT SUM(amount_cop) FROM client_credit_entries
          WHERE cash_session_id = OLD.id AND entry_type = 'payment'
        ), 0)
        OR NEW.cash_credit_payments_cop != COALESCE((
          SELECT SUM(amount_cop) FROM client_credit_entries
          WHERE cash_session_id = OLD.id AND entry_type = 'payment' AND method_id = 'cash'
        ), 0)
        OR NEW.expected_cash_cop != OLD.opening_cash_cop + COALESCE((
          SELECT SUM(p.amount_paid_cop - p.change_cop)
          FROM sales s JOIN sale_payments p ON p.sale_id = s.id
          WHERE s.cash_session_id = OLD.id AND p.method_id = 'cash'
        ), 0) + NEW.cash_credit_payments_cop
      )
      BEGIN SELECT RAISE(ABORT, 'cash session receipt snapshot is invalid'); END;

      CREATE TRIGGER cash_session_credit_totals_immutable_update
      BEFORE UPDATE ON cash_session_credit_payment_totals
      BEGIN SELECT RAISE(ABORT, 'cash session credit totals are immutable'); END;
      CREATE TRIGGER cash_session_credit_totals_immutable_delete
      BEFORE DELETE ON cash_session_credit_payment_totals
      BEGIN SELECT RAISE(ABORT, 'cash session credit totals are immutable'); END;

      CREATE TRIGGER sales_settlement_immutable
      BEFORE UPDATE OF settlement_type ON sales
      WHEN NEW.settlement_type != OLD.settlement_type
      BEGIN SELECT RAISE(ABORT, 'sale settlement type is immutable'); END;

      CREATE TRIGGER sale_payment_requires_paid_settlement
      BEFORE INSERT ON sale_payments
      WHEN (SELECT settlement_type FROM sales WHERE id = NEW.sale_id) != 'paid'
      BEGIN SELECT RAISE(ABORT, 'on-account sales cannot have a sale payment'); END;

      CREATE TRIGGER client_credit_charge_validate
      BEFORE INSERT ON client_credit_entries
      WHEN NEW.entry_type = 'sale_charge'
      BEGIN
        SELECT CASE WHEN (SELECT settlement_type FROM sales WHERE id = NEW.sale_id) != 'on_account'
          THEN RAISE(ABORT, 'credit charge requires an on-account sale') END;
        SELECT CASE WHEN NEW.amount_cop != (SELECT total_cop FROM sales WHERE id = NEW.sale_id)
          THEN RAISE(ABORT, 'credit charge must match sale total') END;
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM sale_buyer_snapshots
          WHERE sale_id = NEW.sale_id AND client_id = NEW.client_id
        ) THEN RAISE(ABORT, 'credit charge buyer does not match sale buyer') END;
        SELECT CASE WHEN EXISTS (SELECT 1 FROM sale_payments WHERE sale_id = NEW.sale_id)
          THEN RAISE(ABORT, 'credit sale cannot also have a payment') END;
        SELECT CASE WHEN
          NEW.amount_cop + COALESCE((
            SELECT SUM(CASE WHEN entry_type = 'sale_charge' THEN amount_cop ELSE -amount_cop END)
            FROM client_credit_entries WHERE client_id = NEW.client_id
          ), 0) > (SELECT credit_limit_cop FROM clients WHERE id = NEW.client_id)
          THEN RAISE(ABORT, 'client credit limit exceeded') END;
      END;

      CREATE TRIGGER client_credit_payment_validate
      BEFORE INSERT ON client_credit_entries
      WHEN NEW.entry_type = 'payment'
      BEGIN
        SELECT CASE WHEN NEW.amount_cop > COALESCE((
          SELECT SUM(CASE WHEN entry_type = 'sale_charge' THEN amount_cop ELSE -amount_cop END)
          FROM client_credit_entries WHERE client_id = NEW.client_id
        ), 0) THEN RAISE(ABORT, 'credit payment exceeds current balance') END;
      END;

      CREATE TRIGGER client_credit_entries_immutable_update
      BEFORE UPDATE ON client_credit_entries
      BEGIN SELECT RAISE(ABORT, 'client credit entries are immutable'); END;
      CREATE TRIGGER client_credit_entries_immutable_delete
      BEFORE DELETE ON client_credit_entries
      BEGIN SELECT RAISE(ABORT, 'client credit entries are immutable'); END;
      CREATE TRIGGER client_credit_limit_events_immutable_update
      BEFORE UPDATE ON client_credit_limit_events
      BEGIN SELECT RAISE(ABORT, 'client credit limit events are immutable'); END;
      CREATE TRIGGER client_credit_limit_events_immutable_delete
      BEFORE DELETE ON client_credit_limit_events
      BEGIN SELECT RAISE(ABORT, 'client credit limit events are immutable'); END;
    `);
  }
} as const;
