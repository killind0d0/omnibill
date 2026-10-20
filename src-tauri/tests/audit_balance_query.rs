use omnibill_core::commands::*;
use omnibill_core::database::open_connection;
use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use omnibill_core::posting::{
    LineInput, PaymentMode, PaymentTenderInput, PriceMode, PurchaseInput,
    PurchaseLineInput, SaleInput, SaleReturnInput, SaleWithPaymentsInput,
};
use std::fs;

#[test]
fn test_live_ledger_balance_verification_query() {
    let test_dir = std::env::temp_dir().join("omnibill_ledger_audit_test");
    let _ = fs::create_dir_all(&test_dir);
    let db_path = test_dir.join("verified_ledger.db");
    if db_path.exists() {
        let _ = fs::remove_file(&db_path);
    }
    let db_path_str = db_path.to_str().unwrap().to_string();

    let mut conn = open_connection(&db_path_str).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    // 1. Seed Business Profile & Entities
    conn.execute(
        "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
         VALUES ('biz_1', 'OmniBill Retail Ltd', '27', '9876543210', 'Main St', 'Mumbai', '400001')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role)
         VALUES ('usr_1', 'cashier_alice', 'hash', 'Alice Cashier', 'CASHIER')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
         VALUES ('ent_c1', 'CUST-001', 'CUSTOMER', 'Priya Patel', '9876500001', '27AABCA1234A1Z5', '27')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
         VALUES ('ent_s1', 'SUPP-001', 'SUPPLIER', 'National Distributors', '9876500002', '27AABCS9999A1Z1', '27')",
        [],
    ).unwrap();

    // Seed Resources in Master Catalog
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
         VALUES ('res_med', 'MED-PAR', 'Paracetamol 500mg', '3004', 1800, 10000, 5000, 1)",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
         VALUES ('res_snack', 'SNK-CHIP', 'Potato Chips Salted', '1905', 500, 4000, 2000, 1)",
        [],
    ).unwrap();

    // 2. Seed Tracked Resources & Lots via Purchase Posting
    let pur = cmd_post_purchase(
        db_path_str.clone(),
        PurchaseInput {
            supplier: Some("ent_s1".to_string()),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            invoice_date: "2026-04-10".to_string(),
            price_mode: PriceMode::Exclusive,
            lines: vec![
                PurchaseLineInput {
                    resource_id: "res_med".to_string(),
                    batch_number: Some("BATCH-M1".to_string()),
                    expiry_date: Some("2028-12-31".to_string()),
                    quantity_milli: 10000, // 10 units
                    unit_price_paise: 5000, // Cost ₹50.00
                    mrp_paise: Some(10000), // MRP ₹100.00
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                },
                PurchaseLineInput {
                    resource_id: "res_snack".to_string(),
                    batch_number: Some("BATCH-S1".to_string()),
                    expiry_date: Some("2027-06-30".to_string()),
                    quantity_milli: 20000, // 20 units
                    unit_price_paise: 2000, // Cost ₹20.00
                    mrp_paise: Some(4000),  // MRP ₹40.00
                    discount_paise: 0,
                    tax_rate_bps: 500,
                },
            ],
        },
    ).expect("post purchase");
    println!(">>> Seeded Purchase: {} ({})", pur.invoice_number, pur.transaction_id);

    // 3. Post Retail Exclusive Sale
    let sale1 = cmd_post_sale(
        db_path_str.clone(),
        SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_c1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_med".to_string(),
                quantity_milli: 2000, // 2 units
                unit_price_paise: 10000, // ₹100.00
                discount_paise: 1000,    // ₹10.00 disc
                tax_rate_bps: 1800,      // 18%
            }],
        },
    ).expect("post sale 1");
    println!(">>> Seeded Sale 1: {} ({})", sale1.invoice_number, sale1.transaction_id);

    // 4. Post Atomic Sale with Split Payments (Cash + UPI)
    let sale_pay = cmd_post_sale_with_payments(
        db_path_str.clone(),
        SaleWithPaymentsInput {
            sale: SaleInput {
                invoice_date: "2026-04-16".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_c1".to_string()),
                price_mode: PriceMode::Inclusive, // Inclusive pricing back-calculation
                lines: vec![LineInput {
                    resource_id: "res_snack".to_string(),
                    quantity_milli: 5000, // 5 units
                    unit_price_paise: 4000, // ₹40.00 MRP
                    discount_paise: 0,
                    tax_rate_bps: 500,
                }],
            },
            payments: vec![
                PaymentTenderInput {
                    mode: PaymentMode::Cash,
                    amount_paise: 10000, // ₹100.00 cash
                    reference_number: Some("CASH-TENDER-01".to_string()),
                },
                PaymentTenderInput {
                    mode: PaymentMode::Upi,
                    amount_paise: 10000, // ₹100.00 UPI
                    reference_number: Some("UPI-TXN-777888".to_string()),
                },
            ],
        },
    ).expect("post sale with payments");
    println!(">>> Seeded Sale with Payments: {} ({})", sale_pay.sale.invoice_number, sale_pay.sale.transaction_id);

    // 5. Post Partial Sale Return (Credit Note)
    let ret = cmd_post_sale_return(
        db_path_str.clone(),
        SaleReturnInput {
            original_transaction_id: sale1.transaction_id.clone(),
            return_date: "2026-04-18".to_string(),
            lines: vec![LineInput {
                resource_id: "res_med".to_string(),
                quantity_milli: 1000, // 1 unit returned
                unit_price_paise: 10000,
                discount_paise: 500,
                tax_rate_bps: 1800,
            }],
            reason: Some("Customer over-ordered".to_string()),
        },
    ).expect("post return");
    println!(">>> Seeded Sale Return: {} ({})", ret.invoice_number, ret.transaction_id);

    // 6. Execute and Print Live Ledger Balance Audit Query
    println!("\n================================================================================");
    println!("   LIVE SQL AUDIT: TRANSACTION-LEVEL DOUBLE-ENTRY BALANCE QUERY");
    println!("================================================================================");

    let mut stmt = conn.prepare(
        "SELECT 
            COALESCE(le.transaction_id, le.payment_id) AS ref_id,
            CASE WHEN le.transaction_id IS NOT NULL THEN 'TRANSACTION' ELSE 'PAYMENT' END AS ref_type,
            COALESCE(t.invoice_number, p.payment_number) AS doc_number,
            SUM(le.debit_paise) AS total_debit_paise,
            SUM(le.credit_paise) AS total_credit_paise,
            (SUM(le.debit_paise) - SUM(le.credit_paise)) AS net_difference_paise
         FROM ledger_entries le
         LEFT JOIN transactions t ON le.transaction_id = t.id
         LEFT JOIN payments p ON le.payment_id = p.id
         GROUP BY COALESCE(le.transaction_id, le.payment_id)
         ORDER BY MIN(le.created_at) ASC"
    ).unwrap();

    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "N/A".to_string()),
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
        ))
    }).unwrap();

    for r in rows {
        let (ref_id, ref_type, doc_num, dr, cr, diff) = r.unwrap();
        println!(
            "[{:11}] Doc: {:16} | Dr: {:10} paise | Cr: {:10} paise | Diff: {:5} paise (ID: {})",
            ref_type, doc_num, dr, cr, diff, ref_id
        );
        assert_eq!(diff, 0, "Document {} must balance to exactly 0 paise", doc_num);
    }

    println!("--------------------------------------------------------------------------------");
    let (grand_dr, grand_cr): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0) FROM ledger_entries",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();

    println!(
        "GRAND TOTAL: Debit = {} paise (INR {:.2}) | Credit = {} paise (INR {:.2}) | Net Imbalance = {} paise",
        grand_dr, grand_dr as f64 / 100.0, grand_cr, grand_cr as f64 / 100.0, grand_dr - grand_cr
    );
    println!("================================================================================\n");

    assert_eq!(grand_dr, grand_cr, "Grand total debits must equal credits");

    // Also verify via the internal verify_ledger engine
    let discrepancies = cmd_verify_ledger(db_path_str).expect("verify ledger");
    assert!(discrepancies.is_empty(), "Expected 0 discrepancies, found: {:?}", discrepancies);
}
