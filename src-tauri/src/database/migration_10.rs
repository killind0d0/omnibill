//! Migration 10: Two-Phase Draft/Post Ledger Gate, Persistent HMAC Audit Logs,
//! and Database-Boundary Statutory Period Lock.
//!
//! Hard Gate 2:
//! - Direct INSERT of POSTED transactions blocked (`trg_transactions_no_direct_posted_insert`).
//! - Ledger entries only accepted for existing DRAFT transactions (`trg_ledger_entries_insert_only_on_draft`).
//! - Line-level positive amount checks (`trg_ledger_entries_line_amounts_check`).
//! - Commit-time Dr=Cr verification on DRAFT -> POSTED transition (`trg_transactions_verify_balanced_on_post`).
//! - Immutability triggers on ledger_entries blocking UPDATE/DELETE once transaction is POSTED.
//!
//! Hard Gate 4:
//! - Persistent `audit_logs` table in SQLite protected by immutability triggers (`trg_audit_logs_no_update`, `trg_audit_logs_no_delete`).
//! - Monotonic sequence and hash chain guard (`trg_audit_logs_sequence_and_hash_guard`).
//! - Statutory period locks table (`statutory_period_locks`) and DB-boundary trigger blocking back-dated inserts (`trg_transactions_period_lock_guard`).

pub const MIGRATION_10_SQL: &str = r#"
-- ============================================================================
-- 1. PERSISTENT AUDIT LOGS TABLE & IMMUTABILITY TRIGGERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    sequence_number INTEGER UNIQUE NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    before_state_json TEXT,
    after_state_json TEXT,
    reason TEXT,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_seq ON audit_logs(sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on audit_logs is strictly forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on audit_logs is strictly forbidden.');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_sequence_and_hash_guard
BEFORE INSERT ON audit_logs
BEGIN
    -- Sequence must equal max(sequence_number) + 1, or 1 if table is empty
    SELECT RAISE(ABORT, 'AUDIT_CHAIN_BROKEN: sequence_number must strictly increment by 1')
    WHERE NEW.sequence_number != (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM audit_logs);

    -- For sequence_number = 1, prev_hash must be 'GENESIS'
    SELECT RAISE(ABORT, 'AUDIT_CHAIN_BROKEN: First audit entry must have prev_hash GENESIS')
    WHERE NEW.sequence_number = 1 AND NEW.prev_hash != 'GENESIS';

    -- For sequence_number > 1, prev_hash must match entry_hash of previous sequence
    SELECT RAISE(ABORT, 'AUDIT_CHAIN_BROKEN: prev_hash must match entry_hash of preceding sequence_number')
    WHERE NEW.sequence_number > 1 AND NEW.prev_hash != (
        SELECT entry_hash FROM audit_logs WHERE sequence_number = NEW.sequence_number - 1
    );
END;

-- ============================================================================
-- 2. STATUTORY PERIOD LOCKS & DB-BOUNDARY BACK-DATING TRIGGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS statutory_period_locks (
    id TEXT PRIMARY KEY,
    lock_date TEXT NOT NULL CHECK(length(lock_date) = 10 AND lock_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    locked_at_ms INTEGER NOT NULL,
    locked_by_user_id TEXT NOT NULL,
    reason TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TRIGGER IF NOT EXISTS trg_period_locks_no_update
BEFORE UPDATE ON statutory_period_locks
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on statutory_period_locks is forbidden. Period locks are immutable.');
END;

CREATE TRIGGER IF NOT EXISTS trg_period_locks_no_delete
BEFORE DELETE ON statutory_period_locks
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on statutory_period_locks is forbidden.');
END;

-- ============================================================================
-- 3. TWO-PHASE DRAFT/POST LEDGER POSTING & Dr=Cr BALANCE GUARDS
-- ============================================================================

-- (a) Recreate transactions table to permit 'DRAFT' status in CHECK(status IN ('DRAFT', 'POSTED', 'CANCELLED'))
DROP TRIGGER IF EXISTS trg_ledger_entries_insert_only_on_draft;
DROP TRIGGER IF EXISTS trg_ledger_entries_no_update;
DROP TRIGGER IF EXISTS trg_ledger_entries_no_delete;
DROP TABLE IF EXISTS transactions_v10;

CREATE TABLE transactions_v10 (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
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
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    transaction_type TEXT CHECK(
        transaction_type IS NOT NULL AND transaction_type IN ('SALE', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_RETURN')
    ),
    original_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT CHECK(
        (transaction_type IN ('SALE_RETURN', 'PURCHASE_RETURN') AND original_transaction_id IS NOT NULL)
        OR
        (transaction_type IN ('SALE', 'PURCHASE') AND original_transaction_id IS NULL)
    ),
    invoice_date TEXT CHECK(
        invoice_date IS NOT NULL AND length(invoice_date) = 10 AND invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    round_off_paise INTEGER NOT NULL DEFAULT 0 CHECK(
        round_off_paise >= -99 AND round_off_paise <= 99
    ),
    price_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (price_mode IN ('EXCLUSIVE', 'INCLUSIVE'))
);

INSERT OR IGNORE INTO transactions_v10 (
    id, status, seller_state_code, place_of_supply_state_code, series, invoice_number,
    entity_id, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise,
    igst_paise, total_amount_paise, notes, created_by_user_id, created_at,
    transaction_type, original_transaction_id, invoice_date, round_off_paise, price_mode
)
SELECT
    id, status, seller_state_code, place_of_supply_state_code, series, invoice_number,
    entity_id, subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise,
    igst_paise, total_amount_paise, notes, created_by_user_id, created_at,
    transaction_type, original_transaction_id, invoice_date, round_off_paise, price_mode
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_v10 RENAME TO transactions;

CREATE TRIGGER IF NOT EXISTS trg_transactions_before_insert_invariants
BEFORE INSERT ON transactions
BEGIN
    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: taxable_paise must equal subtotal_paise - discount_paise')
    WHERE (NEW.subtotal_paise - NEW.discount_paise) != NEW.taxable_paise;

    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: total_amount_paise must equal taxable_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise')
    WHERE NEW.total_amount_paise != (NEW.taxable_paise + NEW.cgst_paise + NEW.sgst_paise + NEW.igst_paise + NEW.round_off_paise);

    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: Intra-state transaction cannot have IGST')
    WHERE NEW.seller_state_code = NEW.place_of_supply_state_code AND NEW.igst_paise != 0;

    SELECT RAISE(ABORT, 'INVARIANT_BROKEN: Inter-state transaction cannot have CGST or SGST')
    WHERE NEW.seller_state_code != NEW.place_of_supply_state_code AND (NEW.cgst_paise != 0 OR NEW.sgst_paise != 0);
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on transactions is forbidden; mark as CANCELLED instead.');
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_period_lock_guard
BEFORE INSERT ON transactions
WHEN EXISTS (
    SELECT 1 FROM statutory_period_locks
    WHERE is_active = 1 AND NEW.invoice_date <= lock_date
)
BEGIN
    SELECT RAISE(ABORT, 'PERIOD_LOCKED: Transaction invoice_date is on or before active statutory lock_date.');
END;

CREATE TRIGGER IF NOT EXISTS trg_transactions_period_lock_update_guard
BEFORE UPDATE OF invoice_date, status ON transactions
WHEN EXISTS (
    SELECT 1 FROM statutory_period_locks
    WHERE is_active = 1 AND NEW.invoice_date <= lock_date
)
BEGIN
    SELECT RAISE(ABORT, 'PERIOD_LOCKED: Transaction invoice_date is on or before active statutory lock_date.');
END;

-- (b) Block direct INSERT with status = 'POSTED'. Vouchers must be inserted as DRAFT.
CREATE TRIGGER IF NOT EXISTS trg_transactions_no_direct_posted_insert
BEFORE INSERT ON transactions
WHEN NEW.status = 'POSTED'
BEGIN
    SELECT RAISE(ABORT, 'GATEWAY_VIOLATION: Direct insert of POSTED transaction is forbidden. Insert as DRAFT first.');
END;

-- (b) Ledger entries can only be attached to an existing DRAFT transaction or valid payment.
--     Enforces mutual exclusivity: exactly one of transaction_id or payment_id must be non-null.
--     If NEW.transaction_id points to a non-existent or POSTED row -> aborts immediately.
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_insert_only_on_draft
BEFORE INSERT ON ledger_entries
WHEN (
    (NEW.transaction_id IS NOT NULL AND NEW.payment_id IS NOT NULL)
    OR
    (NEW.transaction_id IS NULL AND NEW.payment_id IS NULL)
    OR
    (NEW.transaction_id IS NOT NULL AND (SELECT status FROM transactions WHERE id = NEW.transaction_id) IS NOT 'DRAFT')
    OR
    (NEW.payment_id IS NOT NULL AND (SELECT id FROM payments WHERE id = NEW.payment_id) IS NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'LINE_REQUIRES_DRAFT_PARENT: Ledger entries may only be attached to an existing DRAFT transaction or valid payment.');
END;

-- (c) Line-level positive amount CHECK trigger.
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_line_amounts_check
BEFORE INSERT ON ledger_entries
WHEN NEW.debit_paise < 0 OR NEW.credit_paise < 0 OR
     NOT ((NEW.debit_paise > 0 AND NEW.credit_paise = 0) OR (NEW.debit_paise = 0 AND NEW.credit_paise > 0))
BEGIN
    SELECT RAISE(ABORT, 'INVALID_LINE_AMOUNT: Exactly one of debit_paise or credit_paise must be strictly positive, and neither negative.');
END;

-- (d) Commit-time Dr=Cr check on DRAFT -> POSTED transition.
CREATE TRIGGER IF NOT EXISTS trg_transactions_verify_balanced_on_post
BEFORE UPDATE OF status ON transactions
WHEN OLD.status = 'DRAFT' AND NEW.status = 'POSTED'
BEGIN
    -- Require at least 2 ledger entries for positive-amount vouchers
    SELECT RAISE(ABORT, 'UNBALANCED_VOUCHER: Voucher must contain at least 2 ledger lines')
    WHERE NEW.total_amount_paise > 0 AND (SELECT COUNT(*) FROM ledger_entries WHERE transaction_id = NEW.id) < 2;

    -- Require SUM(debit) == SUM(credit)
    SELECT RAISE(ABORT, 'UNBALANCED_VOUCHER: Total debits must equal total credits')
    WHERE (
        SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0)
        FROM ledger_entries
        WHERE transaction_id = NEW.id
    ) != 0;
END;

-- (e) Payment balance guard: prevents imbalanced payment ledger entries.
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_payment_balance_guard
AFTER INSERT ON ledger_entries
WHEN NEW.payment_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'GATEWAY_VIOLATION: Payment may only have exactly 2 balanced ledger lines')
    WHERE (SELECT COUNT(*) FROM ledger_entries WHERE payment_id = NEW.payment_id) > 2;

    SELECT RAISE(ABORT, 'UNBALANCED_PAYMENT: Payment debits and credits must balance')
    WHERE (SELECT COUNT(*) FROM ledger_entries WHERE payment_id = NEW.payment_id) >= 2
      AND (SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) FROM ledger_entries WHERE payment_id = NEW.payment_id) != 0;
END;

-- (f) Recreate trg_transactions_update_guard allowing DRAFT -> POSTED and POSTED -> CANCELLED
DROP TRIGGER IF EXISTS trg_transactions_update_guard;
CREATE TRIGGER IF NOT EXISTS trg_transactions_update_guard
BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Only status transition DRAFT -> POSTED or POSTED -> CANCELLED is allowed; all other columns must remain unchanged.')
    WHERE NOT (
        (
            (OLD.status = 'DRAFT' AND NEW.status = 'POSTED')
            OR
            (OLD.status = 'POSTED' AND NEW.status = 'CANCELLED')
        )
        AND OLD.id IS NEW.id
        AND OLD.seller_state_code IS NEW.seller_state_code
        AND OLD.place_of_supply_state_code IS NEW.place_of_supply_state_code
        AND OLD.series IS NEW.series
        AND OLD.invoice_number IS NEW.invoice_number
        AND OLD.entity_id IS NEW.entity_id
        AND OLD.price_mode IS NEW.price_mode
        AND OLD.subtotal_paise IS NEW.subtotal_paise
        AND OLD.discount_paise IS NEW.discount_paise
        AND OLD.taxable_paise IS NEW.taxable_paise
        AND OLD.cgst_paise IS NEW.cgst_paise
        AND OLD.sgst_paise IS NEW.sgst_paise
        AND OLD.igst_paise IS NEW.igst_paise
        AND OLD.round_off_paise IS NEW.round_off_paise
        AND OLD.total_amount_paise IS NEW.total_amount_paise
        AND OLD.notes IS NEW.notes
        AND OLD.created_by_user_id IS NEW.created_by_user_id
        AND OLD.created_at IS NEW.created_at
        AND OLD.transaction_type IS NEW.transaction_type
        AND OLD.original_transaction_id IS NEW.original_transaction_id
        AND OLD.invoice_date IS NEW.invoice_date
    );
END;

-- (g) Recreate ledger_entries immutability triggers:
--     Lines of POSTED transactions are strictly immutable (no update, no delete).
--     Lines of DRAFT transactions may be deleted during draft cleanup before posting.
DROP TRIGGER IF EXISTS trg_ledger_entries_no_update;
CREATE TRIGGER trg_ledger_entries_no_update
BEFORE UPDATE ON ledger_entries
WHEN (SELECT status FROM transactions WHERE id = OLD.transaction_id) IS NOT 'DRAFT'
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on posted ledger_entries is forbidden.');
END;

DROP TRIGGER IF EXISTS trg_ledger_entries_no_delete;
CREATE TRIGGER trg_ledger_entries_no_delete
BEFORE DELETE ON ledger_entries
WHEN (SELECT status FROM transactions WHERE id = OLD.transaction_id) IS NOT 'DRAFT'
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on posted ledger_entries is forbidden.');
END;
"#;
