pub mod migrations;
pub mod queries;

use rusqlite::{Connection, Result};
use std::path::Path;

/// Opens an SQLite database connection at `path` and immediately applies required PRAGMAs:
/// - journal_mode = WAL
/// - synchronous = FULL
/// - foreign_keys = ON
/// - busy_timeout = 5000
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
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use migrations::{get_user_version, run_migrations, LATEST_VERSION};
    use queries::verify_ledger;
    use rusqlite::params;
    use std::fs;

    fn setup_migrated_in_memory_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&mut conn).unwrap();
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

        run_migrations(&mut conn).unwrap();

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

        run_migrations(&mut conn).unwrap();
        let version_after_first = get_user_version(&conn).unwrap();
        assert_eq!(version_after_first, LATEST_VERSION);

        run_migrations(&mut conn).unwrap();
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_standalone', 'POSTED', '27', '27', 'INV', 'INV/26-27/0099', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_ctrl_8', 'POSTED', '27', '27', 'INV', ?1, 'ent_1', 1000, 1000, 1000, 'usr_1')",
            params![exact_16_invoice_no],
        );
        assert!(valid_res.is_ok(), "16-character invoice_number must be accepted: {:?}", valid_res.err());

        // 17 characters long invoice number must fail check constraint
        let long_invoice_no = "INV/2026-27/00001";
        assert_eq!(long_invoice_no.len(), 17);

        let fail_res = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_fail_8', 'POSTED', '27', '27', 'INV', ?1, 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_ctrl_10', 'POSTED', '27', '27', 'INV', 'INV/26-27/0010', 'ent_1', 1000, 1000, 1000, 'usr_1')",
            [],
        );
        assert!(tx_ctrl.is_ok(), "Control transaction insert must succeed");

        // Negative total_amount_paise fails
        let tx_err = conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_neg', 'POSTED', '27', '27', 'INV', 'INV/26-27/0011', 'ent_1', 1000, 1000, -100, 'usr_1')",
            [],
        );
        assert!(tx_err.is_err());
        assert!(tx_err.unwrap_err().to_string().contains("CHECK constraint failed"));

        // --- Ledger Entries ---
        // Positive control
        let led_ctrl = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_ctrl_10', 'tx_ctrl_10', 'acc_ar', 1000, 0, 'Positive debit')",
            [],
        );
        assert!(led_ctrl.is_ok(), "Control ledger insert must succeed");

        // Negative debit_paise fails
        let led_neg_debit = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_neg_d', 'tx_ctrl_10', 'acc_ar', -1000, 0, 'Negative debit')",
            [],
        );
        assert!(led_neg_debit.is_err());
        assert!(led_neg_debit.unwrap_err().to_string().contains("CHECK constraint failed"));

        // Negative credit_paise fails
        let led_neg_credit = conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_neg_c', 'tx_ctrl_10', 'acc_ar', 0, -1000, 'Negative credit')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_unbal', 'POSTED', '27', '27', 'INV', 'INV/26-27/0004', 'ent_1', 1000, 1000, 1000, 'usr_1')",
            [],
        ).unwrap();

        // Insert only one-sided debit entry (1000 debit, 0 credit)
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_unbal_1', 'tx_unbal', 'acc_ar', 1000, 0, 'Unbalanced debit')",
            [],
        ).unwrap();

        let imbalanced_ids = verify_ledger(&conn).unwrap();
        assert_eq!(
            imbalanced_ids,
            vec!["tx_unbal".to_string()],
            "verify_ledger must flag the unbalanced transaction ID"
        );

        // Balance the transaction with matching credit
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_bal_2', 'tx_unbal', 'acc_sales', 0, 1000, 'Balancing credit')",
            [],
        ).unwrap();

        let balanced_ids = verify_ledger(&conn).unwrap();
        assert!(
            balanced_ids.is_empty(),
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_stock', 'POSTED', '27', '27', 'INV', 'INV/26-27/0020', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_items', 'POSTED', '27', '27', 'INV', 'INV/26-27/0021', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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

        // 1. Structural check via PRAGMA foreign_key_list(ledger_entries)
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

        // 2. Functional check: Attempting to delete a referenced account fails with foreign key violation
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, taxable_paise,
                total_amount_paise, created_by_user_id
            ) VALUES ('tx_fk_test', 'POSTED', '27', '27', 'INV', 'INV/26-27/0030', 'ent_1', 1000, 1000, 1000, 'usr_1')",
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

        // Expected schema columns only
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

        // 1. Initial state: run valid migration 1
        run_migrations(&mut conn).unwrap();
        let initial_version = get_user_version(&conn).unwrap();
        assert_eq!(initial_version, 1);

        // 2. Simulate a failing migration #2 inside a transaction
        let failed_run: Result<(), rusqlite::Error> = (|| {
            let tx = conn.transaction()?;
            // Step A: Creates a canary table
            tx.execute_batch("CREATE TABLE temp_migration_canary (id TEXT PRIMARY KEY);")?;
            // Step B: Malformed SQL that causes syntax error
            tx.execute_batch("MALFORMED SYNTAX ERROR HERE;")?;
            // Step C: Would advance user_version if it hadn't failed
            tx.pragma_update(None, "user_version", 2)?;
            tx.commit()?;
            Ok(())
        })();

        assert!(failed_run.is_err(), "Simulated migration must return an error");

        // 3. Assert canary table was completely rolled back and does NOT exist
        let canary_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'temp_migration_canary'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!canary_exists, "Canary table from rolled-back migration must not exist");

        // 4. Assert user_version remains completely unchanged
        let post_fail_version = get_user_version(&conn).unwrap();
        assert_eq!(
            post_fail_version, initial_version,
            "user_version must remain unchanged at {} after migration failure",
            initial_version
        );
    }
}
