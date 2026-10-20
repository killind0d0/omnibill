use rusqlite::{Connection, Result};

pub const LATEST_VERSION: i32 = 1;

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

/// Runs all pending migrations up to LATEST_VERSION.
/// Uses PRAGMA user_version.
/// Running migrations multiple times is a no-op.
/// Each migration executes inside its own transaction.
pub fn run_migrations(conn: &mut Connection) -> Result<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for migration in MIGRATIONS {
        if migration.version > current_version {
            let tx = conn.transaction()?;
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
