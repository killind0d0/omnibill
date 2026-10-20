use omnibill_core::database::{
    migrations::{LATEST_VERSION, MIGRATIONS, run_migrations},
    open_connection, queries::{LedgerDiscrepancy, verify_ledger},
};
use omnibill_core::hardware::backup::{
    BackupError, create_backup, restore_backup,
};
use omnibill_core::hardware::printer::{
    PaperWidth, ReceiptData, ReceiptItem, ReceiptTaxSummary, format_paise, format_quantity_milli,
    generate_escpos_bytes,
};
use omnibill_core::posting::series::parse_financial_year;
use omnibill_core::posting::tax::{compute_line, round_div_i128};
use omnibill_core::posting::{
    LineInput, PaymentAllocationInput, PaymentInput, PaymentMode,
    PostingError, PriceMode, SaleInput,
    SaleReturnInput, post_payment, post_sale,
    post_sale_return,
};
use omnibill_core::commands::{
    cmd_post_sale, cmd_get_resources, cmd_create_resource, cmd_create_entity,
    CreateResourceInput, CreateEntityInput,
};
use rusqlite::{Connection, params};
use std::fs;
use std::path::PathBuf;

fn create_test_db(name: &str) -> (Connection, PathBuf) {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_chaos_{}_{}.db", name, uuid::Uuid::new_v4()));
    let _ = fs::remove_file(&db_path);
    let mut conn = open_connection(&db_path).unwrap();
    run_migrations(&mut conn, MIGRATIONS).unwrap();

    // Seed basic profile
    conn.execute(
        "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
         VALUES ('biz_chaos', 'Chaos Mart Ltd', '27', '9999999999', 'Chaos St', 'Mumbai', '400001')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role)
         VALUES ('usr_chaos', 'chaos_admin', 'hash_pw', 'Chaos Admin', 'ADMIN')",
        [],
    ).unwrap();

    (conn, db_path)
}

fn cleanup_db(path: &std::path::Path) {
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(format!("{}-wal", path.display()));
    let _ = fs::remove_file(format!("{}-shm", path.display()));
}

// ============================================================================
// 1. Pure Math & Postings Fuzzing & Boundary Attacks
// ============================================================================

#[test]
fn test_scope1_round_div_i128_boundaries() {
    // 1. Division by zero
    assert!(matches!(round_div_i128(100, 0), Err(PostingError::DivisionByZero)));
    assert!(matches!(round_div_i128(0, 0), Err(PostingError::DivisionByZero)));

    // 2. Numerator is zero
    assert_eq!(round_div_i128(0, 100).unwrap(), 0);
    assert_eq!(round_div_i128(0, -100).unwrap(), 0);

    // 3. Overflow with i128::MIN / -1
    assert!(matches!(round_div_i128(i128::MIN, -1), Err(PostingError::MathOverflow)));

    // 4. Test i128::MAX boundary: does (i128::MAX + half) overflow in round_div_i128?
    // When dividing i128::MAX by 2, half is 1. (i128::MAX + 1) overflows i128!
    let res_max_div_2 = round_div_i128(i128::MAX, 2);
    println!("i128::MAX / 2 result: {:?}", res_max_div_2);
    assert!(res_max_div_2.is_err(), "round_div_i128(i128::MAX, 2) overflows intermediate addition");

    // 5. Half-up vs half-away-from-zero:
    // Positive 50 / 100 -> 1
    assert_eq!(round_div_i128(50, 100).unwrap(), 1);
    // Positive 49 / 100 -> 0
    assert_eq!(round_div_i128(49, 100).unwrap(), 0);
    // Negative -50 / 100 -> -1
    assert_eq!(round_div_i128(-50, 100).unwrap(), -1);
    // Negative -49 / 100 -> 0
    assert_eq!(round_div_i128(-49, 100).unwrap(), 0);
}

#[test]
fn test_scope1_tax_math_extreme_numbers() {
    // 1. Negative quantity
    let line_neg_qty = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: -1000,
        unit_price_paise: 1000,
        discount_paise: 0,
        tax_rate_bps: 1800,
    };
    assert!(matches!(compute_line(&line_neg_qty, PriceMode::Exclusive, true), Err(PostingError::InvalidQuantity(-1000))));

    // 2. Zero quantity
    let line_zero_qty = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 0,
        unit_price_paise: 1000,
        discount_paise: 0,
        tax_rate_bps: 1800,
    };
    assert!(matches!(compute_line(&line_zero_qty, PriceMode::Exclusive, true), Err(PostingError::InvalidQuantity(0))));

    // 3. Negative price
    let line_neg_price = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 1000,
        unit_price_paise: -1,
        discount_paise: 0,
        tax_rate_bps: 1800,
    };
    assert!(matches!(compute_line(&line_neg_price, PriceMode::Exclusive, true), Err(PostingError::InvalidUnitPrice(-1))));

    // 4. Invalid tax rates: > 10000 bps or negative
    let line_high_tax = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 1000,
        unit_price_paise: 1000,
        discount_paise: 0,
        tax_rate_bps: 10001,
    };
    assert!(matches!(compute_line(&line_high_tax, PriceMode::Exclusive, true), Err(PostingError::InvalidTaxRate(10001))));

    let line_neg_tax = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 1000,
        unit_price_paise: 1000,
        discount_paise: 0,
        tax_rate_bps: -1,
    };
    assert!(matches!(compute_line(&line_neg_tax, PriceMode::Exclusive, true), Err(PostingError::InvalidTaxRate(-1))));

    // 5. Discount > Gross
    let line_high_disc = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 1000,
        unit_price_paise: 1000,
        discount_paise: 1001,
        tax_rate_bps: 1800,
    };
    assert!(matches!(compute_line(&line_high_disc, PriceMode::Exclusive, true), Err(PostingError::InvalidDiscount { .. })));

    // 6. Near i64::MAX price causing multiplication or addition overflow
    let line_near_max = LineInput {
        resource_id: "res_1".into(),
        quantity_milli: 1000,
        unit_price_paise: i64::MAX,
        discount_paise: 0,
        tax_rate_bps: 1800,
    };
    // taxable = i64::MAX, taxable * 1800 / 20000 will be added to taxable and overflow i64
    let res_overflow = compute_line(&line_near_max, PriceMode::Exclusive, true);
    assert!(matches!(res_overflow, Err(PostingError::MathOverflow)));
}

#[test]
fn test_scope1_zero_amount_sale_creates_corrupt_posted_transaction_without_ledger() {
    let (mut conn, path) = create_test_db("zero_sale");

    // Create a resource with 0 price (e.g. promotional giveaway or free sample)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_free', 'FREE-01', 'Free Sample', '9999', 0, 0, 0)",
        [],
    ).unwrap();

    let sale_input = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_free".into(),
            quantity_milli: 1000,
            unit_price_paise: 0,
            discount_paise: 0,
            tax_rate_bps: 0,
        }],
    };

    // Posting this sale succeeds at the API level
    let posted = post_sale(&mut conn, &sale_input).expect("Zero-value sale should be accepted by post_sale");
    assert_eq!(posted.totals.total_amount_paise, 0);

    // But verify_ledger AUDIT checks:
    let discrepancies = verify_ledger(&conn).unwrap();
    println!("Discrepancies on zero-value sale: {:?}", discrepancies);
    assert!(discrepancies.is_empty(), "Zero-value sale must not flag missing entries");

    cleanup_db(&path);
}

#[test]
fn test_scope1_financial_year_boundary_and_invalid_calendar_dates() {
    // 1. Boundary dates
    assert_eq!(parse_financial_year("2026-03-31").unwrap(), "2025-26");
    assert_eq!(parse_financial_year("2026-04-01").unwrap(), "2026-27");

    // 2. Leap year dates
    assert_eq!(parse_financial_year("2028-02-29").unwrap(), "2027-28"); // 2028 is leap year

    // 3. Invalid format with slashes
    assert!(matches!(parse_financial_year("2026/04/01"), Err(PostingError::InvalidDateFormat(_))));

    // 4. Invalid calendar date: February 31st (does NOT exist in any calendar)
    assert!(matches!(parse_financial_year("2026-02-31"), Err(PostingError::InvalidDateFormat(_))));

    // 5. Non-leap year February 29th
    assert!(matches!(parse_financial_year("2026-02-29"), Err(PostingError::InvalidDateFormat(_))));
    assert_eq!(parse_financial_year("2028-02-29").unwrap(), "2027-28");
}

#[test]
fn test_scope1_fifo_lot_deduction_insufficient_and_negative_stock() {
    let (mut conn, path) = create_test_db("fifo_chaos");

    // Create stock-tracked resource with 0 stock
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_stock', 'STOCK-01', 'Tracked Item', '1234', 1800, 5000, 1)",
        [],
    ).unwrap();

    let sale_input = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_stock".into(),
            quantity_milli: 1000,
            unit_price_paise: 5000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };

    // 1. Post sale when 0 lots exist
    let err_no_lots = post_sale(&mut conn, &sale_input);
    assert!(matches!(err_no_lots, Err(PostingError::InsufficientStock { requested_milli: 1000, available_milli: 0, .. })));

    // 2. Add lot with 500 milli (partial stock)
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
         VALUES ('lot_1', 'res_stock', 'B1', 5000)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
         VALUES ('sm_1', 'res_stock', 'lot_1', 'PURCHASE', 500)",
        [],
    ).unwrap();

    let err_partial = post_sale(&mut conn, &sale_input);
    assert!(matches!(err_partial, Err(PostingError::InsufficientStock { requested_milli: 1000, available_milli: 500, .. })));

    // 3. Negative delta directly on empty lot is rejected by database trigger trg_stock_movements_no_negative_stock
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
         VALUES ('lot_2', 'res_stock', 'B2', 5000)",
        [],
    ).unwrap();
    let err_trigger = conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
         VALUES ('sm_2_bad', 'res_stock', 'lot_2', 'DAMAGE', -500)",
        [],
    );
    assert!(err_trigger.is_err(), "Trigger must reject negative lot stock");

    // Add 1000 in and 1000 out to make lot_2 balance 0
    conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
         VALUES ('sm_2_in', 'res_stock', 'lot_2', 'PURCHASE', 1000)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
         VALUES ('sm_2_out', 'res_stock', 'lot_2', 'DAMAGE', -1000)",
        [],
    ).unwrap();

    // Available is still only 500 from lot_1 (lot_2 has 0 balance)
    let err_zero_delta = post_sale(&mut conn, &sale_input);
    assert!(matches!(err_zero_delta, Err(PostingError::InsufficientStock { requested_milli: 1000, available_milli: 500, .. })));

    cleanup_db(&path);
}

// ============================================================================
// 2. Database & Schema Guards & Trigger Bypass Attacks
// ============================================================================

#[test]
fn test_scope2_immutability_triggers_and_replace_bypass_attempts() {
    let (conn, path) = create_test_db("guards_chaos");

    // Seed account
    conn.execute(
        "INSERT INTO accounts (id, code, name, type) VALUES ('acc_test', '9999', 'Test Acc', 'ASSET')",
        [],
    ).unwrap();
    // Seed entity
    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
         VALUES ('ent_test', 'CUST-CHAOS', 'CUSTOMER', 'Chaos Cust', '27')",
        [],
    ).unwrap();
    // Seed transaction
    conn.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            'tx_test', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_test',
            10000, 0, 10000, 900, 900, 0, 0, 11800, 'usr_chaos', 'SALE', NULL, '2026-05-10'
        )",
        [],
    ).unwrap();

    // Seed ledger entry
    conn.execute(
        "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
         VALUES ('le_test', 'tx_test', NULL, 'acc_test', 11800, 0, 'Test Narration')",
        [],
    ).unwrap();

    // 1. Direct UPDATE on ledger_entries MUST FAIL
    let res_upd_le = conn.execute("UPDATE ledger_entries SET debit_paise = 20000 WHERE id = 'le_test'", []);
    assert!(res_upd_le.is_err(), "UPDATE on ledger_entries must be blocked by trigger");
    assert!(res_upd_le.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

    // 2. Direct DELETE on ledger_entries MUST FAIL
    let res_del_le = conn.execute("DELETE FROM ledger_entries WHERE id = 'le_test'", []);
    assert!(res_del_le.is_err(), "DELETE on ledger_entries must be blocked by trigger");
    assert!(res_del_le.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

    // 3. INSERT OR REPLACE on ledger_entries (Attempt trigger bypass)
    let res_replace_le = conn.execute(
        "INSERT OR REPLACE INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
         VALUES ('le_test', 'tx_test', NULL, 'acc_test', 5000, 0, 'Replaced')",
        [],
    );
    assert!(res_replace_le.is_err(), "INSERT OR REPLACE on ledger_entries must fail because of DELETE trigger");

    // 4. DELETE on transactions MUST FAIL
    let res_del_tx = conn.execute("DELETE FROM transactions WHERE id = 'tx_test'", []);
    assert!(res_del_tx.is_err(), "DELETE on transactions must be blocked by trigger");
    assert!(res_del_tx.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

    // 5. UPDATE on transactions changing total_amount_paise MUST FAIL
    let res_upd_tx = conn.execute("UPDATE transactions SET total_amount_paise = 99999 WHERE id = 'tx_test'", []);
    assert!(res_upd_tx.is_err(), "UPDATE on transactions altering amounts must fail");
    assert!(res_upd_tx.unwrap_err().to_string().contains("IMMUTABILITY_RULE_BROKEN"));

    // 6. UPDATE on transactions status POSTED -> CANCELLED is allowed
    let res_cancel_tx = conn.execute("UPDATE transactions SET status = 'CANCELLED' WHERE id = 'tx_test'", []);
    assert!(res_cancel_tx.is_ok(), "Transition POSTED -> CANCELLED must be permitted");

    // 7. But CANCELLED -> POSTED transition MUST FAIL
    let res_reopen_tx = conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_test'", []);
    assert!(res_reopen_tx.is_err(), "Transition CANCELLED -> POSTED must be rejected");

    cleanup_db(&path);
}

#[test]
fn test_scope2_verify_ledger_detects_intentional_discrepancies() {
    let (conn, path) = create_test_db("verify_chaos");

    // Migration 3 already seeded acc_1100, acc_4000, acc_1010.
    // Ensure test customer exists:
    conn.execute("INSERT OR IGNORE INTO entities (id, entity_code, entity_type, full_name, state_code) VALUES ('ent_c', 'C1', 'CUSTOMER', 'Cust', '27')", []).unwrap();

    // 1. Create an unbalanced transaction in ledger_entries
    conn.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            'tx_unbalanced', 'POSTED', '27', '27', 'INV', 'INV/26-27/0002', 'ent_c',
            10000, 0, 10000, 0, 0, 0, 0, 10000, 'usr_chaos', 'SALE', NULL, '2026-05-10'
        )",
        [],
    ).unwrap();

    // Insert only debit 10000, no credit!
    conn.execute(
        "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
         VALUES ('le_unb_1', 'tx_unbalanced', NULL, 'acc_1100', 10000, 0, 'Unbalanced')",
        [],
    ).unwrap();

    let disc = verify_ledger(&conn).unwrap();
    println!("verify_ledger output on unbalanced tx: {:?}", disc);
    assert!(disc.iter().any(|d| matches!(d, LedgerDiscrepancy::UnbalancedTransaction { net_difference_paise: 10000, .. })));
    assert!(disc.iter().any(|d| matches!(d, LedgerDiscrepancy::GlobalImbalance { total_debit_paise: 10000, total_credit_paise: 0 })));

    // 2. Unbalanced payment
    conn.execute(
        "INSERT INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, created_by_user_id)
         VALUES ('pay_unb', 'PAY/001', 'ent_c', 'CASH', 5000, 'usr_chaos')",
        [],
    ).unwrap();

    // Insert payment ledger entry with credit 5000, no debit
    conn.execute(
        "INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration)
         VALUES ('le_pay_1', NULL, 'pay_unb', 'acc_1100', 0, 5000, 'Unbalanced Pay')",
        [],
    ).unwrap();

    let disc_pay = verify_ledger(&conn).unwrap();
    assert!(disc_pay.iter().any(|d| matches!(d, LedgerDiscrepancy::UnbalancedPayment { net_difference_paise: -5000, .. })));

    cleanup_db(&path);
}

// ============================================================================
// 3. IPC Commands Bridge Edge Cases
// ============================================================================

#[test]
fn test_scope3_ipc_commands_invalid_inputs() {
    let (conn, path) = create_test_db("ipc_chaos");
    let path_str = path.to_str().unwrap().to_string();

    // 1. Corrupt db_path
    let res_corrupt_path = cmd_get_resources("/nonexistent/directory/that/does/not/exist/db.sqlite".to_string());
    assert!(res_corrupt_path.is_err(), "Nonexistent db_path must return error");

    // 2. Nonexistent resource ID in sale
    let bad_sale = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_does_not_exist_xyz".into(),
            quantity_milli: 1000,
            unit_price_paise: 1000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };
    let res_bad_sale = cmd_post_sale(path_str.clone(), bad_sale);
    let err_msg = res_bad_sale.unwrap_err();
    assert!(err_msg.contains("ResourceNotFound") || err_msg.contains("FOREIGN KEY"));

    // 3. Malformed/invalid entity creation input (invalid entity_type enum)
    let bad_entity = CreateEntityInput {
        id: None,
        entity_code: "CHAOS_TYPE".into(),
        entity_type: "INVALID_TYPE_ENUM".into(),
        full_name: "Hacker Corp".into(),
        phone: None,
        gstin: None,
        state_code: "27".into(),
    };
    let res_bad_entity = cmd_create_entity(path_str.clone(), bad_entity);
    assert!(res_bad_entity.is_err(), "Entity with invalid entity_type must fail check constraint");

    // 4. Resource creation with negative price
    let bad_resource = CreateResourceInput {
        id: None,
        sku_or_code: "NEG-PRICE".into(),
        name: "Negative Item".into(),
        hsn_sac: "1234".into(),
        tax_rate_bps: 1800,
        base_price_paise: -500,
        cost_price_paise: None,
        is_stock_tracked: Some(true),
        initial_stock_milli: None,
    };
    let res_bad_res = cmd_create_resource(path_str.clone(), bad_resource);
    assert!(res_bad_res.is_err(), "Resource with negative base_price_paise must fail CHECK constraint");

    // 5. Resource creation with tax_rate_bps > 10000: DOES SQLITE ALLOW IT?
    let extreme_tax_resource = CreateResourceInput {
        id: Some("res_extreme_tax".into()),
        sku_or_code: "EXTREME-TAX".into(),
        name: "Extreme Tax Item".into(),
        hsn_sac: "1234".into(),
        tax_rate_bps: 50000, // 500% tax
        base_price_paise: 1000,
        cost_price_paise: None,
        is_stock_tracked: Some(false),
        initial_stock_milli: None,
    };
    let res_extreme = cmd_create_resource(path_str.clone(), extreme_tax_resource);
    println!("cmd_create_resource with tax_rate_bps=50000: {:?}", res_extreme);
    assert!(res_extreme.is_err(), "cmd_create_resource must reject tax_rate_bps > 10000");

    drop(conn);
    cleanup_db(&path);
}

// ============================================================================
// 4. Hardware: ESC/POS Printer & Backup Engine
// ============================================================================

#[test]
fn test_scope4_printer_extreme_inputs_and_unicode() {
    // 1. Zero items receipt
    let empty_receipt = ReceiptData::new(
        "Store With No Items",
        "INV/0001",
        "2026-05-10",
        vec![],
        ReceiptTaxSummary::default(),
    );
    let bytes_empty = generate_escpos_bytes(&empty_receipt, PaperWidth::Mm80);
    assert!(!bytes_empty.is_empty(), "Empty items receipt should generate valid ESC/POS header and footer");

    // 2. 100 items receipt
    let items_100: Vec<ReceiptItem> = (0..100)
        .map(|i| ReceiptItem::new(format!("Item {:03}", i), 1000, 1000, 1800, 1180))
        .collect();
    let big_receipt = ReceiptData::new(
        "100 Items Store",
        "INV/0100",
        "2026-05-10",
        items_100,
        ReceiptTaxSummary::default(),
    );
    let bytes_100 = generate_escpos_bytes(&big_receipt, PaperWidth::Mm80);
    assert!(bytes_100.len() > 1000, "100-item receipt should generate substantial bytes");

    // 3. Special Hindi/Indian script characters and Unicode strings
    let hindi_item = ReceiptItem::new(
        "नमस्ते सुपरमार्केट और किराना स्टोर",
        1500,
        25000,
        1800,
        29500,
    );
    let hindi_receipt = ReceiptData::new(
        "दुकान का नाम - मुंबई",
        "INV/हिन्दी/01",
        "2026-05-10",
        vec![hindi_item],
        ReceiptTaxSummary::default(),
    );
    let bytes_hindi_80 = generate_escpos_bytes(&hindi_receipt, PaperWidth::Mm80);
    assert!(!bytes_hindi_80.is_empty(), "Hindi characters should produce byte stream");

    let bytes_hindi_58 = generate_escpos_bytes(&hindi_receipt, PaperWidth::Mm58);
    assert!(!bytes_hindi_58.is_empty(), "Hindi on 58mm should produce byte stream");

    // 4. Format paise with i64::MIN - DOES IT PANIC ON i64::MIN.abs()?
    let result_paise_min = std::panic::catch_unwind(|| {
        format_paise(i64::MIN)
    });
    println!("format_paise(i64::MIN) panicked: {}", result_paise_min.is_err());
    assert!(result_paise_min.is_ok(), "format_paise(i64::MIN) must not panic");

    let result_qty_min = std::panic::catch_unwind(|| {
        format_quantity_milli(i64::MIN)
    });
    println!("format_quantity_milli(i64::MIN) panicked: {}", result_qty_min.is_err());
    assert!(result_qty_min.is_ok(), "format_quantity_milli(i64::MIN) must not panic");
}

#[test]
fn test_scope4_backup_engine_corruptions_and_passphrases() {
    let (conn, db_path) = create_test_db("backup_chaos");
    let temp_dir = std::env::temp_dir();
    let backup_path = temp_dir.join(format!("test_backup_{}.omnibackup", uuid::Uuid::new_v4()));
    let restore_target = temp_dir.join(format!("test_restore_{}.db", uuid::Uuid::new_v4()));

    // 1. Create encrypted backup
    let meta = create_backup(&conn, backup_path.to_str().unwrap(), Some("SecretPassword123!")).unwrap();
    assert_eq!(meta.schema_version, LATEST_VERSION);

    // 2. Restore with WRONG passphrase -> Must fail with InvalidPassphrase
    let res_wrong_pw = restore_backup(
        backup_path.to_str().unwrap(),
        restore_target.to_str().unwrap(),
        Some("WrongPasswordXYZ"),
    );
    assert!(matches!(res_wrong_pw, Err(BackupError::InvalidPassphrase)));

    // 3. Restore with NO passphrase when encrypted -> Must fail with PassphraseRequired
    let res_no_pw = restore_backup(
        backup_path.to_str().unwrap(),
        restore_target.to_str().unwrap(),
        None,
    );
    assert!(matches!(res_no_pw, Err(BackupError::PassphraseRequired)));

    // 4. Truncated backup file (e.g. 10 bytes)
    let trunc_path = temp_dir.join(format!("trunc_{}.omnibackup", uuid::Uuid::new_v4()));
    fs::write(&trunc_path, b"OMNIBACKUP").unwrap();
    let res_trunc = restore_backup(
        trunc_path.to_str().unwrap(),
        restore_target.to_str().unwrap(),
        Some("SecretPassword123!"),
    );
    assert!(matches!(res_trunc, Err(BackupError::InvalidHeader(_))));

    // 5. Corrupted bytes in payload (tampered ciphertext)
    let mut backup_bytes = fs::read(&backup_path).unwrap();
    // Tamper the last 10 bytes
    let len = backup_bytes.len();
    backup_bytes[len - 5] ^= 0xFF;
    let corrupt_path = temp_dir.join(format!("corrupt_{}.omnibackup", uuid::Uuid::new_v4()));
    fs::write(&corrupt_path, &backup_bytes).unwrap();

    let res_corrupt = restore_backup(
        corrupt_path.to_str().unwrap(),
        restore_target.to_str().unwrap(),
        Some("SecretPassword123!"),
    );
    // Tampered payload fails checksum check!
    assert!(matches!(res_corrupt, Err(BackupError::ChecksumMismatch { .. })));

    // 6. Restore to invalid read-only directory
    let res_bad_dir = restore_backup(
        backup_path.to_str().unwrap(),
        "/root/cannot_write_here_xyz.db",
        Some("SecretPassword123!"),
    );
    assert!(res_bad_dir.is_err(), "Restoring to non-writable path must fail with Io or Database error");

    // Cleanup
    let _ = fs::remove_file(&backup_path);
    let _ = fs::remove_file(&trunc_path);
    let _ = fs::remove_file(&corrupt_path);
    cleanup_db(&db_path);
}

#[test]
fn test_scope1_excessive_and_repeated_returns_vulnerability() {
    let (mut conn, path) = create_test_db("returns_chaos");

    // 1. Setup a sale of 1 item of SKU-01
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_item1', 'SKU-01', 'Item 1', '1234', 1800, 10000, 1)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
         VALUES ('lot_r1', 'res_item1', 'B001', 10000)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
         VALUES ('sm_r1', 'res_item1', 'lot_r1', 'PURCHASE', 5000)", // 5 units in stock
        [],
    ).unwrap();

    // Post a sale for 1 unit (1000 milli)
    let sale_input = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_item1".into(),
            quantity_milli: 1000,
            unit_price_paise: 10000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };
    let posted_sale = post_sale(&mut conn, &sale_input).unwrap();
    let orig_tx_id = posted_sale.transaction_id;

    // Check stock after sale: 5000 - 1000 = 4000
    let stock_after_sale: i64 = conn.query_row(
        "SELECT SUM(quantity_delta_milli) FROM stock_movements WHERE resource_id = 'res_item1'",
        [],
        |r| r.get(0),
    ).unwrap();
    assert_eq!(stock_after_sale, 4000);

    // 2. ADVERSARIAL ATTACK: Post a return for 10,000 units (10x more than sold!)
    let return_input_excessive = SaleReturnInput {
        return_date: "2026-05-11".into(),
        original_transaction_id: orig_tx_id.clone(),
        reason: Some("Customer claims returning 10 units".into()),
        lines: vec![LineInput {
            resource_id: "res_item1".into(),
            quantity_milli: 10_000, // 10 units returned when only 1 unit was sold!
            unit_price_paise: 10000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };

    let excessive_res = post_sale_return(&mut conn, &return_input_excessive);
    println!("post_sale_return with 10x quantity sold: {:?}", excessive_res);
    assert!(matches!(excessive_res, Err(PostingError::ReturnQuantityExceedsOriginal { .. })));

    // Stock has not been inflated; it remains 4000
    let stock_after_excessive: i64 = conn.query_row(
        "SELECT SUM(quantity_delta_milli) FROM stock_movements WHERE resource_id = 'res_item1'",
        [],
        |r| r.get(0),
    ).unwrap();
    println!("Stock after excessive return: {} milli (started with 5000, sold 1000)", stock_after_excessive);
    assert_eq!(stock_after_excessive, 4000);

    // 3. ADVERSARIAL ATTACK: Returning a resource that was NEVER part of the original transaction
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_unrelated', 'SKU-UNRELATED', 'Unrelated Item', '5678', 1800, 20000, 1)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
         VALUES ('lot_unrelated', 'res_unrelated', 'B999', 20000)",
        [],
    ).unwrap();

    let return_unrelated = SaleReturnInput {
        return_date: "2026-05-11".into(),
        original_transaction_id: orig_tx_id.clone(),
        reason: Some("Returning item never bought".into()),
        lines: vec![LineInput {
            resource_id: "res_unrelated".into(),
            quantity_milli: 2000,
            unit_price_paise: 20000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };

    let unrelated_res = post_sale_return(&mut conn, &return_unrelated);
    println!("post_sale_return with unrelated item: {:?}", unrelated_res);
    assert!(matches!(unrelated_res, Err(PostingError::InvalidOriginalTransaction(_))));

    cleanup_db(&path);
}

#[test]
fn test_scope1_payment_overallocation_vulnerability() {
    let (mut conn, path) = create_test_db("payment_chaos");

    // 1. Post a small sale of 1000 paise (₹10.00)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_cheap', 'CHEAP-01', 'Cheap Item', '1234', 0, 1000, 0)",
        [],
    ).unwrap();

    let sale_input = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_cheap".into(),
            quantity_milli: 1000,
            unit_price_paise: 1000,
            discount_paise: 0,
            tax_rate_bps: 0,
        }],
    };
    let posted_sale = post_sale(&mut conn, &sale_input).unwrap();
    assert_eq!(posted_sale.totals.total_amount_paise, 1000);

    // Get the walk-in customer entity ID
    let cust_id: String = conn.query_row(
        "SELECT entity_id FROM transactions WHERE id = ?1",
        params![&posted_sale.transaction_id],
        |r| r.get(0),
    ).unwrap();

    // 2. ADVERSARIAL ATTACK: Overallocate ₹1,000.00 (100,000 paise) to a ₹10.00 (1,000 paise) invoice
    let payment_input = PaymentInput {
        entity_id: cust_id,
        payment_mode: PaymentMode::Cash,
        amount_paise: 100_000, // 100x the invoice total!
        reference_number: Some("OVERPAY-100X".into()),
        payment_date: "2026-05-10".into(),
        allocations: vec![PaymentAllocationInput {
            transaction_id: posted_sale.transaction_id.clone(),
            amount_paise: 100_000,
        }],
    };

    let post_pay_res = post_payment(&mut conn, &payment_input);
    println!("post_payment with 100x invoice total allocation: {:?}", post_pay_res);
    assert!(matches!(post_pay_res, Err(PostingError::AllocationExceedsInvoiceBalance { .. })));

    let alloc_sum: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount_allocated_paise), 0) FROM payment_allocations WHERE transaction_id = ?1",
        params![&posted_sale.transaction_id],
        |r| r.get(0),
    ).unwrap();
    println!("Allocated on 1000 paise invoice: {} paise", alloc_sum);
    assert_eq!(alloc_sum, 0);

    cleanup_db(&path);
}
