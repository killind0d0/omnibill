use rusqlite::{Connection, Result};

pub const LATEST_VERSION: i32 = 4;

pub struct Migration {
    pub version: i32,
    pub description: &'static str,
    pub sql: &'static str,
}

pub static MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "Initial V2 REA and Ledger schema with immutability triggers",
        sql: SCHEMA_V2_SQL,
    },
    Migration {
        version: 2,
        description: "Hardening triggers for transaction_items, payments, payment_allocations, and transactions update guard",
        sql: MIGRATION_2_SQL,
    },
    Migration {
        version: 3,
        description: "Schema additions for posting engine: transaction types, original id, invoice date, round off, invariant triggers, and guards",
        sql: MIGRATION_3_SQL,
    },
    Migration {
        version: 4,
        description: "Lot cost price, transaction price mode, negative stock trigger, and performance indexes",
        sql: MIGRATION_4_SQL,
    },
];

pub const SCHEMA_V2_SQL: &str = r#"
-- 1. BUSINESS PROFILE
CREATE TABLE IF NOT EXISTS business_profiles (
    id TEXT PRIMARY KEY,
    legal_name TEXT NOT NULL,
    trade_name TEXT,
    gstin TEXT,
    state_code TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address_line1 TEXT NOT NULL,
    city TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    upi_vpa TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'CASHIER')),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. ACCOUNTS (No stored balance column)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 4. ENTITIES (Agents: Customers, Suppliers, Patients, Students)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    entity_code TEXT UNIQUE NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('CUSTOMER', 'SUPPLIER', 'PATIENT', 'STUDENT')),
    full_name TEXT NOT NULL,
    phone TEXT,
    gstin TEXT,
    state_code TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. RESOURCES (Goods, Services, Tuition Fees, Ward Charges)
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    sku_or_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    hsn_sac TEXT NOT NULL,
    tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps >= 0),
    base_price_paise INTEGER NOT NULL CHECK (base_price_paise >= 0),
    cost_price_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_paise >= 0),
    is_stock_tracked INTEGER NOT NULL DEFAULT 1 CHECK (is_stock_tracked IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. RESOURCE LOTS
CREATE TABLE IF NOT EXISTS resource_lots (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    batch_number TEXT NOT NULL,
    expiry_date TEXT,
    mrp_paise INTEGER NOT NULL CHECK (mrp_paise >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(resource_id, batch_number)
);

-- 7. NUMBER SERIES (Gapless GST compliant numbering)
CREATE TABLE IF NOT EXISTS number_series (
    id TEXT PRIMARY KEY,
    series_code TEXT NOT NULL,
    financial_year TEXT NOT NULL,
    prefix TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 0),
    padding INTEGER NOT NULL DEFAULT 4 CHECK (padding >= 1 AND padding <= 10),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    UNIQUE(series_code, financial_year)
);

-- 8. TRANSACTIONS
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('POSTED', 'CANCELLED')),
    seller_state_code TEXT NOT NULL,
    place_of_supply_state_code TEXT NOT NULL,
    series TEXT NOT NULL,
    invoice_number TEXT UNIQUE NOT NULL CHECK (length(invoice_number) <= 16),
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
    subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
    discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
    taxable_paise INTEGER NOT NULL CHECK (taxable_paise >= 0),
    cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
    sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
    igst_paise INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
    total_amount_paise INTEGER NOT NULL CHECK (total_amount_paise >= 0),
    notes TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 9. TRANSACTION ITEMS
CREATE TABLE IF NOT EXISTS transaction_items (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    lot_id TEXT REFERENCES resource_lots(id) ON DELETE RESTRICT,
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
    unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
    discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
    taxable_paise INTEGER NOT NULL CHECK (taxable_paise >= 0),
    tax_rate_bps INTEGER NOT NULL CHECK (tax_rate_bps >= 0),
    cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
    sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
    igst_paise INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
    line_total_paise INTEGER NOT NULL CHECK (line_total_paise >= 0)
);

-- 10. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    payment_number TEXT UNIQUE NOT NULL,
    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
    payment_mode TEXT NOT NULL CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    reference_number TEXT,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 11. PAYMENT ALLOCATIONS
CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    amount_allocated_paise INTEGER NOT NULL CHECK (amount_allocated_paise > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 12. LEDGER ENTRIES
CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
    payment_id TEXT REFERENCES payments(id) ON DELETE RESTRICT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    debit_paise INTEGER NOT NULL CHECK (debit_paise >= 0),
    credit_paise INTEGER NOT NULL CHECK (credit_paise >= 0),
    narration TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        debit_paise >= 0 AND credit_paise >= 0 AND
        ((debit_paise > 0 AND credit_paise = 0) OR (debit_paise = 0 AND credit_paise > 0))
    ),
    CHECK (transaction_id IS NOT NULL OR payment_id IS NOT NULL)
);

-- 13. STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    lot_id TEXT REFERENCES resource_lots(id) ON DELETE RESTRICT,
    transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason IN ('SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT', 'DAMAGE')),
    quantity_delta_milli INTEGER NOT NULL CHECK (quantity_delta_milli != 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 14. IMMUTABILITY AUDIT TRIGGERS
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on ledger_entries is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on ledger_entries is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_update
BEFORE UPDATE ON stock_movements
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on stock_movements is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_delete
BEFORE DELETE ON stock_movements
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on stock_movements is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on transactions is forbidden; mark as CANCELLED instead.');
END;

CREATE TRIGGER IF NOT EXISTS trg_transaction_items_no_delete
BEFORE DELETE ON transaction_items
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on transaction_items is forbidden.');
END;
"#;

pub const MIGRATION_2_SQL: &str = r#"
-- 1. Trigger blocking ALL UPDATE on transaction_items
CREATE TRIGGER IF NOT EXISTS trg_transaction_items_no_update
BEFORE UPDATE ON transaction_items
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on transaction_items is forbidden.');
END;

-- 2. Triggers blocking UPDATE and DELETE on payments
CREATE TRIGGER IF NOT EXISTS trg_payments_no_update
BEFORE UPDATE ON payments
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on payments is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_payments_no_delete
BEFORE DELETE ON payments
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on payments is forbidden.');
END;

-- 3. Triggers blocking UPDATE and DELETE on payment_allocations
CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_no_update
BEFORE UPDATE ON payment_allocations
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on payment_allocations is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_allocations_no_delete
BEFORE DELETE ON payment_allocations
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on payment_allocations is forbidden.');
END;

-- 4. Trigger on transactions: UPDATE is allowed ONLY when every column except `status` is unchanged,
--    and status may only go POSTED -> CANCELLED. Any other UPDATE raises IMMUTABILITY_RULE_BROKEN.
CREATE TRIGGER IF NOT EXISTS trg_transactions_update_guard
BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Only status transition from POSTED to CANCELLED is allowed; all other columns must remain unchanged.')
    WHERE NOT (
        OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' AND
        OLD.id IS NEW.id AND
        OLD.seller_state_code IS NEW.seller_state_code AND
        OLD.place_of_supply_state_code IS NEW.place_of_supply_state_code AND
        OLD.series IS NEW.series AND
        OLD.invoice_number IS NEW.invoice_number AND
        OLD.entity_id IS NEW.entity_id AND
        OLD.subtotal_paise IS NEW.subtotal_paise AND
        OLD.discount_paise IS NEW.discount_paise AND
        OLD.taxable_paise IS NEW.taxable_paise AND
        OLD.cgst_paise IS NEW.cgst_paise AND
        OLD.sgst_paise IS NEW.sgst_paise AND
        OLD.igst_paise IS NEW.igst_paise AND
        OLD.total_amount_paise IS NEW.total_amount_paise AND
        OLD.notes IS NEW.notes AND
        OLD.created_by_user_id IS NEW.created_by_user_id AND
        OLD.created_at IS NEW.created_at
    );
END;
"#;

pub const MIGRATION_3_SQL: &str = r#"
-- ============================================================================
-- 1. ADD MANDATORY COLUMNS TO TRANSACTIONS
-- Note on SQLite ALTER TABLE ADD COLUMN:
-- SQLite does not permit adding a column with NOT NULL unless a non-null DEFAULT
-- is specified. For mandatory columns where a default would hide missing data,
-- we enforce non-nullability and valid domains using CHECK(col IS NOT NULL AND ...).
-- ============================================================================

-- (a) transaction_type: SALE, SALE_RETURN, PURCHASE, PURCHASE_RETURN (mandatory)
ALTER TABLE transactions ADD COLUMN transaction_type TEXT CHECK(
    transaction_type IS NOT NULL AND transaction_type IN ('SALE', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_RETURN')
);

-- (b) original_transaction_id: FK to transactions(id) ON DELETE RESTRICT;
--     mandatory for SALE_RETURN and PURCHASE_RETURN, must be NULL for SALE and PURCHASE.
ALTER TABLE transactions ADD COLUMN original_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT CHECK(
    (transaction_type IN ('SALE_RETURN', 'PURCHASE_RETURN') AND original_transaction_id IS NOT NULL)
    OR
    (transaction_type IN ('SALE', 'PURCHASE') AND original_transaction_id IS NULL)
);

-- (c) invoice_date: TEXT 'YYYY-MM-DD', local business date (mandatory, format CHECK)
ALTER TABLE transactions ADD COLUMN invoice_date TEXT CHECK(
    invoice_date IS NOT NULL AND length(invoice_date) = 10 AND invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
);

-- (d) round_off_paise: INTEGER NOT NULL DEFAULT 0, allowed range -99..99
ALTER TABLE transactions ADD COLUMN round_off_paise INTEGER NOT NULL DEFAULT 0 CHECK(
    round_off_paise >= -99 AND round_off_paise <= 99
);

-- ============================================================================
-- 2. DROP AND RECREATE trg_transactions_update_guard (COVERING EVERY COLUMN)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_transactions_update_guard;

CREATE TRIGGER IF NOT EXISTS trg_transactions_update_guard
BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Only status transition from POSTED to CANCELLED is allowed; all other columns must remain unchanged.')
    WHERE NOT (
        OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' AND
        OLD.id IS NEW.id AND
        OLD.seller_state_code IS NEW.seller_state_code AND
        OLD.place_of_supply_state_code IS NEW.place_of_supply_state_code AND
        OLD.series IS NEW.series AND
        OLD.invoice_number IS NEW.invoice_number AND
        OLD.entity_id IS NEW.entity_id AND
        OLD.subtotal_paise IS NEW.subtotal_paise AND
        OLD.discount_paise IS NEW.discount_paise AND
        OLD.taxable_paise IS NEW.taxable_paise AND
        OLD.cgst_paise IS NEW.cgst_paise AND
        OLD.sgst_paise IS NEW.sgst_paise AND
        OLD.igst_paise IS NEW.igst_paise AND
        OLD.total_amount_paise IS NEW.total_amount_paise AND
        OLD.notes IS NEW.notes AND
        OLD.created_by_user_id IS NEW.created_by_user_id AND
        OLD.created_at IS NEW.created_at AND
        OLD.transaction_type IS NEW.transaction_type AND
        OLD.original_transaction_id IS NEW.original_transaction_id AND
        OLD.invoice_date IS NEW.invoice_date AND
        OLD.round_off_paise IS NEW.round_off_paise
    );
END;

-- ============================================================================
-- 3. BEFORE INSERT INVARIANT TRIGGERS
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_transactions_before_insert_invariants
BEFORE INSERT ON transactions
BEGIN
    -- (a) subtotal_paise - discount_paise = taxable_paise
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: subtotal_paise - discount_paise must equal taxable_paise')
    WHERE (NEW.subtotal_paise - NEW.discount_paise) != NEW.taxable_paise;

    -- (b) total_amount_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: total_amount_paise must equal taxable_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise')
    WHERE NEW.total_amount_paise != (NEW.taxable_paise + NEW.cgst_paise + NEW.sgst_paise + NEW.igst_paise + NEW.round_off_paise);

    -- (c) State-based GST exclusivity:
    -- If seller_state_code = place_of_supply_state_code, IGST must be 0
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: Intra-state transaction cannot have IGST')
    WHERE NEW.seller_state_code = NEW.place_of_supply_state_code AND NEW.igst_paise != 0;

    -- Otherwise, CGST and SGST must be 0
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: Inter-state transaction cannot have CGST or SGST')
    WHERE NEW.seller_state_code != NEW.place_of_supply_state_code AND (NEW.cgst_paise != 0 OR NEW.sgst_paise != 0);
END;

CREATE TRIGGER IF NOT EXISTS trg_transaction_items_before_insert_invariants
BEFORE INSERT ON transaction_items
BEGIN
    -- (a) line_total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: line_total_paise must equal taxable_paise + cgst_paise + sgst_paise + igst_paise')
    WHERE NEW.line_total_paise != (NEW.taxable_paise + NEW.cgst_paise + NEW.sgst_paise + NEW.igst_paise);

    -- (b) cgst_paise = sgst_paise
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: cgst_paise must equal sgst_paise')
    WHERE NEW.cgst_paise != NEW.sgst_paise;

    -- (c) igst_paise must be 0 when cgst_paise > 0
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: igst_paise must be 0 when cgst_paise > 0')
    WHERE NEW.cgst_paise > 0 AND NEW.igst_paise != 0;
END;

-- ============================================================================
-- 4. SEED CHART OF ACCOUNTS WITH FIXED CODES/IDS
-- ============================================================================
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_1000', '1000', 'Cash in Hand', 'ASSET');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_1010', '1010', 'Bank and Digital Receipts', 'ASSET');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_1100', '1100', 'Accounts Receivable', 'ASSET');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_1200', '1200', 'Inventory', 'ASSET');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_2000', '2000', 'Accounts Payable', 'LIABILITY');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_2100', '2100', 'Output CGST', 'LIABILITY');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_2110', '2110', 'Output SGST', 'LIABILITY');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_2120', '2120', 'Output IGST', 'LIABILITY');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_4000', '4000', 'Sales Revenue', 'REVENUE');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_4010', '4010', 'Sales Returns', 'REVENUE');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_4900', '4900', 'Round Off', 'EXPENSE');
INSERT OR IGNORE INTO accounts (id, code, name, type) VALUES ('acc_5000', '5000', 'Cost of Goods Sold', 'EXPENSE');

-- ============================================================================
-- 5. ACCOUNTS GUARD TRIGGER
-- Blocks UPDATE of code or type when the account already has ledger_entries.
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_accounts_update_guard
BEFORE UPDATE OF code, type ON accounts
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Cannot update code or type of an account that has ledger entries.')
    WHERE (OLD.code != NEW.code OR OLD.type != NEW.type)
      AND EXISTS (SELECT 1 FROM ledger_entries WHERE account_id = OLD.id);
END;

-- ============================================================================
-- 6. NUMBER_SERIES GUARD TRIGGERS
-- DELETE blocked. UPDATE allowed only when next_number = OLD.next_number + 1
-- with series_code, financial_year, prefix, padding unchanged, OR when only
-- is_active changes.
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_number_series_no_delete
BEFORE DELETE ON number_series
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on number_series is forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_number_series_update_guard
BEFORE UPDATE ON number_series
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: number_series updates allowed only for sequential progression (next_number = OLD.next_number + 1) or is_active toggle.')
    WHERE NOT (
        -- Sequential progression (+1)
        (
            NEW.next_number = OLD.next_number + 1 AND
            OLD.id IS NEW.id AND
            OLD.series_code IS NEW.series_code AND
            OLD.financial_year IS NEW.financial_year AND
            OLD.prefix IS NEW.prefix AND
            OLD.padding IS NEW.padding AND
            OLD.is_active IS NEW.is_active
        )
        OR
        -- Status toggle only
        (
            OLD.id IS NEW.id AND
            OLD.series_code IS NEW.series_code AND
            OLD.financial_year IS NEW.financial_year AND
            OLD.prefix IS NEW.prefix AND
            OLD.padding IS NEW.padding AND
            OLD.next_number IS NEW.next_number AND
            OLD.is_active != NEW.is_active
        )
    );
END;
"#;

pub const MIGRATION_4_SQL: &str = r#"
-- 1. Add cost_price_paise to resource_lots (strictly >= 0)
ALTER TABLE resource_lots ADD COLUMN cost_price_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_price_paise >= 0);

-- 2. Add price_mode to transactions (strictly EXCLUSIVE or INCLUSIVE)
ALTER TABLE transactions ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (price_mode IN ('EXCLUSIVE', 'INCLUSIVE'));

-- 3. Unique index on (series, invoice_number) to enforce no duplicate invoice numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_series_invoice ON transactions(series, invoice_number);

-- 4. High-performance indexes for stock movements and ledger
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot ON stock_movements(lot_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_resource ON stock_movements(resource_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tx ON stock_movements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_pay ON ledger_entries(payment_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);

-- 5. Trigger strictly preventing negative stock on resource_lots
CREATE TRIGGER IF NOT EXISTS trg_stock_movements_no_negative_stock
BEFORE INSERT ON stock_movements
WHEN NEW.lot_id IS NOT NULL AND NEW.quantity_delta_milli < 0
BEGIN
    SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK: Stock movement would drive lot quantity negative')
    WHERE (
        COALESCE((SELECT SUM(quantity_delta_milli) FROM stock_movements WHERE lot_id = NEW.lot_id), 0) + NEW.quantity_delta_milli < 0
    );
END;

-- 6. Updated trg_transactions_update_guard covering price_mode and original_transaction_id
DROP TRIGGER IF EXISTS trg_transactions_update_guard;
CREATE TRIGGER IF NOT EXISTS trg_transactions_update_guard
BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Only status transition from POSTED to CANCELLED is allowed; all other columns must remain unchanged.')
    WHERE NOT (
        OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' AND
        OLD.id IS NEW.id AND
        OLD.seller_state_code IS NEW.seller_state_code AND
        OLD.place_of_supply_state_code IS NEW.place_of_supply_state_code AND
        OLD.series IS NEW.series AND
        OLD.invoice_number IS NEW.invoice_number AND
        OLD.entity_id IS NEW.entity_id AND
        OLD.price_mode IS NEW.price_mode AND
        OLD.subtotal_paise IS NEW.subtotal_paise AND
        OLD.discount_paise IS NEW.discount_paise AND
        OLD.taxable_paise IS NEW.taxable_paise AND
        OLD.cgst_paise IS NEW.cgst_paise AND
        OLD.sgst_paise IS NEW.sgst_paise AND
        OLD.igst_paise IS NEW.igst_paise AND
        OLD.round_off_paise IS NEW.round_off_paise AND
        OLD.total_amount_paise IS NEW.total_amount_paise AND
        OLD.notes IS NEW.notes AND
        OLD.created_by_user_id IS NEW.created_by_user_id AND
        OLD.created_at IS NEW.created_at AND
        OLD.transaction_type IS NEW.transaction_type AND
        OLD.original_transaction_id IS NEW.original_transaction_id AND
        OLD.invoice_date IS NEW.invoice_date
    );
END;
"#;

/// Runs all pending migrations in `migrations` up to the highest version specified.
/// Uses PRAGMA user_version.
///
/// Hardened behaviors:
/// (a) Returns Err and changes nothing if database user_version is higher than the highest version in the slice.
/// (b) Begins each migration with TransactionBehavior::Immediate and re-reads user_version inside that transaction.
/// Not covered by a unit test; protects against concurrent access, which is not expected in the single-user MVP.
pub fn run_migrations(conn: &mut Connection, migrations: &[Migration]) -> Result<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    let max_target_version = migrations.iter().map(|m| m.version).max().unwrap_or(0);
    if current_version > max_target_version {
        return Err(rusqlite::Error::ToSqlConversionFailure(
            format!(
                "Database user_version ({}) is higher than highest migration version ({})",
                current_version, max_target_version
            )
            .into(),
        ));
    }

    for migration in migrations {
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let tx_version: i32 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;

        if migration.version > tx_version {
            tx.execute_batch(migration.sql)?;
            tx.pragma_update(None, "user_version", migration.version)?;
            tx.commit()?;
        }
    }

    Ok(())
}

pub fn get_user_version(conn: &Connection) -> Result<i32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}
