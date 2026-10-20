pub mod migrations;
pub mod queries;

use rusqlite::{Connection, Result};
use std::path::Path;

/// Opens an SQLite database connection at `path` and immediately applies required PRAGMAs:
/// - journal_mode = WAL
/// - synchronous = FULL
/// - foreign_keys = ON
/// - busy_timeout = 5000
/// - recursive_triggers = ON
pub fn open_connection<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;
    apply_pragmas(&conn)?;
    Ok(conn)
}

/// Applies required PRAGMAs on every connection.
pub fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA recursive_triggers = ON;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use migrations::{get_user_version, run_migrations, Migration, LATEST_VERSION, MIGRATIONS};
    use queries::{verify_ledger, LedgerDiscrepancy};
    use rusqlite::params;
    use std::fs;

    fn setup_migrated_in_memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&mut conn, MIGRATIONS).unwrap();
        conn
    }

    fn seed_minimal_fixtures(conn: &Connection) {
        conn.execute(
            "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
             VALUES ('biz_1', 'OmniMart Corp', '27', '9876543210', 'Market Rd', 'Mumbai', '400001')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_1', 'cashier_alice', 'hash_val', 'Alice Smith', 'CASHIER')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts (id, code, name, type)
             VALUES ('acc_ar', '1001', 'Accounts Receivable', 'ASSET')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts (id, code, name, type)
             VALUES ('acc_sales', '4001', 'Sales Revenue', 'REVENUE')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_1', 'CUST-001', 'CUSTOMER', 'John Doe', '27')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise)
             VALUES ('res_1', 'SKU-001', 'Test Item', '1234', 1800, 1000)",
            [],
        ).unwrap();
    }

    // 1. fresh DB migrates to the latest user_version
    #[test]
    fn test_1_fresh_db_migrates_to_latest_user_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();

        let initial_version = get_user_version(&conn).unwrap();
        assert_eq!(initial_version, 0, "Fresh DB must start at user_version 0");

        run_migrations(&mut conn, MIGRATIONS).unwrap();

        let migrated_version = get_user_version(&conn).unwrap();
        assert_eq!(
            migrated_version, LATEST_VERSION,
            "Migrated DB user_version must match LATEST_VERSION"
        );
    }

    // 2. running migrations twice changes nothing
    #[test]
    fn test_2_running_migrations_twice_is_noop() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();

        run_migrations(&mut conn, MIGRATIONS).unwrap();
        let version_after_first = get_user_version(&conn).unwrap();
        assert_eq!(version_after_first, LATEST_VERSION);

        run_migrations(&mut conn, MIGRATIONS).unwrap();
        let version_after_second = get_user_version(&conn).unwrap();
        assert_eq!(version_after_second, LATEST_VERSION);
    }

    // 3. all PRAGMAs are set as specified
    #[test]
    fn test_3_all_pragmas_set_as_specified() {
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("omnibill_test_pragma_{}.db", std::process::id()));

        let _ = fs::remove_file(&db_path);

        let conn = open_connection(&db_path).unwrap();

        // 1. journal_mode = WAL
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            journal_mode.to_lowercase(),
            "wal",
            "journal_mode must be WAL on persistent database"
        );

        // 2. synchronous = FULL (represented as integer 2)
        let synchronous: i64 = conn
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 2, "synchronous must be FULL (2)");

        // 3. foreign_keys = ON (represented as integer 1)
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1, "foreign_keys must be ON (1)");

        // 4. busy_timeout = 5000
        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 5000, "busy_timeout must be 5000 ms");

        // 5. recursive_triggers = ON (represented as integer 1)
        let recursive_triggers: i64 = conn
            .query_row("PRAGMA recursive_triggers", [], |row| row.get(0))
            .unwrap();
        assert_eq!(recursive_triggers, 1, "recursive_triggers must be ON (1)");

        drop(conn);
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(format!("{}-wal", db_path.display()));
        let _ = fs::remove_file(format!("{}-shm", db_path.display()));
    }

    // 4. inserting a ledger row with both debit and credit > 0 fails
    #[test]
    fn test_4_insert_ledger_row_both_debit_and_credit_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert: exactly one of debit/credit > 0 succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_ctrl_4', 'tx_1', 'acc_ar', 500, 0, 'Valid control debit')",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert must succeed: {:?}", ctrl_res.err());

        // Attempt insert where both debit > 0 and credit > 0
        let fail_res = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_fail_4', 'tx_1', 'acc_ar', 500, 500, 'Invalid both debit and credit')",
            [],
        );
        assert!(fail_res.is_err(), "Must fail check constraint");
        let err_msg = fail_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("CHECK constraint failed"),
            "Expected 'CHECK constraint failed', got: {}",
            err_msg
        );
    }

    // 5. inserting a ledger row with both zero fails
    #[test]
    fn test_5_insert_ledger_row_both_zero_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert: exactly credit > 0 succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_ctrl_5', 'tx_1', 'acc_sales', 0, 500, 'Valid control credit')",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert must succeed: {:?}", ctrl_res.err());

        // Attempt insert where both debit == 0 and credit == 0
        let fail_res = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_fail_5', 'tx_1', 'acc_sales', 0, 0, 'Invalid zero entry')",
            [],
        );
        assert!(fail_res.is_err(), "Must fail check constraint");
        let err_msg = fail_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("CHECK constraint failed"),
            "Expected 'CHECK constraint failed', got: {}",
            err_msg
        );
    }

    // 6. UPDATE on ledger_entries fails; DELETE on ledger_entries fails
    #[test]
    fn test_6_update_and_delete_on_ledger_entries_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert succeeds
        let insert_res = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_ctrl_6', 'tx_1', 'acc_ar', 1000, 0, 'Original entry')",
            [],
        );
        assert!(insert_res.is_ok(), "Control insert must succeed: {:?}", insert_res.err());

        // UPDATE must fail with trigger text
        let update_res = conn.execute(
            "UPDATE ledger_entries SET debit_paise = 2000 WHERE id = 'led_ctrl_6'",
            [],
        );
        assert!(update_res.is_err());
        let err_up = update_res.unwrap_err().to_string();
        assert!(
            err_up.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_up
        );

        // DELETE must fail with trigger text
        let delete_res = conn.execute(
            "DELETE FROM ledger_entries WHERE id = 'led_ctrl_6'",
            [],
        );
        assert!(delete_res.is_err());
        let err_del = delete_res.unwrap_err().to_string();
        assert!(
            err_del.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_del
        );
    }

    // 7. DELETE on transactions fails (tested on transaction with NO child rows)
    #[test]
    fn test_7_delete_on_transactions_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // Insert transaction with NO child rows anywhere
        let insert_res = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_standalone', 'POSTED', '27', '27', 'INV', 'INV/26-27/0099', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(insert_res.is_ok(), "Control insert must succeed: {:?}", insert_res.err());

        // Verify zero child rows exist in any referencing table
        let child_items: i64 = conn.query_row(
            "SELECT COUNT(*) FROM transaction_items WHERE transaction_id = 'tx_standalone'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(child_items, 0, "Precondition failed: transaction must have no items");

        let child_ledger: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ledger_entries WHERE transaction_id = 'tx_standalone'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(child_ledger, 0, "Precondition failed: transaction must have no ledger rows");

        let child_allocs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM payment_allocations WHERE transaction_id = 'tx_standalone'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(child_allocs, 0, "Precondition failed: transaction must have no allocations");

        let child_stock: i64 = conn.query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE transaction_id = 'tx_standalone'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(child_stock, 0, "Precondition failed: transaction must have no stock movements");

        // Attempt DELETE on standalone transaction -> trigger must abort
        let delete_res = conn.execute("DELETE FROM transactions WHERE id = 'tx_standalone'", []);
        assert!(delete_res.is_err(), "DELETE on transactions must be blocked by trigger");
        let err_msg = delete_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_msg
        );
    }

    // 8. invoice_number longer than 16 characters fails
    #[test]
    fn test_8_invoice_number_longer_than_16_chars_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // Control insert: exactly 16 characters succeeds
        let exact_16_invoice_no = "INV/2026-27/0001";
        assert_eq!(exact_16_invoice_no.len(), 16);

        let valid_res = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_ctrl_8', 'POSTED', '27', '27', 'INV', ?1, 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            params![exact_16_invoice_no],
        );
        assert!(valid_res.is_ok(), "16-character invoice_number must be accepted: {:?}", valid_res.err());

        // 17 characters long invoice number must fail check constraint
        let long_invoice_no = "INV/2026-27/00001";
        assert_eq!(long_invoice_no.len(), 17);

        let fail_res = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_fail_8', 'POSTED', '27', '27', 'INV', ?1, 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            params![long_invoice_no],
        );
        assert!(fail_res.is_err(), "17-character invoice_number must fail");
        let err_msg = fail_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("CHECK constraint failed"),
            "Expected 'CHECK constraint failed', got: {}",
            err_msg
        );
    }

    // 9. duplicate (series_code, financial_year) in number_series fails
    #[test]
    fn test_9_duplicate_series_code_and_financial_year_fails() {
        let conn = setup_migrated_in_memory_db();

        // Control insert succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO number_series (id, series_code, financial_year, prefix, next_number)
             VALUES ('s_ctrl_9', 'TAX_INV', '26-27', 'INV/26-27/', 1)",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert must succeed: {:?}", ctrl_res.err());

        // Attempting duplicate insert fails unique constraint
        let dup_res = conn.execute(
            "INSERT INTO number_series (id, series_code, financial_year, prefix, next_number)
             VALUES ('s_dup_9', 'TAX_INV', '26-27', 'OTHER/26-27/', 1)",
            [],
        );
        assert!(dup_res.is_err());
        let err_msg = dup_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("UNIQUE constraint failed"),
            "Expected 'UNIQUE constraint failed', got: {}",
            err_msg
        );
    }

    // 10. a negative amount fails (with positive control inserts)
    #[test]
    fn test_10_negative_amounts_fail() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // --- Resources ---
        // Positive control
        let res_ctrl = conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise)
             VALUES ('res_ctrl', 'SKU-CTRL', 'Valid Item', '1234', 1800, 500)",
            [],
        );
        assert!(res_ctrl.is_ok(), "Control resource insert must succeed");

        // Negative base_price_paise fails
        let res_err = conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise)
             VALUES ('res_neg', 'SKU-NEG', 'Negative Item', '1234', 1800, -500)",
            [],
        );
        assert!(res_err.is_err());
        assert!(res_err.unwrap_err().to_string().contains("CHECK constraint failed"));

        // --- Transactions ---
        // Positive control
        let tx_ctrl = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_ctrl_10', 'POSTED', '27', '27', 'INV', 'INV/26-27/0010', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(tx_ctrl.is_ok(), "Control transaction insert must succeed");

        // Negative total_amount_paise fails
        let tx_err = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_neg', 'POSTED', '27', '27', 'INV', 'INV/26-27/0011', 'ent_1', -100, 0, -100, 0, 0, 0, 0, -100, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(tx_err.is_err());
        assert!(tx_err.unwrap_err().to_string().contains("CHECK constraint failed"));

        // --- Ledger Entries ---
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_valid', 'POSTED', '27', '27', 'INV', 'INV/26-27/0003', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Positive control
        let led_ctrl = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_ctrl_10', 'tx_valid', 'acc_ar', 1000, 0, 'Positive debit')",
            [],
        );
        assert!(led_ctrl.is_ok(), "Control ledger insert must succeed");

        // Negative debit_paise fails
        let led_neg_debit = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_neg_d', 'tx_valid', 'acc_ar', -1000, 0, 'Negative debit')",
            [],
        );
        assert!(led_neg_debit.is_err());
        assert!(led_neg_debit.unwrap_err().to_string().contains("CHECK constraint failed"));

        // Negative credit_paise fails
        let led_neg_credit = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_neg_c', 'tx_valid', 'acc_ar', 0, -1000, 'Negative credit')",
            [],
        );
        assert!(led_neg_credit.is_err());
        assert!(led_neg_credit.unwrap_err().to_string().contains("CHECK constraint failed"));

        // --- Payments ---
        // Positive control
        let pay_ctrl = conn.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id
            ) VALUES ('pay_ctrl', 'REC/26-27/0010', 'ent_1', 'CASH', 5000, 'usr_1')",
            [],
        );
        assert!(pay_ctrl.is_ok(), "Control payment insert must succeed");

        // Negative payment amount fails
        let pay_neg = conn.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id
            ) VALUES ('pay_neg', 'REC/26-27/0011', 'ent_1', 'CASH', -5000, 'usr_1')",
            [],
        );
        assert!(pay_neg.is_err());
        assert!(pay_neg.unwrap_err().to_string().contains("CHECK constraint failed"));

        // Zero payment amount fails (must be > 0)
        let pay_zero = conn.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id
            ) VALUES ('pay_zero', 'REC/26-27/0012', 'ent_1', 'CASH', 0, 'usr_1')",
            [],
        );
        assert!(pay_zero.is_err());
        assert!(pay_zero.unwrap_err().to_string().contains("CHECK constraint failed"));
    }

    // 11. verify_ledger returns the ID of an unbalanced transaction and returns empty for a balanced one
    #[test]
    fn test_11_verify_ledger_detects_unbalanced_transactions() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_unbal', 'POSTED', '27', '27', 'INV', 'INV/26-27/0004', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Insert only one-sided debit entry (1000 debit, 0 credit)
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_unbal_1', 'tx_unbal', 'acc_ar', 1000, 0, 'Unbalanced debit')",
            [],
        ).unwrap();

        let imbalanced = verify_ledger(&conn).unwrap();
        assert!(
            imbalanced.iter().any(|d| match d {
                LedgerDiscrepancy::UnbalancedTransaction { transaction_id, net_difference_paise } => {
                    transaction_id == "tx_unbal" && *net_difference_paise == 1000
                }
                _ => false,
            }),
            "verify_ledger must flag UnbalancedTransaction for tx_unbal"
        );

        // Balance the transaction with matching credit
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_bal_2', 'tx_unbal', 'acc_sales', 0, 1000, 'Balancing credit')",
            [],
        ).unwrap();

        let balanced = verify_ledger(&conn).unwrap();
        assert!(
            balanced.is_empty(),
            "verify_ledger must return an empty list for balanced ledger"
        );
    }

    // 12. a schema scan test: query sqlite_master and assert no column type contains REAL, FLOAT, DOUBLE or DECIMAL
    #[test]
    fn test_12_schema_scan_no_float_or_decimal_types() {
        let conn = setup_migrated_in_memory_db();

        let mut stmt = conn
            .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .unwrap();

        let forbidden_keywords = ["REAL", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC"];

        let tables = stmt
            .query_map([], |row| {
                let name: String = row.get(0)?;
                let sql: String = row.get(1)?;
                Ok((name, sql))
            })
            .unwrap();

        for table in tables {
            let (table_name, _table_sql) = table.unwrap();

            let pragma_sql = format!("PRAGMA table_info({})", table_name);
            let mut pragma_stmt = conn.prepare(&pragma_sql).unwrap();

            let columns = pragma_stmt
                .query_map([], |col_row| {
                    let col_name: String = col_row.get(1)?;
                    let col_type: String = col_row.get(2)?;
                    Ok((col_name, col_type))
                })
                .unwrap();

            for col in columns {
                let (col_name, col_type) = col.unwrap();
                let upper_type = col_type.to_uppercase();

                for forbidden in &forbidden_keywords {
                    assert!(
                        !upper_type.contains(forbidden),
                        "Schema violation in table '{}', column '{}': forbidden type '{}' contains '{}'",
                        table_name,
                        col_name,
                        col_type,
                        forbidden
                    );
                }
            }
        }
    }

    // 13. UPDATE/DELETE on stock_movements fails
    #[test]
    fn test_13_update_and_delete_on_stock_movements_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_stock', 'POSTED', '27', '27', 'INV', 'INV/26-27/0020', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert into stock_movements succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO stock_movements (
                id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
            ) VALUES ('sm_ctrl_13', 'res_1', NULL, 'tx_stock', 'SALE', -1000)",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert on stock_movements must succeed: {:?}", ctrl_res.err());

        // UPDATE must fail with trigger text
        let update_res = conn.execute(
            "UPDATE stock_movements SET quantity_delta_milli = -2000 WHERE id = 'sm_ctrl_13'",
            [],
        );
        assert!(update_res.is_err());
        let err_up = update_res.unwrap_err().to_string();
        assert!(
            err_up.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_up
        );

        // DELETE must fail with trigger text
        let delete_res = conn.execute(
            "DELETE FROM stock_movements WHERE id = 'sm_ctrl_13'",
            [],
        );
        assert!(delete_res.is_err());
        let err_del = delete_res.unwrap_err().to_string();
        assert!(
            err_del.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_del
        );
    }

    // 14. DELETE on transaction_items fails
    #[test]
    fn test_14_delete_on_transaction_items_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_items', 'POSTED', '27', '27', 'INV', 'INV/26-27/0021', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert into transaction_items succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_ctrl_14', 'tx_items', 'res_1', NULL, 1000, 1000, 0, 1000, 0, 0, 0, 0, 1000)",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert on transaction_items must succeed: {:?}", ctrl_res.err());

        // DELETE must fail with trigger text
        let del_res = conn.execute("DELETE FROM transaction_items WHERE id = 'ti_ctrl_14'", []);
        assert!(del_res.is_err());
        let err_del = del_res.unwrap_err().to_string();
        assert!(
            err_del.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_del
        );
    }

    // 15. ledger_entries foreign keys have NO ON DELETE CASCADE
    #[test]
    fn test_15_ledger_entries_foreign_keys_have_no_cascade() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // Structural check via PRAGMA foreign_key_list(ledger_entries)
        let mut stmt = conn.prepare("PRAGMA foreign_key_list(ledger_entries)").unwrap();
        let fk_rows = stmt
            .query_map([], |row| {
                let to_table: String = row.get(2)?;
                let from_col: String = row.get(3)?;
                let on_update: String = row.get(5)?;
                let on_delete: String = row.get(6)?;
                Ok((to_table, from_col, on_update, on_delete))
            })
            .unwrap();

        let mut fk_count = 0;
        for fk in fk_rows {
            let (to_table, from_col, _on_update, on_delete) = fk.unwrap();
            fk_count += 1;
            assert_ne!(
                on_delete.to_uppercase(),
                "CASCADE",
                "Foreign key from column '{}' to table '{}' must NOT use ON DELETE CASCADE",
                from_col,
                to_table
            );
            assert_eq!(
                on_delete.to_uppercase(),
                "RESTRICT",
                "Foreign key from column '{}' to table '{}' must use ON DELETE RESTRICT",
                from_col,
                to_table
            );
        }
        assert!(fk_count >= 3, "Expected at least 3 foreign keys (accounts, transactions, payments)");

        // Functional check: Attempting to delete a referenced account fails with foreign key violation
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_fk_test', 'POSTED', '27', '27', 'INV', 'INV/26-27/0030', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO accounts (id, code, name, type) VALUES ('acc_locked', '1099', 'Locked Cash', 'ASSET')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_fk_test', 'tx_fk_test', 'acc_locked', 1000, 0, 'Locked entry')",
            [],
        ).unwrap();

        let del_acc_res = conn.execute("DELETE FROM accounts WHERE id = 'acc_locked'", []);
        assert!(del_acc_res.is_err(), "Must reject deletion of account referenced by ledger_entries");
        let err_msg = del_acc_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("FOREIGN KEY constraint failed"),
            "Expected 'FOREIGN KEY constraint failed', got: {}",
            err_msg
        );
    }

    // 16. accounts table has NO stored balance column
    #[test]
    fn test_16_accounts_table_has_no_balance_column() {
        let conn = setup_migrated_in_memory_db();

        let mut stmt = conn.prepare("PRAGMA table_info(accounts)").unwrap();
        let columns = stmt
            .query_map([], |row| {
                let name: String = row.get(1)?;
                Ok(name)
            })
            .unwrap();

        let mut col_names = Vec::new();
        for c in columns {
            let name = c.unwrap();
            assert!(
                !name.to_lowercase().contains("balance"),
                "accounts table must NOT have a balance column. Found: '{}'",
                name
            );
            col_names.push(name);
        }

        assert_eq!(
            col_names,
            vec!["id", "code", "name", "type", "created_at"],
            "accounts table contains unexpected columns"
        );
    }

    // 17. a failing migration leaves the DB and user_version unchanged
    #[test]
    fn test_17_failing_migration_leaves_db_and_user_version_unchanged() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();

        let test_migrations = [
            Migration {
                version: 1,
                description: "Valid first migration",
                sql: migrations::SCHEMA_V2_SQL,
            },
            Migration {
                version: 2,
                description: "Failing second migration with invalid SQL syntax",
                sql: "CREATE TABLE temp_canary_fail (id TEXT PRIMARY KEY); SYNTAX_ERROR_MALFORMED_SQL;",
            },
        ];

        let result = run_migrations(&mut conn, &test_migrations);
        assert!(result.is_err(), "run_migrations must return Err when a migration fails");

        // 1. First migration's state is kept
        let users_table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'users'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(users_table_exists, "Migration 1 tables must remain intact");

        // 2. user_version equals the last successful version (1)
        let version = get_user_version(&conn).unwrap();
        assert_eq!(version, 1, "user_version must equal 1 (the last successful migration version)");

        // 3. No partial tables from the failed migration exist
        let canary_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'temp_canary_fail'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!canary_exists, "No partial tables from failed migration must exist");
    }

    // 18. UPDATE on transaction_items fails
    #[test]
    fn test_18_update_on_transaction_items_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_item_up', 'POSTED', '27', '27', 'INV', 'INV/26-27/0050', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert into transaction_items succeeds
        let ctrl_res = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_ctrl_18', 'tx_item_up', 'res_1', NULL, 1000, 1000, 0, 1000, 0, 0, 0, 0, 1000)",
            [],
        );
        assert!(ctrl_res.is_ok(), "Control insert must succeed: {:?}", ctrl_res.err());

        // UPDATE must fail via trigger
        let up_res = conn.execute(
            "UPDATE transaction_items SET quantity_milli = 2000 WHERE id = 'ti_ctrl_18'",
            [],
        );
        assert!(up_res.is_err(), "UPDATE on transaction_items must be blocked");
        let err_msg = up_res.unwrap_err().to_string();
        assert!(
            err_msg.contains("IMMUTABILITY_RULE_BROKEN"),
            "Expected 'IMMUTABILITY_RULE_BROKEN', got: {}",
            err_msg
        );
    }

    // 19. UPDATE and DELETE on payments fail; same for payment_allocations
    #[test]
    fn test_19_update_and_delete_on_payments_and_allocations_fail() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_pay_19', 'POSTED', '27', '27', 'INV', 'INV/26-27/0051', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control insert payment
        let pay_ctrl = conn.execute(
            "INSERT INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id)
             VALUES ('pay_ctrl_19', 'REC/26-27/0051', 'ent_1', 'CASH', 1000, 'usr_1')",
            [],
        );
        assert!(pay_ctrl.is_ok(), "Control payment insert must succeed");

        // UPDATE payments fails
        let pay_up = conn.execute("UPDATE payments SET amount_paise = 2000 WHERE id = 'pay_ctrl_19'", []);
        assert!(pay_up.is_err());
        assert!(pay_up.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // DELETE payments fails
        let pay_del = conn.execute("DELETE FROM payments WHERE id = 'pay_ctrl_19'", []);
        assert!(pay_del.is_err());
        assert!(pay_del.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // Control insert payment_allocations
        let alloc_ctrl = conn.execute(
            "INSERT INTO payment_allocations (id, payment_id, transaction_id, amount_allocated_paise)
             VALUES ('pa_ctrl_19', 'pay_ctrl_19', 'tx_pay_19', 1000)",
            [],
        );
        assert!(alloc_ctrl.is_ok(), "Control allocation insert must succeed");

        // UPDATE payment_allocations fails
        let alloc_up = conn.execute("UPDATE payment_allocations SET amount_allocated_paise = 500 WHERE id = 'pa_ctrl_19'", []);
        assert!(alloc_up.is_err());
        assert!(alloc_up.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // DELETE payment_allocations fails
        let alloc_del = conn.execute("DELETE FROM payment_allocations WHERE id = 'pa_ctrl_19'", []);
        assert!(alloc_del.is_err());
        assert!(alloc_del.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));
    }

    // 20. UPDATE of transactions.total_amount_paise fails; UPDATE of status POSTED -> CANCELLED succeeds; CANCELLED -> POSTED fails
    #[test]
    fn test_20_transactions_update_guard_rules() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_guard', 'POSTED', '27', '27', 'INV', 'INV/26-27/0060', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // 1. UPDATE total_amount_paise must FAIL
        let up_amount = conn.execute(
            "UPDATE transactions SET total_amount_paise = 2000 WHERE id = 'tx_guard'",
            [],
        );
        assert!(up_amount.is_err(), "Modifying transaction amounts must be blocked");
        assert!(up_amount.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 2. UPDATE status POSTED -> CANCELLED (all other columns unchanged) must SUCCEED
        let up_cancel = conn.execute(
            "UPDATE transactions SET status = 'CANCELLED' WHERE id = 'tx_guard'",
            [],
        );
        assert!(up_cancel.is_ok(), "POSTED -> CANCELLED must succeed: {:?}", up_cancel.err());

        let current_status: String = conn
            .query_row("SELECT status FROM transactions WHERE id = 'tx_guard'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(current_status, "CANCELLED");

        // 3. UPDATE CANCELLED -> POSTED must FAIL
        let up_unfreeze = conn.execute(
            "UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_guard'",
            [],
        );
        assert!(up_unfreeze.is_err(), "Reverting CANCELLED to POSTED must be rejected");
        assert!(up_unfreeze.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));
    }

    // 21. ledger_entries with transaction_id NULL and payment_id NULL fails
    #[test]
    fn test_21_ledger_entries_null_references_fail() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_21', 'POSTED', '27', '27', 'INV', 'INV/26-27/0070', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id)
             VALUES ('pay_21', 'REC/26-27/0070', 'ent_1', 'CASH', 1000, 'usr_1')",
            [],
        ).unwrap();

        // Control 1: transaction_id not null succeeds
        let ctrl_tx = conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_ctrl_tx', 'tx_21', NULL, 'acc_ar', 1000, 0, 'Valid tx')",
            [],
        );
        assert!(ctrl_tx.is_ok(), "Control transaction ledger entry must succeed");

        // Control 2: payment_id not null succeeds
        let ctrl_pay = conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_ctrl_pay', NULL, 'pay_21', 'acc_ar', 0, 1000, 'Valid pay')",
            [],
        );
        assert!(ctrl_pay.is_ok(), "Control payment ledger entry must succeed");

        // Failure: both transaction_id and payment_id are NULL
        let fail_nulls = conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_fail_nulls', NULL, NULL, 'acc_ar', 1000, 0, 'Invalid orphaned entry')",
            [],
        );
        assert!(fail_nulls.is_err(), "Orphaned ledger entry must be rejected");
        assert!(fail_nulls.unwrap_err().to_string().contains("CHECK constraint failed"));
    }

    // 22. stock_movements with quantity_delta_milli = 0 fails
    #[test]
    fn test_22_stock_movements_zero_quantity_fails() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_22', 'POSTED', '27', '27', 'INV', 'INV/26-27/0072', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // Control: positive delta succeeds
        let ctrl_pos = conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_pos', 'res_1', NULL, 'tx_22', 'PURCHASE', 1000)",
            [],
        );
        assert!(ctrl_pos.is_ok(), "Positive quantity movement must succeed");

        // Control: negative delta succeeds
        let ctrl_neg = conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_neg', 'res_1', NULL, 'tx_22', 'SALE', -1000)",
            [],
        );
        assert!(ctrl_neg.is_ok(), "Negative quantity movement must succeed");

        // Failure: zero delta fails
        let fail_zero = conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_zero', 'res_1', NULL, 'tx_22', 'ADJUSTMENT', 0)",
            [],
        );
        assert!(fail_zero.is_err(), "Zero quantity movement must fail");
        assert!(fail_zero.unwrap_err().to_string().contains("CHECK constraint failed"));
    }

    // 23. one invalid value each for users.role, entities.entity_type, accounts.type, stock_movements.reason is rejected
    #[test]
    fn test_23_enum_check_constraints_rejected() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // 1. users.role
        let user_fail = conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('u_bad', 'hacker', 'hash', 'Bob', 'SUPERUSER')",
            [],
        );
        assert!(user_fail.is_err());
        assert!(user_fail.unwrap_err().to_string().contains("CHECK constraint failed"));

        // 2. entities.entity_type
        let ent_fail = conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('e_bad', 'E-BAD', 'VENDOR_INVALID', 'Bad Vendor', '27')",
            [],
        );
        assert!(ent_fail.is_err());
        assert!(ent_fail.unwrap_err().to_string().contains("CHECK constraint failed"));

        // 3. accounts.type
        let acc_fail = conn.execute(
            "INSERT INTO accounts (id, code, name, type)
             VALUES ('a_bad', '9999', 'Crypto Pool', 'EQUITY_INVALID')",
            [],
        );
        assert!(acc_fail.is_err());
        assert!(acc_fail.unwrap_err().to_string().contains("CHECK constraint failed"));

        // 4. stock_movements.reason
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_23', 'POSTED', '27', '27', 'INV', 'INV/26-27/0073', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        let sm_fail = conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_bad', 'res_1', NULL, 'tx_23', 'STOLEN', -100)",
            [],
        );
        assert!(sm_fail.is_err());
        assert!(sm_fail.unwrap_err().to_string().contains("CHECK constraint failed"));
    }

    // 24. verify_ledger: unbalanced payment is found; POSTED transaction with no entries is found; a fully balanced database returns nothing
    #[test]
    fn test_24_verify_ledger_diagnostics() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // 1. Initially empty database -> fully balanced returns nothing
        let initial_issues = verify_ledger(&conn).unwrap();
        assert!(initial_issues.is_empty(), "Empty ledger must report zero issues");

        // 2. Insert a POSTED transaction with no ledger entries -> should be flagged
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_orphan', 'POSTED', '27', '27', 'INV', 'INV/26-27/0080', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        let orphan_issues = verify_ledger(&conn).unwrap();
        assert_eq!(
            orphan_issues,
            vec![LedgerDiscrepancy::PostedTransactionWithoutEntries {
                transaction_id: "tx_orphan".to_string()
            }],
            "Must flag POSTED transaction without ledger entries"
        );

        // Balance the transaction
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_tx_d', 'tx_orphan', 'acc_ar', 1000, 0, 'Tx debit')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_tx_c', 'tx_orphan', 'acc_sales', 0, 1000, 'Tx credit')",
            [],
        ).unwrap();

        let tx_balanced_issues = verify_ledger(&conn).unwrap();
        assert!(tx_balanced_issues.is_empty(), "Balanced transaction must clear issues");

        // 3. Insert payment with unbalanced ledger entries -> should be flagged
        conn.execute(
            "INSERT INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id)
             VALUES ('pay_unbal', 'REC/26-27/0080', 'ent_1', 'CASH', 500, 'usr_1')",
            [],
        ).unwrap();

        // Only 1-sided entry for payment
        conn.execute(
            "INSERT INTO ledger_entries (id, payment_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_pay_d', 'pay_unbal', 'acc_ar', 500, 0, 'Payment debit only')",
            [],
        ).unwrap();

        let pay_issues = verify_ledger(&conn).unwrap();
        assert!(
            pay_issues.iter().any(|d| match d {
                LedgerDiscrepancy::UnbalancedPayment { payment_id, net_difference_paise } => {
                    payment_id == "pay_unbal" && *net_difference_paise == 500
                }
                _ => false,
            }),
            "Must flag UnbalancedPayment for pay_unbal"
        );

        // Balance the payment
        conn.execute(
            "INSERT INTO ledger_entries (id, payment_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_pay_c', 'pay_unbal', 'acc_sales', 0, 500, 'Payment credit')",
            [],
        ).unwrap();

        // 4. Fully balanced database returns nothing
        let final_issues = verify_ledger(&conn).unwrap();
        assert!(
            final_issues.is_empty(),
            "Fully balanced database must return zero issues, got: {:?}",
            final_issues
        );
    }

    // 25. upgrade path: migrate empty DB to v2 with slice [m1, m2], then run full MIGRATIONS list and assert v3
    #[test]
    fn test_25_upgrade_path_v2_to_v3() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();

        // Step 1: Migrate empty DB to v2 with slice [m1, m2]
        run_migrations(&mut conn, &MIGRATIONS[0..2]).unwrap();
        assert_eq!(get_user_version(&conn).unwrap(), 2);

        // Step 2: Run full MIGRATIONS list (upgrades v2 to v3)
        run_migrations(&mut conn, MIGRATIONS).unwrap();
        assert_eq!(get_user_version(&conn).unwrap(), 3);
    }

    // 26. each new CHECK constraint on transactions
    #[test]
    fn test_26_transactions_new_check_constraints() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // (a) Valid control SALE with NULL original_transaction_id succeeds
        let ctrl_sale = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0261', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(ctrl_sale.is_ok(), "Valid SALE with original_transaction_id NULL must succeed");

        // (b) SALE with non-NULL original_transaction_id FAILS
        let fail_sale_with_orig = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_2', 'POSTED', '27', '27', 'INV', 'INV/26-27/0262', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', 'tx_c26_1', '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_sale_with_orig.is_err());
        assert!(fail_sale_with_orig.unwrap_err().to_string().contains("CHECK constraint failed"));

        // (c) SALE_RETURN with NULL original_transaction_id FAILS
        let fail_return_without_orig = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_3', 'POSTED', '27', '27', 'INV', 'INV/26-27/0263', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE_RETURN', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_return_without_orig.is_err());
        assert!(fail_return_without_orig.unwrap_err().to_string().contains("CHECK constraint failed"));

        // (d) Valid control SALE_RETURN with non-NULL original_transaction_id succeeds
        let ctrl_return = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_4', 'POSTED', '27', '27', 'INV', 'INV/26-27/0264', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE_RETURN', 'tx_c26_1', '2026-10-20', 'usr_1')",
            [],
        );
        assert!(ctrl_return.is_ok(), "Valid SALE_RETURN with original_transaction_id must succeed");

        // (e) Bad invoice_date format FAILS
        let fail_bad_date = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_5', 'POSTED', '27', '27', 'INV', 'INV/26-27/0265', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '20-10-2026', 'usr_1')",
            [],
        );
        assert!(fail_bad_date.is_err());
        assert!(fail_bad_date.unwrap_err().to_string().contains("CHECK constraint failed"));

        // (f) round_off_paise 100 FAILS (allowed -99..99)
        let fail_round_off = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c26_6', 'POSTED', '27', '27', 'INV', 'INV/26-27/0266', 'ent_1', 1000, 0, 1000, 0, 0, 0, 100, 1100, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_round_off.is_err());
        assert!(fail_round_off.unwrap_err().to_string().contains("CHECK constraint failed"));
    }

    // 27. guard covers all columns, allows POSTED -> CANCELLED, blocks invoice_date / transaction_type change
    #[test]
    fn test_27_transactions_guard_covers_all_columns() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // 1. Read PRAGMA table_info(transactions) and assert every column appears in trigger SQL
        let mut col_stmt = conn.prepare("PRAGMA table_info(transactions)").unwrap();
        let cols = col_stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap();

        let trigger_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_transactions_update_guard'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        for col in &cols {
            assert!(
                trigger_sql.contains(col),
                "Column '{}' of transactions table must appear in trg_transactions_update_guard SQL",
                col
            );
            if col == "status" {
                assert!(
                    trigger_sql.contains("OLD.status = 'POSTED'"),
                    "Trigger SQL must contain OLD.status = 'POSTED'"
                );
                assert!(
                    trigger_sql.contains("NEW.status = 'CANCELLED'"),
                    "Trigger SQL must contain NEW.status = 'CANCELLED'"
                );
            } else {
                let exact_text = format!("OLD.{} IS NEW.{}", col, col);
                assert!(
                    trigger_sql.contains(&exact_text),
                    "Trigger SQL must contain exact text '{}'",
                    exact_text
                );
            }
        }

        // 2. Control insert
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_c27', 'POSTED', '27', '27', 'INV', 'INV/26-27/0270', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        // 3. Changing invoice_date is BLOCKED
        let fail_date = conn.execute(
            "UPDATE transactions SET invoice_date = '2026-10-21' WHERE id = 'tx_c27'",
            [],
        );
        assert!(fail_date.is_err());
        assert!(fail_date.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 4. Changing transaction_type is BLOCKED
        let fail_type = conn.execute(
            "UPDATE transactions SET transaction_type = 'PURCHASE' WHERE id = 'tx_c27'",
            [],
        );
        assert!(fail_type.is_err());
        assert!(fail_type.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 5. Changing status POSTED -> CANCELLED alone SUCCEEDS
        let pass_cancel = conn.execute(
            "UPDATE transactions SET status = 'CANCELLED' WHERE id = 'tx_c27'",
            [],
        );
        assert!(pass_cancel.is_ok(), "POSTED -> CANCELLED must succeed");
    }

    // 28. every invariant in item 3: fail case and pass case
    #[test]
    fn test_28_before_insert_invariants() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // --- Transaction Invariants ---

        // (a) subtotal - discount != taxable FAILS
        let fail_sub = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0281', 'ent_1', 1000, 100, 800, 0, 0, 0, 0, 800, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_sub.is_err());
        let err_sub = fail_sub.unwrap_err().to_string();
        assert!(err_sub.contains("INVARIANT_BROKEN: subtotal_paise - discount_paise must equal taxable_paise"));

        // (b) total != taxable + cgst + sgst + igst + round_off FAILS
        let fail_tot = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_2', 'POSTED', '27', '27', 'INV', 'INV/26-27/0282', 'ent_1', 1000, 0, 1000, 90, 90, 0, 0, 1150, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_tot.is_err());
        let err_tot = fail_tot.unwrap_err().to_string();
        assert!(err_tot.contains("INVARIANT_BROKEN: total_amount_paise must equal taxable_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise"));

        // (c) Intra-state with IGST > 0 FAILS
        let fail_intra_igst = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_3', 'POSTED', '27', '27', 'INV', 'INV/26-27/0283', 'ent_1', 1000, 0, 1000, 0, 0, 180, 0, 1180, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_intra_igst.is_err());
        let err_intra = fail_intra_igst.unwrap_err().to_string();
        assert!(err_intra.contains("INVARIANT_BROKEN: Intra-state transaction cannot have IGST"));

        // (d) Inter-state with CGST/SGST > 0 FAILS
        let fail_inter_cgst = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_4', 'POSTED', '27', '29', 'INV', 'INV/26-27/0284', 'ent_1', 1000, 0, 1000, 90, 90, 0, 0, 1180, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(fail_inter_cgst.is_err());
        let err_inter = fail_inter_cgst.unwrap_err().to_string();
        assert!(err_inter.contains("INVARIANT_BROKEN: Inter-state transaction cannot have CGST or SGST"));

        // Pass case for intra-state transaction with round off
        let pass_intra = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_pass_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0285', 'ent_1', 1000, 100, 900, 81, 81, 0, -2, 1060, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(pass_intra.is_ok(), "Valid intra-state insert must pass invariants: {:?}", pass_intra.err());

        // Pass case for inter-state transaction
        let pass_inter = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_inv_pass_2', 'POSTED', '27', '29', 'INV', 'INV/26-27/0286', 'ent_1', 1000, 0, 1000, 0, 0, 180, 0, 1180, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        );
        assert!(pass_inter.is_ok(), "Valid inter-state insert must pass invariants: {:?}", pass_inter.err());

        // --- Transaction Items Invariants ---

        // (e) line_total != taxable + cgst + sgst + igst FAILS
        let fail_line_tot = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_inv_1', 'tx_inv_pass_1', 'res_1', NULL, 1000, 1000, 0, 1000, 1800, 90, 90, 0, 1100)",
            [],
        );
        assert!(fail_line_tot.is_err());
        let err_lt = fail_line_tot.unwrap_err().to_string();
        assert!(err_lt.contains("INVARIANT_BROKEN: line_total_paise must equal taxable_paise + cgst_paise + sgst_paise + igst_paise"));

        // (f) cgst != sgst FAILS
        let fail_unequal_cgst = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_inv_2', 'tx_inv_pass_1', 'res_1', NULL, 1000, 1000, 0, 1000, 1800, 90, 89, 0, 1179)",
            [],
        );
        assert!(fail_unequal_cgst.is_err());
        let err_cgst = fail_unequal_cgst.unwrap_err().to_string();
        assert!(err_cgst.contains("INVARIANT_BROKEN: cgst_paise must equal sgst_paise"));

        // (g) igst > 0 when cgst > 0 FAILS
        let fail_both_taxes = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_inv_3', 'tx_inv_pass_1', 'res_1', NULL, 1000, 1000, 0, 1000, 1800, 90, 90, 180, 1360)",
            [],
        );
        assert!(fail_both_taxes.is_err());
        let err_both = fail_both_taxes.unwrap_err().to_string();
        assert!(err_both.contains("INVARIANT_BROKEN: igst_paise must be 0 when cgst_paise > 0"));

        // Pass case for transaction_items
        let pass_item = conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES ('ti_inv_pass', 'tx_inv_pass_1', 'res_1', NULL, 1000, 1000, 100, 900, 1800, 81, 81, 0, 1062)",
            [],
        );
        assert!(pass_item.is_ok(), "Valid item insert must succeed: {:?}", pass_item.err());
    }

    // 29. seeded accounts: all 10 exist with the right type; running migrations again does not duplicate
    #[test]
    fn test_29_seeded_chart_of_accounts() {
        let mut conn = setup_migrated_in_memory_db();

        let expected_accounts = [
            ("1000", "Cash in Hand", "ASSET"),
            ("1010", "Bank and Digital Receipts", "ASSET"),
            ("1100", "Accounts Receivable", "ASSET"),
            ("1200", "Inventory", "ASSET"),
            ("2100", "Output CGST", "LIABILITY"),
            ("2110", "Output SGST", "LIABILITY"),
            ("2120", "Output IGST", "LIABILITY"),
            ("4000", "Sales Revenue", "REVENUE"),
            ("4010", "Sales Returns", "REVENUE"),
            ("4900", "Round Off", "EXPENSE"),
        ];

        for (code, name, acct_type) in expected_accounts {
            let row: (String, String) = conn
                .query_row(
                    "SELECT name, type FROM accounts WHERE code = ?1",
                    params![code],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(row.0, name, "Account name mismatch for code {}", code);
            assert_eq!(row.1, acct_type, "Account type mismatch for code {}", code);

            let code_fmt: (i64, i64) = conn
                .query_row(
                    "SELECT length(code), (code GLOB '[0-9][0-9][0-9][0-9]') FROM accounts WHERE code = ?1",
                    params![code],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(code_fmt.0, 4, "length(code) must be 4 for account {}", code);
            assert_eq!(code_fmt.1, 1, "code GLOB '[0-9][0-9][0-9][0-9]' must be 1 for account {}", code);
        }

        let initial_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts WHERE code IN ('1000','1010','1100','1200','2100','2110','2120','4000','4010','4900')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(initial_count, 10);

        // Re-running migrations must not duplicate
        run_migrations(&mut conn, MIGRATIONS).unwrap();
        let second_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM accounts WHERE code IN ('1000','1010','1100','1200','2100','2110','2120','4000','4010','4900')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(second_count, 10);

        let mut print_stmt = conn
            .prepare("SELECT code, length(code), typeof(code), hex(code) FROM accounts ORDER BY code")
            .unwrap();
        let print_rows = print_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap();
        for r in print_rows {
            let (code, len, typ, hx) = r.unwrap();
            println!("{}|{}|{}|{}", code, len, typ, hx);
        }
    }

    // 30. accounts guard: type change blocked after entries exist, allowed before
    #[test]
    fn test_30_accounts_guard_behavior() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // (a) Account without entries: updating code and type is ALLOWED
        let update_free = conn.execute(
            "UPDATE accounts SET code = '1098', type = 'LIABILITY' WHERE id = 'acc_ar'",
            [],
        );
        assert!(update_free.is_ok(), "Updating unused account code and type must succeed");

        // Revert back
        conn.execute("UPDATE accounts SET code = '1001', type = 'ASSET' WHERE id = 'acc_ar'", []).unwrap();

        // (b) Create a transaction and ledger entry referencing acc_ar
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_acct_test', 'POSTED', '27', '27', 'INV', 'INV/26-27/0300', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_acct_test', 'tx_acct_test', 'acc_ar', 1000, 0, 'Entry')",
            [],
        ).unwrap();

        // (c) Now updating code on acc_ar is BLOCKED
        let fail_code = conn.execute(
            "UPDATE accounts SET code = '9999' WHERE id = 'acc_ar'",
            [],
        );
        assert!(fail_code.is_err());
        assert!(fail_code.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (d) Updating type on acc_ar is BLOCKED
        let fail_type = conn.execute(
            "UPDATE accounts SET type = 'EXPENSE' WHERE id = 'acc_ar'",
            [],
        );
        assert!(fail_type.is_err());
        assert!(fail_type.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (e) Updating name on acc_ar is still ALLOWED
        let pass_name = conn.execute(
            "UPDATE accounts SET name = 'Trade Receivables' WHERE id = 'acc_ar'",
            [],
        );
        assert!(pass_name.is_ok(), "Updating name must be allowed even with ledger entries");
    }

    // 31. number_series: +2 fails, decrement fails, prefix change after issuance fails, +1 passes, DELETE fails, is_active toggle passes
    #[test]
    fn test_31_number_series_guard_rules() {
        let conn = setup_migrated_in_memory_db();

        conn.execute(
            "INSERT INTO number_series (id, series_code, financial_year, prefix, next_number, padding, is_active)
             VALUES ('ns_test', 'TAX_INV', '26-27', 'INV/26-27/', 1, 4, 1)",
            [],
        ).unwrap();

        // 1. +1 passes
        let pass_inc = conn.execute(
            "UPDATE number_series SET next_number = next_number + 1 WHERE id = 'ns_test'",
            [],
        );
        assert!(pass_inc.is_ok(), "Incrementing next_number by exactly 1 must pass: {:?}", pass_inc.err());

        // 2. is_active toggle passes
        let pass_toggle = conn.execute(
            "UPDATE number_series SET is_active = 0 WHERE id = 'ns_test'",
            [],
        );
        assert!(pass_toggle.is_ok(), "Toggling is_active must pass: {:?}", pass_toggle.err());

        // 3. +2 fails
        let fail_plus_two = conn.execute(
            "UPDATE number_series SET next_number = next_number + 2 WHERE id = 'ns_test'",
            [],
        );
        assert!(fail_plus_two.is_err());
        assert!(fail_plus_two.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 4. decrement fails
        let fail_dec = conn.execute(
            "UPDATE number_series SET next_number = next_number - 1 WHERE id = 'ns_test'",
            [],
        );
        assert!(fail_dec.is_err());
        assert!(fail_dec.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 5. prefix change fails
        let fail_prefix = conn.execute(
            "UPDATE number_series SET prefix = 'NEW/26-27/' WHERE id = 'ns_test'",
            [],
        );
        assert!(fail_prefix.is_err());
        assert!(fail_prefix.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // 6. DELETE fails
        let fail_del = conn.execute("DELETE FROM number_series WHERE id = 'ns_test'", []);
        assert!(fail_del.is_err());
        assert!(fail_del.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));
    }

    // 32. database with user_version 99 makes run_migrations return Err, unchanged
    #[test]
    fn test_32_user_version_higher_than_slice_returns_err() {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();

        // Set user_version to 99
        conn.pragma_update(None, "user_version", 99).unwrap();
        assert_eq!(get_user_version(&conn).unwrap(), 99);

        // Attempt running migrations
        let res = run_migrations(&mut conn, MIGRATIONS);
        assert!(res.is_err(), "run_migrations must return Err when user_version > highest migration");

        // Assert user_version remains 99 and unchanged
        assert_eq!(get_user_version(&conn).unwrap(), 99);
    }

    // 33. REPLACE cannot bypass immutability across all append-only and guarded tables
    #[test]
    fn test_33_replace_cannot_bypass_immutability() {
        let conn = setup_migrated_in_memory_db();
        seed_minimal_fixtures(&conn);

        // 1. transactions
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                'tx_rep_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/8888', 'ent_1',
                1000, 0, 1000, 0, 0, 0, 0, 1000,
                'SALE', NULL, '2026-10-20', 'usr_1'
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_tx_rep = conn.execute(
            "INSERT OR REPLACE INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                'tx_rep_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/8888', 'ent_1',
                2000, 0, 2000, 0, 0, 0, 0, 2000,
                'SALE', NULL, '2026-10-20', 'usr_1'
            )",
            [],
        );
        assert!(fail_tx_rep.is_err());
        assert!(fail_tx_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let tx_tot: i64 = conn.query_row("SELECT total_amount_paise FROM transactions WHERE id = 'tx_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(tx_tot, 1000);

        // 2. transaction_items
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                'ti_rep_1', 'tx_rep_1', 'res_1', NULL, 1000,
                1000, 0, 1000, 0,
                0, 0, 0, 1000
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_ti_rep = conn.execute(
            "INSERT OR REPLACE INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                'ti_rep_1', 'tx_rep_1', 'res_1', NULL, 2000,
                1000, 0, 2000, 0,
                0, 0, 0, 2000
            )",
            [],
        );
        assert!(fail_ti_rep.is_err());
        assert!(fail_ti_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let ti_qty: i64 = conn.query_row("SELECT quantity_milli FROM transaction_items WHERE id = 'ti_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ti_qty, 1000);

        // 3. stock_movements
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO stock_movements (
                id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
            ) VALUES (
                'sm_rep_1', 'res_1', NULL, 'tx_rep_1', 'SALE', -1000
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_sm_rep = conn.execute(
            "INSERT OR REPLACE INTO stock_movements (
                id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
            ) VALUES (
                'sm_rep_1', 'res_1', NULL, 'tx_rep_1', 'SALE', -2000
            )",
            [],
        );
        assert!(fail_sm_rep.is_err());
        assert!(fail_sm_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let sm_qty: i64 = conn.query_row("SELECT quantity_delta_milli FROM stock_movements WHERE id = 'sm_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(sm_qty, -1000);

        // 4. ledger_entries
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (
                'le_rep_1', 'tx_rep_1', NULL, 'acc_ar', 1000, 0, 'Control entry'
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_le_rep = conn.execute(
            "INSERT OR REPLACE INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (
                'le_rep_1', 'tx_rep_1', NULL, 'acc_ar', 2000, 0, 'Control entry'
            )",
            [],
        );
        assert!(fail_le_rep.is_err());
        assert!(fail_le_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let le_dbt: i64 = conn.query_row("SELECT debit_paise FROM ledger_entries WHERE id = 'le_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(le_dbt, 1000);

        // 5. payments
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id
            ) VALUES (
                'pay_rep_1', 'PAY/26-27/0001', 'ent_1', 'CASH', 1000, 'usr_1'
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_pay_rep = conn.execute(
            "INSERT OR REPLACE INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id
            ) VALUES (
                'pay_rep_1', 'PAY/26-27/0001', 'ent_1', 'CASH', 2000, 'usr_1'
            )",
            [],
        );
        assert!(fail_pay_rep.is_err());
        assert!(fail_pay_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let pay_amt: i64 = conn.query_row("SELECT amount_paise FROM payments WHERE id = 'pay_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(pay_amt, 1000);

        // 6. payment_allocations
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO payment_allocations (
                id, payment_id, transaction_id, amount_allocated_paise
            ) VALUES (
                'pa_rep_1', 'pay_rep_1', 'tx_rep_1', 1000
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_pa_rep = conn.execute(
            "INSERT OR REPLACE INTO payment_allocations (
                id, payment_id, transaction_id, amount_allocated_paise
            ) VALUES (
                'pa_rep_1', 'pay_rep_1', 'tx_rep_1', 2000
            )",
            [],
        );
        assert!(fail_pa_rep.is_err());
        assert!(fail_pa_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let pa_amt: i64 = conn.query_row("SELECT amount_allocated_paise FROM payment_allocations WHERE id = 'pa_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(pa_amt, 1000);

        // 7. number_series
        // (a) Insert valid control row
        conn.execute(
            "INSERT INTO number_series (
                id, series_code, financial_year, prefix, next_number, padding, is_active
            ) VALUES (
                'ns_rep_1', 'REP_SER', '2026-2027', 'REP/', 10, 4, 1
            )",
            [],
        ).unwrap();

        // (b) INSERT OR REPLACE with same PK and changed value fails
        let fail_ns_rep = conn.execute(
            "INSERT OR REPLACE INTO number_series (
                id, series_code, financial_year, prefix, next_number, padding, is_active
            ) VALUES (
                'ns_rep_1', 'REP_SER', '2026-2027', 'REP/', 11, 4, 1
            )",
            [],
        );
        assert!(fail_ns_rep.is_err());
        assert!(fail_ns_rep.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        // (c) Original row is unchanged
        let ns_num: i64 = conn.query_row("SELECT next_number FROM number_series WHERE id = 'ns_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(ns_num, 10);

        // --- Replace-by-unique-key attacks ---

        // (i) number_series: INSERT OR REPLACE with new id but same (series_code, financial_year) and next_number = 1
        let fail_ns_attack = conn.execute(
            "INSERT OR REPLACE INTO number_series (
                id, series_code, financial_year, prefix, next_number, padding, is_active
            ) VALUES (
                'ns_rep_attack', 'REP_SER', '2026-2027', 'REP/', 1, 4, 1
            )",
            [],
        );
        assert!(fail_ns_attack.is_err());
        assert!(fail_ns_attack.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        let orig_ns_num: i64 = conn.query_row("SELECT next_number FROM number_series WHERE id = 'ns_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(orig_ns_num, 10);
        let ns_attack_count: i64 = conn.query_row("SELECT COUNT(*) FROM number_series WHERE id = 'ns_rep_attack'", [], |r| r.get(0)).unwrap();
        assert_eq!(ns_attack_count, 0);

        // (ii) transactions: INSERT OR REPLACE with new id but same invoice_number
        let fail_tx_attack = conn.execute(
            "INSERT OR REPLACE INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                'tx_rep_attack', 'POSTED', '27', '27', 'INV', 'INV/26-27/8888', 'ent_1',
                5000, 0, 5000, 0, 0, 0, 0, 5000,
                'SALE', NULL, '2026-10-20', 'usr_1'
            )",
            [],
        );
        assert!(fail_tx_attack.is_err());
        assert!(fail_tx_attack.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

        let orig_tx_tot: i64 = conn.query_row("SELECT total_amount_paise FROM transactions WHERE id = 'tx_rep_1'", [], |r| r.get(0)).unwrap();
        assert_eq!(orig_tx_tot, 1000);
        let tx_attack_count: i64 = conn.query_row("SELECT COUNT(*) FROM transactions WHERE id = 'tx_rep_attack'", [], |r| r.get(0)).unwrap();
        assert_eq!(tx_attack_count, 0);
    }
}
