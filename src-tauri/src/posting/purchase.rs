use super::series::allocate_invoice_number;
use super::tax::compute_sale;
use super::{LineInput, PostedSaleTotals, PostingError, PriceMode, SaleInput};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PurchaseLineInput {
    pub resource_id: String,
    pub batch_number: Option<String>,
    pub expiry_date: Option<String>,
    pub mrp_paise: Option<i64>,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub discount_paise: i64,
    pub tax_rate_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PurchaseInput {
    pub invoice_date: String,
    pub supplier_state_code: String,
    pub place_of_supply_state_code: String,
    pub supplier: Option<String>,
    pub price_mode: PriceMode,
    pub lines: Vec<PurchaseLineInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedPurchase {
    pub transaction_id: String,
    pub invoice_number: String,
    pub totals: PostedSaleTotals,
}

/// Generates a unique lowercase hex ID prefixed with `prefix`.
fn generate_id(tx: &Transaction<'_>, prefix: &str) -> Result<String, PostingError> {
    let hex_val: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    Ok(format!("{}_{}", prefix, hex_val))
}

/// Posts a purchase transaction into SQLite inside a single immediate transaction.
///
/// Steps:
/// 1. Connection guard: verifies PRAGMA recursive_triggers = 1 and foreign_keys = 1.
/// 2. Tax and line computation (checked arithmetic).
/// 3. Allocates gapless series number using series "PUR".
/// 4. Resolves supplier entity and active user.
/// 5. Inserts `transactions` with status = 'POSTED', transaction_type = 'PURCHASE', original_transaction_id = NULL.
/// 6. Ingests inventory into `resource_lots` (finding or inserting lots) and writes positive `stock_movements` for stock-tracked items.
/// 7. Inserts `transaction_items` (storing lot_id).
/// 8. Posts balanced double-entry `ledger_entries` (debit Inventory, debit Input GST, credit AP, round off).
/// 9. Commits transaction.
pub fn post_purchase(
    conn: &mut Connection,
    input: &PurchaseInput,
) -> Result<PostedPurchase, PostingError> {
    // 1. Connection guard: verify connection was configured with required pragmas
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // 2. Validate and compute all line amounts and document totals
    if input.lines.is_empty() {
        return Err(PostingError::EmptyLines);
    }

    let sale_input = SaleInput {
        invoice_date: input.invoice_date.clone(),
        seller_state_code: input.supplier_state_code.clone(),
        place_of_supply_state_code: input.place_of_supply_state_code.clone(),
        customer: input.supplier.clone(),
        price_mode: input.price_mode,
        lines: input
            .lines
            .iter()
            .map(|l| LineInput {
                resource_id: l.resource_id.clone(),
                quantity_milli: l.quantity_milli,
                unit_price_paise: l.unit_price_paise,
                discount_paise: l.discount_paise,
                tax_rate_bps: l.tax_rate_bps,
            })
            .collect(),
    };
    let computation = compute_sale(&sale_input)?;

    // Begin immediate transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 3. Allocate invoice number for series "PUR"
    let (series, invoice_number) = allocate_invoice_number(&tx, "PUR", &input.invoice_date)?;

    // 4. Resolve supplier entity
    let entity_id = match &input.supplier {
        Some(sid) => {
            let exists: i64 = tx.query_row(
                "SELECT COUNT(*) FROM entities WHERE id = ?1",
                params![sid],
                |r| r.get(0),
            )?;
            if exists == 0 {
                return Err(PostingError::EntityNotFound(sid.clone()));
            }
            sid.clone()
        }
        None => {
            let default_id = "ent_cash_vendor";
            tx.execute(
                "INSERT OR IGNORE INTO entities (
                    id, entity_code, entity_type, full_name, state_code
                ) VALUES (?1, 'CASH_VENDOR', 'SUPPLIER', 'Cash Vendor', ?2)",
                params![default_id, &input.supplier_state_code],
            )?;
            default_id.to_string()
        }
    };

    // 5. Resolve active user
    let user_id: String = match tx.query_row(
        "SELECT id FROM users WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        Ok(id) => id,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let default_user = "usr_system";
            tx.execute(
                "INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role)
                 VALUES (?1, 'system', 'sys_hash', 'System User', 'CASHIER')",
                params![default_user],
            )?;
            default_user.to_string()
        }
        Err(e) => return Err(PostingError::Database(e)),
    };

    let tx_id = generate_id(&tx, "tx")?;

    // 6. Insert transactions row
    tx.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            transaction_type, original_transaction_id, invoice_date, created_by_user_id
        ) VALUES (
            ?1, 'POSTED', ?2, ?3, ?4,
            ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14,
            'PURCHASE', NULL, ?15, ?16
        )",
        params![
            &tx_id,
            &input.supplier_state_code,
            &input.place_of_supply_state_code,
            &series,
            &invoice_number,
            &entity_id,
            computation.totals.subtotal_paise,
            computation.totals.discount_paise,
            computation.totals.taxable_paise,
            computation.totals.cgst_paise,
            computation.totals.sgst_paise,
            computation.totals.igst_paise,
            computation.totals.round_off_paise,
            computation.totals.total_amount_paise,
            &input.invoice_date,
            &user_id,
        ],
    )?;

    // 7. Process lines: Ingest inventory into resource_lots and insert transaction_items
    for (line, computed_line) in input.lines.iter().zip(&computation.lines) {
        let is_tracked: i64 = match tx.query_row(
            "SELECT is_stock_tracked FROM resources WHERE id = ?1",
            params![&line.resource_id],
            |r| r.get(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(PostingError::ResourceNotFound(line.resource_id.clone()));
            }
            Err(e) => return Err(PostingError::Database(e)),
        };

        let lot_id: Option<String> = if is_tracked == 1 {
            let batch_number = line.batch_number.as_deref().unwrap_or("DEFAULT");
            let existing_lot: Option<String> = tx
                .query_row(
                    "SELECT id FROM resource_lots WHERE resource_id = ?1 AND batch_number = ?2",
                    params![&line.resource_id, batch_number],
                    |r| r.get(0),
                )
                .optional()?;

            let lot_id = match existing_lot {
                Some(id) => id,
                None => {
                    let new_id = generate_id(&tx, "lot")?;
                    let mrp = match line.mrp_paise {
                        Some(m) => m,
                        None => {
                            let base_price: i64 = tx
                                .query_row(
                                    "SELECT base_price_paise FROM resources WHERE id = ?1",
                                    params![&line.resource_id],
                                    |r| r.get(0),
                                )
                                .unwrap_or(line.unit_price_paise);
                            if base_price > 0 {
                                base_price
                            } else {
                                line.unit_price_paise
                            }
                        }
                    };

                    tx.execute(
                        "INSERT INTO resource_lots (
                            id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            &new_id,
                            &line.resource_id,
                            batch_number,
                            &line.expiry_date,
                            mrp,
                            line.unit_price_paise,
                        ],
                    )?;
                    new_id
                }
            };

            let sm_id = generate_id(&tx, "sm")?;
            tx.execute(
                "INSERT INTO stock_movements (
                    id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
                ) VALUES (?1, ?2, ?3, ?4, 'PURCHASE', ?5)",
                params![
                    &sm_id,
                    &line.resource_id,
                    &lot_id,
                    &tx_id,
                    line.quantity_milli,
                ],
            )?;

            Some(lot_id)
        } else {
            None
        };

        let item_id = generate_id(&tx, "ti")?;
        tx.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13
            )",
            params![
                &item_id,
                &tx_id,
                &line.resource_id,
                &lot_id,
                line.quantity_milli,
                line.unit_price_paise,
                computed_line.discount_paise,
                computed_line.taxable_paise,
                computed_line.tax_rate_bps,
                computed_line.cgst_paise,
                computed_line.sgst_paise,
                computed_line.igst_paise,
                computed_line.line_total_paise,
            ],
        )?;
    }

    // 8. Balanced double-entry ledger entries
    // Debit Inventory (acc_1200) for taxable_paise
    if computation.totals.taxable_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1200', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.taxable_paise,
                format!("Inventory Purchase for {}", invoice_number),
            ],
        )?;
    }

    // Debit Input CGST (acc_2100) for cgst_paise (if > 0)
    if computation.totals.cgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2100', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.cgst_paise,
                format!("Input CGST on {}", invoice_number),
            ],
        )?;
    }

    // Debit Input SGST (acc_2110) for sgst_paise (if > 0)
    if computation.totals.sgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2110', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.sgst_paise,
                format!("Input SGST on {}", invoice_number),
            ],
        )?;
    }

    // Debit Input IGST (acc_2120) for igst_paise (if > 0)
    if computation.totals.igst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2120', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.igst_paise,
                format!("Input IGST on {}", invoice_number),
            ],
        )?;
    }

    // Round off: if round_off_paise > 0 debit acc_4900; if < 0 credit acc_4900
    if computation.totals.round_off_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise,
                format!("Round off on {}", invoice_number),
            ],
        )?;
    } else if computation.totals.round_off_paise < 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise.abs(),
                format!("Round off on {}", invoice_number),
            ],
        )?;
    }

    // Credit Accounts Payable (acc_2000) for total_amount_paise
    if computation.totals.total_amount_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2000', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.total_amount_paise,
                format!("Purchase Invoice {}", invoice_number),
            ],
        )?;
    }

    // 9. Assert Ledger strictly balanced before commit
    let (debit_sum, credit_sum): (i64, i64) = tx.query_row(
        "SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0)
         FROM ledger_entries
         WHERE transaction_id = ?1",
        params![&tx_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    if debit_sum != credit_sum {
        return Err(PostingError::UnbalancedLedger {
            debit_paise: debit_sum,
            credit_paise: credit_sum,
        });
    }

    // 10. Commit transaction
    tx.commit()?;

    Ok(PostedPurchase {
        transaction_id: tx_id,
        invoice_number,
        totals: PostedSaleTotals {
            subtotal_paise: computation.totals.subtotal_paise,
            discount_paise: computation.totals.discount_paise,
            taxable_paise: computation.totals.taxable_paise,
            cgst_paise: computation.totals.cgst_paise,
            sgst_paise: computation.totals.sgst_paise,
            igst_paise: computation.totals.igst_paise,
            round_off_paise: computation.totals.round_off_paise,
            total_amount_paise: computation.totals.total_amount_paise,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::{MIGRATIONS, run_migrations};
    use crate::database::queries::verify_ledger;
    use crate::posting::PriceMode;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap(); /* cfg(test) */
        crate::database::apply_pragmas(&conn).unwrap();
        run_migrations(&mut conn, MIGRATIONS).unwrap();

        // Seed basic fixtures
        conn.execute(
            "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
             VALUES ('biz_1', 'OmniMart Corp', '27', '9876543210', 'Market Rd', 'Mumbai', '400001')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_1', 'purchaser_bob', 'hash_val', 'Bob Builder', 'MANAGER')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_supp_intra', 'SUPP-001', 'SUPPLIER', 'Intra-state Supplier Ltd', '27')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_supp_inter', 'SUPP-002', 'SUPPLIER', 'Inter-state Trader LLC', '29')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_tracked_1', 'SKU-001', 'Tracked Component', '8471', 1800, 10000, 1)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_service_1', 'SRV-001', 'Logistics & Consulting', '9983', 1800, 50000, 0)",
            [],
        ).unwrap();

        conn
    }

    #[test]
    fn test_connection_guard_rejects_insecure_connection() {
        let mut raw_conn = Connection::open_in_memory().unwrap(); /* cfg(test) */
        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 5000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_purchase(&mut raw_conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InsecureConnection { .. } => {}
            other => panic!("Expected InsecureConnection, got {:?}", other),
        }
    }

    #[test]
    fn test_empty_lines_rejected() {
        let mut conn = setup_test_db();
        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![],
        };

        let res = post_purchase(&mut conn, &input);
        assert!(matches!(res.unwrap_err(), PostingError::EmptyLines));
    }

    #[test]
    fn test_invalid_line_inputs() {
        let mut conn = setup_test_db();
        let base_input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![],
        };

        // Zero quantity
        let res = post_purchase(
            &mut conn,
            &PurchaseInput {
                lines: vec![PurchaseLineInput {
                    resource_id: "res_tracked_1".to_string(),
                    batch_number: None,
                    expiry_date: None,
                    mrp_paise: None,
                    quantity_milli: 0,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
                ..base_input.clone()
            },
        );
        assert!(matches!(res.unwrap_err(), PostingError::InvalidQuantity(0)));

        // Negative quantity
        let res = post_purchase(
            &mut conn,
            &PurchaseInput {
                lines: vec![PurchaseLineInput {
                    resource_id: "res_tracked_1".to_string(),
                    batch_number: None,
                    expiry_date: None,
                    mrp_paise: None,
                    quantity_milli: -500,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
                ..base_input.clone()
            },
        );
        assert!(matches!(
            res.unwrap_err(),
            PostingError::InvalidQuantity(-500)
        ));

        // Negative unit price
        let res = post_purchase(
            &mut conn,
            &PurchaseInput {
                lines: vec![PurchaseLineInput {
                    resource_id: "res_tracked_1".to_string(),
                    batch_number: None,
                    expiry_date: None,
                    mrp_paise: None,
                    quantity_milli: 1000,
                    unit_price_paise: -1,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
                ..base_input.clone()
            },
        );
        assert!(matches!(
            res.unwrap_err(),
            PostingError::InvalidUnitPrice(-1)
        ));

        // Discount exceeds gross
        let res = post_purchase(
            &mut conn,
            &PurchaseInput {
                lines: vec![PurchaseLineInput {
                    resource_id: "res_tracked_1".to_string(),
                    batch_number: None,
                    expiry_date: None,
                    mrp_paise: None,
                    quantity_milli: 1000,
                    unit_price_paise: 5000,
                    discount_paise: 6000,
                    tax_rate_bps: 1800,
                }],
                ..base_input.clone()
            },
        );
        assert!(matches!(
            res.unwrap_err(),
            PostingError::InvalidDiscount { .. }
        ));

        // Invalid tax rate > 10000
        let res = post_purchase(
            &mut conn,
            &PurchaseInput {
                lines: vec![PurchaseLineInput {
                    resource_id: "res_tracked_1".to_string(),
                    batch_number: None,
                    expiry_date: None,
                    mrp_paise: None,
                    quantity_milli: 1000,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 10001,
                }],
                ..base_input
            },
        );
        assert!(matches!(
            res.unwrap_err(),
            PostingError::InvalidTaxRate(10001)
        ));
    }

    #[test]
    fn test_intra_state_purchase_cgst_sgst() {
        let mut conn = setup_test_db();

        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: Some("BATCH-101".to_string()),
                expiry_date: Some("2028-06-30".to_string()),
                mrp_paise: Some(12000),
                quantity_milli: 10000,  // 10 units
                unit_price_paise: 8000, // 80.00 INR per unit
                discount_paise: 5000,   // 50.00 INR discount
                tax_rate_bps: 1800,     // 18% GST (9% CGST + 9% SGST)
            }],
        };

        // Gross = round(10000 * 8000 / 1000) = 80000 paise
        // Discount = 5000 paise
        // Taxable = 75000 paise
        // CGST = round(75000 * 1800 / 20000) = 6750 paise
        // SGST = 6750 paise
        // IGST = 0 paise
        // Total before roundoff = 75000 + 6750 + 6750 = 88500 paise
        // Total = 88500 paise, round_off = 0

        let posted = post_purchase(&mut conn, &input).expect("Purchase must post successfully");

        assert_eq!(posted.totals.subtotal_paise, 80000);
        assert_eq!(posted.totals.discount_paise, 5000);
        assert_eq!(posted.totals.taxable_paise, 75000);
        assert_eq!(posted.totals.cgst_paise, 6750);
        assert_eq!(posted.totals.sgst_paise, 6750);
        assert_eq!(posted.totals.igst_paise, 0);
        assert_eq!(posted.totals.round_off_paise, 0);
        assert_eq!(posted.totals.total_amount_paise, 88500);

        // Verify transactions row
        let (tx_type, orig_id, status, subtotal, discount, taxable, cgst, sgst, igst, total): (
            String,
            Option<String>,
            String,
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = conn
            .query_row(
                "SELECT transaction_type, original_transaction_id, status, subtotal_paise,
                        discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_amount_paise
                 FROM transactions WHERE id = ?1",
                params![&posted.transaction_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(tx_type, "PURCHASE");
        assert_eq!(orig_id, None);
        assert_eq!(status, "POSTED");
        assert_eq!(subtotal, 80000);
        assert_eq!(discount, 5000);
        assert_eq!(taxable, 75000);
        assert_eq!(cgst, 6750);
        assert_eq!(sgst, 6750);
        assert_eq!(igst, 0);
        assert_eq!(total, 88500);

        // Verify ledger entries:
        // Debit Inventory (acc_1200): 75000
        // Credit Accounts Payable (acc_2000): 88500
        // Debit Input CGST (acc_2100): 6750
        // Debit Input SGST (acc_2110): 6750
        let entries: Vec<(String, i64, i64)> = conn
            .prepare(
                "SELECT account_id, debit_paise, credit_paise
                 FROM ledger_entries
                 WHERE transaction_id = ?1
                 ORDER BY account_id ASC",
            )
            .unwrap()
            .query_map(params![&posted.transaction_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            entries,
            vec![
                ("acc_1200".to_string(), 75000, 0),
                ("acc_2000".to_string(), 0, 88500),
                ("acc_2100".to_string(), 6750, 0),
                ("acc_2110".to_string(), 6750, 0),
            ]
        );

        // Verify ledger balance with verify_ledger
        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_inter_state_purchase_igst() {
        let mut conn = setup_test_db();

        let input = PurchaseInput {
            invoice_date: "2026-04-16".to_string(),
            supplier_state_code: "29".to_string(), // Karnataka supplier
            place_of_supply_state_code: "27".to_string(), // Maharashtra buyer
            supplier: Some("ent_supp_inter".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: Some("BATCH-INTER-1".to_string()),
                expiry_date: None,
                mrp_paise: Some(15000),
                quantity_milli: 5000,    // 5 units
                unit_price_paise: 20000, // 200.00 INR
                discount_paise: 0,
                tax_rate_bps: 1800, // 18% IGST
            }],
        };

        // Gross = round(5000 * 20000 / 1000) = 100000 paise
        // Taxable = 100000 paise
        // IGST = round(100000 * 1800 / 10000) = 18000 paise
        // CGST = 0, SGST = 0
        // Total = 118000 paise

        let posted = post_purchase(&mut conn, &input).expect("Inter-state purchase must succeed");

        assert_eq!(posted.totals.taxable_paise, 100000);
        assert_eq!(posted.totals.cgst_paise, 0);
        assert_eq!(posted.totals.sgst_paise, 0);
        assert_eq!(posted.totals.igst_paise, 18000);
        assert_eq!(posted.totals.total_amount_paise, 118000);

        // Verify ledger entries:
        // Debit Inventory (acc_1200): 100000
        // Debit Input IGST (acc_2120): 18000
        // Credit Accounts Payable (acc_2000): 118000
        let entries: Vec<(String, i64, i64)> = conn
            .prepare(
                "SELECT account_id, debit_paise, credit_paise
                 FROM ledger_entries
                 WHERE transaction_id = ?1
                 ORDER BY account_id ASC",
            )
            .unwrap()
            .query_map(params![&posted.transaction_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            entries,
            vec![
                ("acc_1200".to_string(), 100000, 0),
                ("acc_2000".to_string(), 0, 118000),
                ("acc_2120".to_string(), 18000, 0),
            ]
        );

        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_ingestion_into_resource_lots_and_stock_movements() {
        let mut conn = setup_test_db();

        // 1. First purchase: with new batch number BATCH-A
        let input_1 = PurchaseInput {
            invoice_date: "2026-04-10".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: Some("BATCH-A".to_string()),
                expiry_date: Some("2029-12-31".to_string()),
                mrp_paise: Some(15000),
                quantity_milli: 5000,
                unit_price_paise: 9000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let posted_1 = post_purchase(&mut conn, &input_1).unwrap();

        // Verify lot created
        let (lot_id, batch, expiry, mrp): (String, String, Option<String>, i64) = conn
            .query_row(
                "SELECT id, batch_number, expiry_date, mrp_paise FROM resource_lots
                 WHERE resource_id = 'res_tracked_1' AND batch_number = 'BATCH-A'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();

        assert_eq!(batch, "BATCH-A");
        assert_eq!(expiry, Some("2029-12-31".to_string()));
        assert_eq!(mrp, 15000);

        // Verify stock movement for purchase 1
        let (sm_lot_id, sm_reason, sm_delta): (String, String, i64) = conn
            .query_row(
                "SELECT lot_id, reason, quantity_delta_milli FROM stock_movements
                 WHERE transaction_id = ?1",
                params![&posted_1.transaction_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();

        assert_eq!(sm_lot_id, lot_id);
        assert_eq!(sm_reason, "PURCHASE");
        assert_eq!(sm_delta, 5000);

        // Verify transaction item lot_id
        let ti_lot_id: Option<String> = conn
            .query_row(
                "SELECT lot_id FROM transaction_items WHERE transaction_id = ?1",
                params![&posted_1.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ti_lot_id, Some(lot_id.clone()));

        // 2. Second purchase: same resource and same batch BATCH-A
        let input_2 = PurchaseInput {
            invoice_date: "2026-04-12".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: Some("BATCH-A".to_string()),
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 3000,
                unit_price_paise: 9500,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let posted_2 = post_purchase(&mut conn, &input_2).unwrap();

        // Verify NO duplicate lot row created
        let lot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM resource_lots WHERE resource_id = 'res_tracked_1' AND batch_number = 'BATCH-A'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            lot_count, 1,
            "Must reuse existing lot without inserting duplicate"
        );

        // Verify second stock movement points to the same lot
        let (sm_lot_id_2, sm_delta_2): (String, i64) = conn
            .query_row(
                "SELECT lot_id, quantity_delta_milli FROM stock_movements
                 WHERE transaction_id = ?1",
                params![&posted_2.transaction_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(sm_lot_id_2, lot_id);
        assert_eq!(sm_delta_2, 3000);

        // Cumulative stock on lot_id is 5000 + 3000 = 8000
        let total_lot_stock: i64 = conn
            .query_row(
                "SELECT SUM(quantity_delta_milli) FROM stock_movements WHERE lot_id = ?1",
                params![&lot_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(total_lot_stock, 8000);

        // 3. Third purchase: batch_number: None -> defaults to "DEFAULT"
        let input_3 = PurchaseInput {
            invoice_date: "2026-04-14".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: None, // Cash vendor
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 2500,
                unit_price_paise: 9000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let posted_3 = post_purchase(&mut conn, &input_3).unwrap();

        let default_lot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM resource_lots WHERE resource_id = 'res_tracked_1' AND batch_number = 'DEFAULT'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(default_lot_count, 1);

        let ti_default_lot: Option<String> = conn
            .query_row(
                "SELECT lot_id FROM transaction_items WHERE transaction_id = ?1",
                params![&posted_3.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(ti_default_lot.is_some());

        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(discrepancies.is_empty());
    }

    #[test]
    fn test_non_stock_resource_handling() {
        let mut conn = setup_test_db();

        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_service_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 50000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let posted = post_purchase(&mut conn, &input).expect("Service purchase must post");

        // Verify zero stock movements written
        let sm_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM stock_movements WHERE transaction_id = ?1",
                params![&posted.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            sm_count, 0,
            "Non-stock resource must produce zero stock movements"
        );

        // Verify no resource_lots created for service
        let lot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM resource_lots WHERE resource_id = 'res_service_1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lot_count, 0, "Non-stock resource must not have lots");

        // Verify transaction item lot_id is NULL
        let lot_id: Option<String> = conn
            .query_row(
                "SELECT lot_id FROM transaction_items WHERE transaction_id = ?1",
                params![&posted.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(lot_id, None);

        // Verify ledger entries balanced
        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_round_off_gain_and_loss() {
        let mut conn = setup_test_db();

        // 1. Round off gain (round_off_paise > 0)
        // quantity_milli = 3333, unit_price = 100 paise -> gross = 333 paise.
        // tax_rate = 1800 -> CGST = 30, SGST = 30 -> total_before = 393 paise.
        // Rounded to nearest rupee = 400 paise. round_off = +7 paise.
        let input_gain = PurchaseInput {
            invoice_date: "2026-04-18".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 3333,
                unit_price_paise: 100,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let posted_gain = post_purchase(&mut conn, &input_gain).unwrap();
        assert_eq!(posted_gain.totals.round_off_paise, 7);
        assert_eq!(posted_gain.totals.total_amount_paise, 400);

        // Verify acc_4900 is debited 7 paise
        let (ro_debit, ro_credit): (i64, i64) = conn
            .query_row(
                "SELECT debit_paise, credit_paise FROM ledger_entries
                 WHERE transaction_id = ?1 AND account_id = 'acc_4900'",
                params![&posted_gain.transaction_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ro_debit, 7);
        assert_eq!(ro_credit, 0);

        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(discrepancies.is_empty());

        // 2. Round off loss (round_off_paise < 0)
        // quantity_milli = 1000, unit_price = 110 paise -> gross = 110 paise.
        // tax_rate = 500 (5%) -> CGST = round(110*500/20000) = 3, SGST = 3
        // total_before = 110 + 3 + 3 = 116 paise.
        // Rounded to nearest rupee = 100 paise. round_off = -16 paise.
        let input_loss = PurchaseInput {
            invoice_date: "2026-04-18".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 110,
                discount_paise: 0,
                tax_rate_bps: 500,
            }],
        };

        let posted_loss = post_purchase(&mut conn, &input_loss).unwrap();
        assert_eq!(posted_loss.totals.round_off_paise, -16);
        assert_eq!(posted_loss.totals.total_amount_paise, 100);

        // Verify acc_4900 is credited 16 paise
        let (ro_debit_loss, ro_credit_loss): (i64, i64) = conn
            .query_row(
                "SELECT debit_paise, credit_paise FROM ledger_entries
                 WHERE transaction_id = ?1 AND account_id = 'acc_4900'",
                params![&posted_loss.transaction_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ro_debit_loss, 0);
        assert_eq!(ro_credit_loss, 16);

        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(discrepancies.is_empty());
    }

    #[test]
    fn test_gapless_pur_number_series() {
        let mut conn = setup_test_db();

        let input_1 = PurchaseInput {
            invoice_date: "2026-05-01".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let p1 = post_purchase(&mut conn, &input_1).unwrap();
        assert_eq!(p1.invoice_number, "PUR/26-27/0001");

        let input_2 = PurchaseInput {
            invoice_date: "2026-05-02".to_string(),
            ..input_1
        };

        let p2 = post_purchase(&mut conn, &input_2).unwrap();
        assert_eq!(p2.invoice_number, "PUR/26-27/0002");

        let next_num: i64 = conn
            .query_row(
                "SELECT next_number FROM number_series WHERE series_code = 'PUR' AND financial_year = '2026-27'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(next_num, 3);
    }

    #[test]
    fn test_missing_resource_fails() {
        let mut conn = setup_test_db();
        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_does_not_exist".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = post_purchase(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::ResourceNotFound(id) => assert_eq!(id, "res_does_not_exist"),
            other => panic!("Expected ResourceNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_missing_supplier_fails() {
        let mut conn = setup_test_db();
        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_non_existent".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = post_purchase(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::EntityNotFound(id) => assert_eq!(id, "ent_non_existent"),
            other => panic!("Expected EntityNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_immutability_triggers_enforced_on_purchase() {
        let mut conn = setup_test_db();
        let input = PurchaseInput {
            invoice_date: "2026-04-15".to_string(),
            supplier_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            supplier: Some("ent_supp_intra".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![PurchaseLineInput {
                resource_id: "res_tracked_1".to_string(),
                batch_number: None,
                expiry_date: None,
                mrp_paise: None,
                quantity_milli: 1000,
                unit_price_paise: 5000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let purchase = post_purchase(&mut conn, &input).unwrap();

        // 1. UPDATE on ledger_entries must fail
        let res_le = conn.execute(
            "UPDATE ledger_entries SET debit_paise = 9999 WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_le.is_err());
        assert!(
            res_le
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 2. DELETE on ledger_entries must fail
        let res_del_le = conn.execute(
            "DELETE FROM ledger_entries WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_del_le.is_err());
        assert!(
            res_del_le
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 3. UPDATE on transactions total must fail
        let res_tx = conn.execute(
            "UPDATE transactions SET total_amount_paise = 9999 WHERE id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_tx.is_err());
        assert!(
            res_tx
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 4. DELETE on transactions must fail
        let res_del_tx = conn.execute(
            "DELETE FROM transactions WHERE id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_del_tx.is_err());
        assert!(
            res_del_tx
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 5. UPDATE on transaction_items must fail
        let res_ti = conn.execute(
            "UPDATE transaction_items SET unit_price_paise = 9999 WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_ti.is_err());
        assert!(
            res_ti
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 6. DELETE on transaction_items must fail
        let res_del_ti = conn.execute(
            "DELETE FROM transaction_items WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_del_ti.is_err());
        assert!(
            res_del_ti
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 7. UPDATE on stock_movements must fail
        let res_sm = conn.execute(
            "UPDATE stock_movements SET quantity_delta_milli = 9999 WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_sm.is_err());
        assert!(
            res_sm
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );

        // 8. DELETE on stock_movements must fail
        let res_del_sm = conn.execute(
            "DELETE FROM stock_movements WHERE transaction_id = ?1",
            params![&purchase.transaction_id],
        );
        assert!(res_del_sm.is_err());
        assert!(
            res_del_sm
                .unwrap_err()
                .to_string()
                .contains("IMMUTABILITY_RULE_BROKEN")
        );
    }
}
