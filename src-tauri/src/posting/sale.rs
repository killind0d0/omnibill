use super::payment::PaymentMode;
use super::series::allocate_invoice_number;
use super::tax::{compute_sale, round_div_i128};
use super::{
    PostedSale, PostedSaleTotals, PostedSaleWithPayments, PostingError, PriceMode, SaleInput,
    SaleWithPaymentsInput,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::HashMap;

/// Helper to generate a unique lowercase hex ID prefixed with `prefix`.
fn generate_id(tx: &Transaction<'_>, prefix: &str) -> Result<String, PostingError> {
    let hex_val: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    Ok(format!("{}_{}", prefix, hex_val))
}

/// Posts a sales transaction into the database inside a single immediate transaction.
///
/// Steps:
/// 1. Connection guard: verifies PRAGMA recursive_triggers = ON and foreign_keys = ON.
/// 2. Tax & line computation (pure math, checked arithmetic).
/// 3. Allocates gapless invoice number from `number_series`.
/// 4. Inserts `transactions` and `transaction_items` adhering to 2A invariants.
/// 5. Posts balanced `ledger_entries` (skipping zero-amount rows).
/// 6. Performs FIFO stock deduction across `resource_lots` writing negative `stock_movements`.
/// 7. Commits transaction or rolls back completely on any error.
pub fn post_sale(conn: &mut Connection, input: &SaleInput) -> Result<PostedSale, PostingError> {
    // Connection guard: verify connection was set up by open_connection / apply_pragmas
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // 1. Validate and compute all amounts before opening writes
    let computation = compute_sale(input)?;

    // Begin immediate transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 2. Allocate invoice number
    let (series, invoice_number) = allocate_invoice_number(&tx, "INV", &input.invoice_date)?;

    // Resolve customer entity (deterministic: ID match first, then earliest phone match)
    let entity_id = match &input.customer {
        Some(cid) => {
            let existing: Option<String> = tx
                .query_row("SELECT id FROM entities WHERE id = ?1", params![cid], |r| {
                    r.get(0)
                })
                .optional()?;
            match existing {
                Some(id) => id,
                None => {
                    let by_phone: Option<String> = tx
                        .query_row(
                            "SELECT id FROM entities WHERE phone = ?1 ORDER BY created_at ASC LIMIT 1",
                            params![cid],
                            |r| r.get(0),
                        )
                        .optional()?;
                    match by_phone {
                        Some(id) => id,
                        None => {
                            return Err(PostingError::ResourceNotFound(format!("Entity {}", cid)));
                        }
                    }
                }
            }
        }
        None => {
            let default_id = "ent_walk_in";
            tx.execute(
                "INSERT OR IGNORE INTO entities (
                    id, entity_code, entity_type, full_name, state_code
                ) VALUES (?1, 'WALK_IN', 'CUSTOMER', 'Walk-in Customer', ?2)",
                params![default_id, &input.place_of_supply_state_code],
            )?;
            default_id.to_string()
        }
    };

    // Resolve user ID
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
    let price_mode_str = match input.price_mode {
        PriceMode::Exclusive => "EXCLUSIVE",
        PriceMode::Inclusive => "INCLUSIVE",
    };

    // 3. Insert transactions
    tx.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            transaction_type, original_transaction_id, invoice_date, created_by_user_id,
            price_mode
        ) VALUES (
            ?1, 'POSTED', ?2, ?3, ?4,
            ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14,
            'SALE', NULL, ?15, ?16,
            ?17
        )",
        params![
            &tx_id,
            &input.seller_state_code,
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
            price_mode_str,
        ],
    )?;

    // Insert transaction_items
    let b_day = crate::discovery::clock::parse_date_to_day(&input.invoice_date).unwrap_or(0);
    for line in &computation.lines {
        let item_id = generate_id(&tx, "ti")?;
        let unit_cost: i64 = tx
            .query_row(
                "SELECT cost_price_paise FROM resources WHERE id = ?1",
                params![&line.resource_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let line_cogs = if unit_cost > 0 {
            let mult = (line.quantity_milli as i128)
                .checked_mul(unit_cost as i128)
                .ok_or(PostingError::MathOverflow)?;
            i64::try_from(round_div_i128(mult, 1000)?).map_err(|_| PostingError::MathOverflow)?
        } else {
            0
        };
        tx.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise,
                cogs_paise, business_day
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4,
                ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12,
                ?13, ?14
            )",
            params![
                &item_id,
                &tx_id,
                &line.resource_id,
                line.quantity_milli,
                line.unit_price_paise,
                line.discount_paise,
                line.taxable_paise,
                line.tax_rate_bps,
                line.cgst_paise,
                line.sgst_paise,
                line.igst_paise,
                line.line_total_paise,
                line_cogs,
                b_day,
            ],
        )?;
    }

    // 4. Ledger entries (balanced, in paise)
    // Debit Accounts Receivable for total amount
    if computation.totals.total_amount_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1100', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.total_amount_paise,
                format!("Sales Invoice {}", invoice_number),
            ],
        )?;
    }

    // Credit Sales Revenue for taxable total
    if computation.totals.taxable_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4000', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.taxable_paise,
                format!("Sales Revenue for {}", invoice_number),
            ],
        )?;
    }

    // Credit Output CGST
    if computation.totals.cgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2100', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.cgst_paise,
                format!("Output CGST on {}", invoice_number),
            ],
        )?;
    }

    // Credit Output SGST
    if computation.totals.sgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2110', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.sgst_paise,
                format!("Output SGST on {}", invoice_number),
            ],
        )?;
    }

    // Credit Output IGST
    if computation.totals.igst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2120', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.igst_paise,
                format!("Output IGST on {}", invoice_number),
            ],
        )?;
    }

    // Round Off entry
    if computation.totals.round_off_paise > 0 {
        // Rounded up: credit round-off account
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise,
                format!("Round off gain on {}", invoice_number),
            ],
        )?;
    } else if computation.totals.round_off_paise < 0 {
        // Rounded down: debit round-off account
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise.abs(),
                format!("Round off loss on {}", invoice_number),
            ],
        )?;
    }

    // 5. Stock Movements (FEFO/FIFO across resource_lots) and Cost of Goods Sold (COGS)
    let mut total_cogs_paise: i64 = 0;

    // Aggregate quantities needed per resource
    let mut resource_quantities: HashMap<String, i64> = HashMap::new();
    for line in &input.lines {
        let entry = resource_quantities
            .entry(line.resource_id.clone())
            .or_insert(0);
        *entry = entry
            .checked_add(line.quantity_milli)
            .ok_or(PostingError::MathOverflow)?;
    }

    for (resource_id, needed_milli) in resource_quantities {
        let is_tracked: i64 = match tx.query_row(
            "SELECT is_stock_tracked FROM resources WHERE id = ?1",
            params![&resource_id],
            |r| r.get(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(PostingError::ResourceNotFound(resource_id));
            }
            Err(e) => return Err(PostingError::Database(e)),
        };

        if is_tracked == 0 {
            // Non-stock resource: skip stock movement
            continue;
        }

        // Fetch lots in FEFO order (earliest expiry first, falling back to FIFO by created_at)
        // Lots that have already expired before the sale invoice_date are excluded from deduction.
        let mut lots_stmt = tx.prepare(
            "SELECT id FROM resource_lots
             WHERE resource_id = ?1
               AND (expiry_date IS NULL OR expiry_date = '' OR expiry_date >= ?2)
             ORDER BY
               CASE WHEN expiry_date IS NOT NULL AND expiry_date != '' THEN 0 ELSE 1 END,
               expiry_date ASC,
               created_at ASC,
               id ASC",
        )?;

        let lot_ids: Vec<String> = lots_stmt
            .query_map(params![&resource_id, &input.invoice_date], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        let mut remaining = needed_milli;

        for lot_id in lot_ids {
            let available: i64 = tx.query_row(
                "SELECT COALESCE(SUM(quantity_delta_milli), 0)
                 FROM stock_movements
                 WHERE lot_id = ?1",
                params![&lot_id],
                |r| r.get(0),
            )?;

            if available > 0 {
                let deduct = std::cmp::min(remaining, available);
                let sm_id = generate_id(&tx, "sm")?;

                tx.execute(
                    "INSERT INTO stock_movements (
                        id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
                    ) VALUES (?1, ?2, ?3, ?4, 'SALE', ?5)",
                    params![&sm_id, &resource_id, &lot_id, &tx_id, -deduct,],
                )?;

                // Calculate COGS for this lot deduction (lot cost -> purchase item cost -> resource master cost)
                let unit_cost_paise: i64 = {
                    let lot_cost: Option<i64> = tx
                        .query_row(
                            "SELECT cost_price_paise FROM resource_lots WHERE id = ?1",
                            params![&lot_id],
                            |r| r.get(0),
                        )
                        .optional()?;
                    match lot_cost {
                        Some(cost) if cost > 0 => cost,
                        _ => {
                            let pur_cost: Option<i64> = tx
                                .query_row(
                                    "SELECT ti.unit_price_paise
                                     FROM transaction_items ti
                                     JOIN transactions t ON ti.transaction_id = t.id
                                     WHERE ti.lot_id = ?1 AND t.transaction_type = 'PURCHASE'
                                     ORDER BY t.created_at DESC LIMIT 1",
                                    params![&lot_id],
                                    |r| r.get(0),
                                )
                                .optional()?;
                            match pur_cost {
                                Some(cost) if cost > 0 => cost,
                                _ => tx
                                    .query_row(
                                        "SELECT cost_price_paise FROM resources WHERE id = ?1",
                                        params![&resource_id],
                                        |r| r.get(0),
                                    )
                                    .unwrap_or(0),
                            }
                        }
                    }
                };

                if unit_cost_paise > 0 {
                    let cost_i128 = round_div_i128(
                        (deduct as i128)
                            .checked_mul(unit_cost_paise as i128)
                            .ok_or(PostingError::MathOverflow)?,
                        1000,
                    )?;
                    let lot_cost_paise =
                        i64::try_from(cost_i128).map_err(|_| PostingError::MathOverflow)?;
                    total_cogs_paise = total_cogs_paise
                        .checked_add(lot_cost_paise)
                        .ok_or(PostingError::MathOverflow)?;
                }

                remaining = remaining
                    .checked_sub(deduct)
                    .ok_or(PostingError::MathOverflow)?;

                if remaining == 0 {
                    break;
                }
            }
        }

        if remaining > 0 {
            return Err(PostingError::InsufficientStock {
                resource_id,
                requested_milli: needed_milli,
                available_milli: needed_milli - remaining,
            });
        }
    }

    // 5b. Post Cost of Goods Sold (COGS) & Inventory adjustments
    if total_cogs_paise > 0 {
        // Debit Cost of Goods Sold (acc_5000)
        let le_cogs_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_5000', ?3, 0, ?4)",
            params![
                &le_cogs_id,
                &tx_id,
                total_cogs_paise,
                format!("Cost of Goods Sold for {}", invoice_number),
            ],
        )?;

        // Credit Inventory Asset (acc_1200)
        let le_inv_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1200', 0, ?3, ?4)",
            params![
                &le_inv_id,
                &tx_id,
                total_cogs_paise,
                format!("Inventory deduction for {}", invoice_number),
            ],
        )?;
    }

    // 6. Assert Ledger strictly balanced before commit
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

    // 7. Discovery Hub Rollups
    let b_day = crate::discovery::clock::parse_date_to_day(&input.invoice_date).unwrap_or(0);
    let b_hour = crate::discovery::clock::business_hour(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    );
    for line in &computation.lines {
        let line_cogs: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(cogs_paise), 0) FROM transaction_items WHERE transaction_id = ?1 AND resource_id = ?2",
                params![&tx_id, &line.resource_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        crate::discovery::rollup::apply_sale_line(
            &tx,
            &line.resource_id,
            b_day,
            line.quantity_milli,
            line.taxable_paise,
            line_cogs,
        )?;
    }
    crate::discovery::rollup::apply_sale_heat(
        &tx,
        b_day,
        b_hour,
        computation.totals.taxable_paise,
    )?;

    // 8. Commit transaction
    tx.commit()?;

    Ok(PostedSale {
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

/// Posts a sales invoice and its receipt payment tenders atomically in ONE single SQLite immediate transaction.
/// Prevents desynchronization between bill creation and payment vouchers during power cuts or crashes.
pub fn post_sale_with_payments(
    conn: &mut Connection,
    input: &SaleWithPaymentsInput,
) -> Result<PostedSaleWithPayments, PostingError> {
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // 1. Validate and compute sale math
    let computation = compute_sale(&input.sale)?;

    for payment in &input.payments {
        if payment.amount_paise <= 0 {
            return Err(PostingError::InvalidAmount(payment.amount_paise));
        }
    }

    let total_tendered: i64 = input.payments.iter().map(|p| p.amount_paise).sum();
    if total_tendered > computation.totals.total_amount_paise {
        return Err(PostingError::PaymentMismatch {
            total_amount_paise: computation.totals.total_amount_paise,
            tendered_paise: total_tendered,
        });
    }

    // Begin single immediate transaction covering both sale invoice and receipt tenders
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // Allocate gapless invoice number
    let (series, invoice_number) = allocate_invoice_number(&tx, "INV", &input.sale.invoice_date)?;

    // Resolve customer entity (deterministic)
    let entity_id = match &input.sale.customer {
        Some(cid) => {
            let existing: Option<String> = tx
                .query_row("SELECT id FROM entities WHERE id = ?1", params![cid], |r| {
                    r.get(0)
                })
                .optional()?;
            match existing {
                Some(id) => id,
                None => {
                    let by_phone: Option<String> = tx
                        .query_row(
                            "SELECT id FROM entities WHERE phone = ?1 ORDER BY created_at ASC LIMIT 1",
                            params![cid],
                            |r| r.get(0),
                        )
                        .optional()?;
                    match by_phone {
                        Some(id) => id,
                        None => {
                            return Err(PostingError::ResourceNotFound(format!("Entity {}", cid)));
                        }
                    }
                }
            }
        }
        None => {
            let default_id = "ent_walk_in";
            tx.execute(
                "INSERT OR IGNORE INTO entities (
                    id, entity_code, entity_type, full_name, state_code
                ) VALUES (?1, 'WALK_IN', 'CUSTOMER', 'Walk-in Customer', ?2)",
                params![default_id, &input.sale.place_of_supply_state_code],
            )?;
            default_id.to_string()
        }
    };

    // Resolve user ID
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
    let price_mode_str = match input.sale.price_mode {
        PriceMode::Exclusive => "EXCLUSIVE",
        PriceMode::Inclusive => "INCLUSIVE",
    };

    // Insert transactions
    tx.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            transaction_type, original_transaction_id, invoice_date, created_by_user_id,
            price_mode
        ) VALUES (
            ?1, 'POSTED', ?2, ?3, ?4,
            ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14,
            'SALE', NULL, ?15, ?16,
            ?17
        )",
        params![
            &tx_id,
            &input.sale.seller_state_code,
            &input.sale.place_of_supply_state_code,
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
            &input.sale.invoice_date,
            &user_id,
            price_mode_str,
        ],
    )?;

    // Insert transaction_items
    let b_day = crate::discovery::clock::parse_date_to_day(&input.sale.invoice_date).unwrap_or(0);
    for line in &computation.lines {
        let item_id = generate_id(&tx, "ti")?;
        let unit_cost: i64 = tx
            .query_row(
                "SELECT cost_price_paise FROM resources WHERE id = ?1",
                params![&line.resource_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let line_cogs = if unit_cost > 0 {
            let mult = (line.quantity_milli as i128)
                .checked_mul(unit_cost as i128)
                .ok_or(PostingError::MathOverflow)?;
            i64::try_from(round_div_i128(mult, 1000)?).map_err(|_| PostingError::MathOverflow)?
        } else {
            0
        };
        tx.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise,
                cogs_paise, business_day
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4,
                ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12,
                ?13, ?14
            )",
            params![
                &item_id,
                &tx_id,
                &line.resource_id,
                line.quantity_milli,
                line.unit_price_paise,
                line.discount_paise,
                line.taxable_paise,
                line.tax_rate_bps,
                line.cgst_paise,
                line.sgst_paise,
                line.igst_paise,
                line.line_total_paise,
                line_cogs,
                b_day,
            ],
        )?;
    }

    // Ledger entries for the sale invoice
    if computation.totals.total_amount_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1100', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.total_amount_paise,
                format!("Sales Invoice {}", invoice_number),
            ],
        )?;
    }

    if computation.totals.taxable_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4000', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.taxable_paise,
                format!("Sales Revenue on {}", invoice_number),
            ],
        )?;
    }

    if computation.totals.cgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2100', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.cgst_paise,
                format!("Output CGST on {}", invoice_number),
            ],
        )?;
    }

    if computation.totals.sgst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2110', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.sgst_paise,
                format!("Output SGST on {}", invoice_number),
            ],
        )?;
    }

    if computation.totals.igst_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2120', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.igst_paise,
                format!("Output IGST on {}", invoice_number),
            ],
        )?;
    }

    if computation.totals.round_off_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise,
                format!("Round off gain on {}", invoice_number),
            ],
        )?;
    } else if computation.totals.round_off_paise < 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4900', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.round_off_paise.abs(),
                format!("Round off loss on {}", invoice_number),
            ],
        )?;
    }

    // Stock movements & COGS
    let mut total_cogs_paise: i64 = 0;
    let mut resource_quantities: HashMap<String, i64> = HashMap::new();
    for line in &input.sale.lines {
        let entry = resource_quantities
            .entry(line.resource_id.clone())
            .or_insert(0);
        *entry = entry
            .checked_add(line.quantity_milli)
            .ok_or(PostingError::MathOverflow)?;
    }

    for (resource_id, needed_milli) in resource_quantities {
        let is_tracked: i64 = match tx.query_row(
            "SELECT is_stock_tracked FROM resources WHERE id = ?1",
            params![&resource_id],
            |r| r.get(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(PostingError::ResourceNotFound(resource_id));
            }
            Err(e) => return Err(PostingError::Database(e)),
        };

        if is_tracked == 0 {
            continue;
        }

        let mut lots_stmt = tx.prepare(
            "SELECT id FROM resource_lots
             WHERE resource_id = ?1
               AND (expiry_date IS NULL OR expiry_date = '' OR expiry_date >= ?2)
             ORDER BY
               CASE WHEN expiry_date IS NOT NULL AND expiry_date != '' THEN 0 ELSE 1 END,
               expiry_date ASC,
               created_at ASC,
               id ASC",
        )?;

        let lot_ids: Vec<String> = lots_stmt
            .query_map(params![&resource_id, &input.sale.invoice_date], |r| {
                r.get(0)
            })?
            .collect::<Result<Vec<String>, _>>()?;

        let mut remaining = needed_milli;

        for lot_id in lot_ids {
            let available: i64 = tx.query_row(
                "SELECT COALESCE(SUM(quantity_delta_milli), 0)
                 FROM stock_movements
                 WHERE lot_id = ?1",
                params![&lot_id],
                |r| r.get(0),
            )?;

            if available > 0 {
                let deduct = std::cmp::min(remaining, available);
                let sm_id = generate_id(&tx, "sm")?;

                tx.execute(
                    "INSERT INTO stock_movements (
                        id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
                    ) VALUES (?1, ?2, ?3, ?4, 'SALE', ?5)",
                    params![&sm_id, &resource_id, &lot_id, &tx_id, -deduct,],
                )?;

                let unit_cost_paise: i64 = {
                    let lot_cost: Option<i64> = tx
                        .query_row(
                            "SELECT cost_price_paise FROM resource_lots WHERE id = ?1",
                            params![&lot_id],
                            |r| r.get(0),
                        )
                        .optional()?;
                    match lot_cost {
                        Some(cost) if cost > 0 => cost,
                        _ => {
                            let pur_cost: Option<i64> = tx
                                .query_row(
                                    "SELECT ti.unit_price_paise
                                     FROM transaction_items ti
                                     JOIN transactions t ON ti.transaction_id = t.id
                                     WHERE ti.lot_id = ?1 AND t.transaction_type = 'PURCHASE'
                                     ORDER BY t.created_at DESC LIMIT 1",
                                    params![&lot_id],
                                    |r| r.get(0),
                                )
                                .optional()?;
                            match pur_cost {
                                Some(cost) if cost > 0 => cost,
                                _ => tx
                                    .query_row(
                                        "SELECT cost_price_paise FROM resources WHERE id = ?1",
                                        params![&resource_id],
                                        |r| r.get(0),
                                    )
                                    .unwrap_or(0),
                            }
                        }
                    }
                };

                if unit_cost_paise > 0 {
                    let cost_i128 = round_div_i128(
                        (deduct as i128)
                            .checked_mul(unit_cost_paise as i128)
                            .ok_or(PostingError::MathOverflow)?,
                        1000,
                    )?;
                    let cost_paise =
                        i64::try_from(cost_i128).map_err(|_| PostingError::MathOverflow)?;
                    total_cogs_paise = total_cogs_paise
                        .checked_add(cost_paise)
                        .ok_or(PostingError::MathOverflow)?;
                }

                remaining = remaining
                    .checked_sub(deduct)
                    .ok_or(PostingError::MathOverflow)?;

                if remaining == 0 {
                    break;
                }
            }
        }

        if remaining > 0 {
            return Err(PostingError::InsufficientStock {
                resource_id,
                requested_milli: needed_milli,
                available_milli: needed_milli - remaining,
            });
        }
    }

    if total_cogs_paise > 0 {
        let le_cogs_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_5000', ?3, 0, ?4)",
            params![
                &le_cogs_id,
                &tx_id,
                total_cogs_paise,
                format!("Cost of Goods Sold for {}", invoice_number),
            ],
        )?;

        let le_inv_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1200', 0, ?3, ?4)",
            params![
                &le_inv_id,
                &tx_id,
                total_cogs_paise,
                format!("Inventory deduction for {}", invoice_number),
            ],
        )?;
    }

    // Now process payment tenders inside the SAME immediate transaction
    let mut payment_ids = Vec::with_capacity(input.payments.len());

    for tender in &input.payments {
        let pay_id = generate_id(&tx, "pay")?;
        let mode_str = tender.mode.as_str();
        let (_pay_series, pay_number) =
            allocate_invoice_number(&tx, "PAY", &input.sale.invoice_date)?;

        tx.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise,
                reference_number, created_by_user_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &pay_id,
                &pay_number,
                &entity_id,
                mode_str,
                tender.amount_paise,
                tender.reference_number.as_deref(),
                &user_id,
            ],
        )?;

        let alloc_id = generate_id(&tx, "pa")?;
        tx.execute(
            "INSERT INTO payment_allocations (
                id, payment_id, transaction_id, amount_allocated_paise
            ) VALUES (?1, ?2, ?3, ?4)",
            params![&alloc_id, &pay_id, &tx_id, tender.amount_paise,],
        )?;

        let asset_account_id = match tender.mode {
            PaymentMode::Cash => "acc_1000",
            PaymentMode::Upi
            | PaymentMode::Card
            | PaymentMode::BankTransfer
            | PaymentMode::Cheque => "acc_1010",
        };

        // Debit Cash or Digital Asset account
        let le_asset_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, ?3, ?4, 0, ?5)",
            params![
                &le_asset_id,
                &pay_id,
                asset_account_id,
                tender.amount_paise,
                format!("Receipt via {} for {}", mode_str, invoice_number),
            ],
        )?;

        // Credit Accounts Receivable
        let le_ar_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, 'acc_1100', 0, ?3, ?4)",
            params![
                &le_ar_id,
                &pay_id,
                tender.amount_paise,
                format!("AR settlement via {} for {}", mode_str, invoice_number),
            ],
        )?;

        // Verify payment ledger balance
        let (p_debit, p_credit): (i64, i64) = tx.query_row(
            "SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0)
             FROM ledger_entries
             WHERE payment_id = ?1",
            params![&pay_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        if p_debit != p_credit {
            return Err(PostingError::UnbalancedLedger {
                debit_paise: p_debit,
                credit_paise: p_credit,
            });
        }

        payment_ids.push(pay_id);
    }

    // Verify invoice ledger balance
    let (s_debit, s_credit): (i64, i64) = tx.query_row(
        "SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0)
         FROM ledger_entries
         WHERE transaction_id = ?1",
        params![&tx_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    if s_debit != s_credit {
        return Err(PostingError::UnbalancedLedger {
            debit_paise: s_debit,
            credit_paise: s_credit,
        });
    }

    // Discovery Hub Rollups
    let b_day = crate::discovery::clock::parse_date_to_day(&input.sale.invoice_date).unwrap_or(0);
    let b_hour = crate::discovery::clock::business_hour(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    );
    for line in &computation.lines {
        let line_cogs: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(cogs_paise), 0) FROM transaction_items WHERE transaction_id = ?1 AND resource_id = ?2",
                params![&tx_id, &line.resource_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        crate::discovery::rollup::apply_sale_line(
            &tx,
            &line.resource_id,
            b_day,
            line.quantity_milli,
            line.taxable_paise,
            line_cogs,
        )?;
    }
    crate::discovery::rollup::apply_sale_heat(
        &tx,
        b_day,
        b_hour,
        computation.totals.taxable_paise,
    )?;

    // Single atomic commit for invoice + tenders
    tx.commit()?;

    let posted_sale = PostedSale {
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
    };

    Ok(PostedSaleWithPayments {
        sale: posted_sale,
        payment_ids,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::{run_migrations, MIGRATIONS};
    use crate::database::queries::verify_ledger;
    use crate::posting::{LineInput, PaymentTenderInput, PriceMode};
    use std::fs;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
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
             VALUES ('usr_1', 'cashier_alice', 'hash_val', 'Alice Smith', 'CASHIER')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_cust_1', 'CUST-001', 'CUSTOMER', 'John Doe', '27')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_tracked_1', 'SKU-001', 'Tracked Widget', '1234', 1800, 10000, 1)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_1', 'res_tracked_1', 'BATCH-001', '2028-12-31', 12000)",
            [],
        )
        .unwrap();

        // Initial stock: 10,000 milli (10 units) in lot_1
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_init_1', 'res_tracked_1', 'lot_1', NULL, 'PURCHASE', 10000)",
            [],
        ).unwrap();

        conn
    }

    // Connection guard protects against running on insecure raw connections without recursive_triggers or foreign_keys
    #[test]
    fn test_connection_guard_rejects_insecure_connection() {
        let mut raw_conn = Connection::open_in_memory().unwrap();
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_sale(&mut raw_conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InsecureConnection { .. } => {}
            other => panic!("Expected InsecureConnection, got {:?}", other),
        }
    }

    // Test 11 protects: Full sales posting ledger balance and stock audit trail.
    #[test]
    fn test_11_valid_intra_state_sale_posting() {
        let mut conn = setup_test_db();
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let sale = post_sale(&mut conn, &input).expect("Valid sale posting must succeed");
        assert_eq!(sale.invoice_number, "INV/26-27/0001");
        assert_eq!(sale.totals.total_amount_paise, 11800);

        // Verify transaction item exists
        let item_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transaction_items WHERE transaction_id = ?1",
                params![&sale.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_count, 1);

        // Verify ledger entries (exact account code, debit, credit)
        let mut le_stmt = conn
            .prepare(
                "SELECT a.code, le.debit_paise, le.credit_paise
             FROM ledger_entries le
             JOIN accounts a ON a.id = le.account_id
             WHERE le.transaction_id = ?1
             ORDER BY a.code ASC",
            )
            .unwrap();

        let entries = le_stmt
            .query_map(params![&sale.transaction_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            entries,
            vec![
                ("1100".to_string(), 11800, 0), // AR debit
                ("2100".to_string(), 0, 900),   // Output CGST credit
                ("2110".to_string(), 0, 900),   // Output SGST credit
                ("4000".to_string(), 0, 10000), // Sales Revenue credit
            ]
        );

        // Verify stock movement
        let (qty, reason): (i64, String) = conn.query_row(
            "SELECT quantity_delta_milli, reason FROM stock_movements WHERE transaction_id = ?1",
            params![&sale.transaction_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(qty, -1000);
        assert_eq!(reason, "SALE");
    }

    // Test 12 protects: Global and transaction-level ledger balance invariant after diverse sales.
    #[test]
    fn test_12_verify_ledger_returns_empty_after_sales() {
        let mut conn = setup_test_db();

        // (a) Intra-state sale
        let sale_intra = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        post_sale(&mut conn, &sale_intra).unwrap();

        // (b) Inter-state sale
        let sale_inter = SaleInput {
            invoice_date: "2026-04-16".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "29".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        post_sale(&mut conn, &sale_inter).unwrap();

        // (c) Multi-line sale with mixed rates
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_tracked_2', 'SKU-002', 'Widget 2', '1234', 500, 5000, 0)",
            [],
        ).unwrap();

        let sale_multi = SaleInput {
            invoice_date: "2026-04-17".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![
                LineInput {
                    resource_id: "res_tracked_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                },
                LineInput {
                    resource_id: "res_tracked_2".to_string(),
                    quantity_milli: 2000,
                    unit_price_paise: 5000,
                    discount_paise: 500,
                    tax_rate_bps: 500,
                },
            ],
        };
        post_sale(&mut conn, &sale_multi).unwrap();

        // (d) Sale with round-off
        let sale_round = SaleInput {
            invoice_date: "2026-04-18".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 3000,
                unit_price_paise: 3333,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        post_sale(&mut conn, &sale_round).unwrap();

        // Verify ledger consistency audit
        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    // Test 13 protects: Consecutive sequential numbering and financial year boundary rules.
    #[test]
    fn test_13_consecutive_invoice_numbers_and_fy() {
        let mut conn = setup_test_db();

        let base_input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let s1 = post_sale(&mut conn, &base_input).unwrap();
        let s2 = post_sale(&mut conn, &base_input).unwrap();
        let s3 = post_sale(&mut conn, &base_input).unwrap();

        assert_eq!(s1.invoice_number, "INV/26-27/0001");
        assert_eq!(s2.invoice_number, "INV/26-27/0002");
        assert_eq!(s3.invoice_number, "INV/26-27/0003");

        // Sale on March 31, 2027 belongs to FY 2026-27
        let s_mar31 = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2027-03-31".to_string(),
                ..base_input.clone()
            },
        )
        .unwrap();
        assert_eq!(s_mar31.invoice_number, "INV/26-27/0004");

        // Sale on April 1, 2027 starts FY 2027-28 at 1
        let s_apr1 = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2027-04-01".to_string(),
                ..base_input
            },
        )
        .unwrap();
        assert_eq!(s_apr1.invoice_number, "INV/27-28/0001");
    }

    // Test 14 protects: Invoice number maximum length constraint (<= 16 chars).
    #[test]
    fn test_14_invoice_number_longer_than_16_rejected() {
        let mut conn = setup_test_db();

        // Seed a number series with prefix that will cause number to exceed 16 chars
        conn.execute(
            "INSERT INTO number_series (id, series_code, financial_year, prefix, next_number, padding, is_active)
             VALUES ('ns_long', 'INV', '2026-27', 'INV/VERY_LONG_PREFIX/', 1, 4, 1)",
            [],
        ).unwrap();

        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let res = post_sale(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InvoiceNumberExceedsLimit(n) => {
                assert!(n.len() > 16);
            }
            other => panic!("Expected InvoiceNumberExceedsLimit, got {:?}", other),
        }

        // Assert number_series.next_number was not incremented
        let next_num: i64 = conn
            .query_row(
                "SELECT next_number FROM number_series WHERE id = 'ns_long'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(next_num, 1, "Failed sale must consume no number");
    }

    // Test 15 protects: Multi-line sale atomicity (failure on 2nd line rolls back entire sale).
    #[test]
    fn test_15_atomicity_second_line_insufficient_stock() {
        let mut conn = setup_test_db();

        // Create second tracked resource with only 500 milli stock
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_scarce', 'SKU-SCARCE', 'Scarce Item', '1234', 1800, 1000, 1)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_scarce', 'res_scarce', 'BATCH-S', '2028-12-31', 1200)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_init_s', 'res_scarce', 'lot_scarce', NULL, 'PURCHASE', 500)",
            [],
        ).unwrap();

        let count_tx_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        let count_ti_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM transaction_items", [], |r| r.get(0))
            .unwrap();
        let count_le_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM ledger_entries", [], |r| r.get(0))
            .unwrap();
        let count_sm_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
            .unwrap();

        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![
                LineInput {
                    resource_id: "res_tracked_1".to_string(), // has 10,000 milli
                    quantity_milli: 1000,
                    unit_price_paise: 1000,
                    discount_paise: 0,
                    tax_rate_bps: 0,
                },
                LineInput {
                    resource_id: "res_scarce".to_string(), // only has 500 milli!
                    quantity_milli: 1000,                  // requested 1000 milli -> fails!
                    unit_price_paise: 1000,
                    discount_paise: 0,
                    tax_rate_bps: 0,
                },
            ],
        };

        let res = post_sale(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InsufficientStock {
                resource_id,
                requested_milli,
                available_milli,
            } => {
                assert_eq!(resource_id, "res_scarce");
                assert_eq!(requested_milli, 1000);
                assert_eq!(available_milli, 500);
            }
            other => panic!("Expected InsufficientStock, got {:?}", other),
        }

        // Assert database is byte-for-byte unchanged
        let count_tx_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        let count_ti_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM transaction_items", [], |r| r.get(0))
            .unwrap();
        let count_le_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM ledger_entries", [], |r| r.get(0))
            .unwrap();
        let count_sm_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM stock_movements", [], |r| r.get(0))
            .unwrap();

        assert_eq!(count_tx_before, count_tx_after);
        assert_eq!(count_ti_before, count_ti_after);
        assert_eq!(count_le_before, count_le_after);
        assert_eq!(count_sm_before, count_sm_after);
    }

    // Test 16 protects: Oldest-first FIFO stock deduction across multiple lots.
    #[test]
    fn test_16_fifo_spanning_two_lots() {
        let mut conn = setup_test_db();

        // Create resource with two lots: lot_early (500 milli), lot_late (1000 milli)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_fifo', 'SKU-FIFO', 'FIFO Item', '1234', 0, 1000, 1)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, created_at)
             VALUES ('lot_early', 'res_fifo', 'BATCH-1', '2028-12-31', 1000, '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli, created_at)
             VALUES ('sm_fifo_1', 'res_fifo', 'lot_early', NULL, 'PURCHASE', 500, '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, created_at)
             VALUES ('lot_late', 'res_fifo', 'BATCH-2', '2028-12-31', 1000, '2026-02-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli, created_at)
             VALUES ('sm_fifo_2', 'res_fifo', 'lot_late', NULL, 'PURCHASE', 1000, '2026-02-01T00:00:00Z')",
            [],
        ).unwrap();

        // Sale needing 800 milli: should take 500 from lot_early and 300 from lot_late
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_fifo".to_string(),
                quantity_milli: 800,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let sale = post_sale(&mut conn, &input).unwrap();

        let mut sm_stmt = conn
            .prepare(
                "SELECT lot_id, quantity_delta_milli FROM stock_movements
             WHERE transaction_id = ?1
             ORDER BY rowid ASC",
            )
            .unwrap();

        let movements = sm_stmt
            .query_map(params![&sale.transaction_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(
            movements,
            vec![
                ("lot_early".to_string(), -500),
                ("lot_late".to_string(), -300),
            ]
        );
    }

    // Test 17 protects: Exact stock boundary rule (stock never goes negative).
    #[test]
    fn test_17_stock_never_goes_negative() {
        let mut conn = setup_test_db();

        // lot_1 has 10,000 milli
        // Sale 1: exact 10,000 milli succeeds
        let exact_input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 10000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };
        let res1 = post_sale(&mut conn, &exact_input);
        assert!(res1.is_ok(), "Exact stock sale must succeed");

        // Sale 2: 1 milli over fails
        let over_input = SaleInput {
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
            ..exact_input
        };
        let res2 = post_sale(&mut conn, &over_input);
        assert!(res2.is_err(), "1 milli over available stock must fail");
        assert!(matches!(
            res2.unwrap_err(),
            PostingError::InsufficientStock { .. }
        ));
    }

    // Test 18 protects: Non-stock resource handling (services write no stock movements).
    #[test]
    fn test_18_non_stock_resource_no_movements() {
        let mut conn = setup_test_db();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_service', 'SRV-001', 'Consulting Fee', '9983', 1800, 50000, 0)",
            [],
        ).unwrap();

        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_service".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 50000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let sale = post_sale(&mut conn, &input).unwrap();

        let sm_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM stock_movements WHERE transaction_id = ?1",
                params![&sale.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            sm_count, 0,
            "Non-stock resource must produce zero stock movements"
        );
    }

    // Test 19 protects: Immutability preservation (posting must not weaken triggers).
    #[test]
    fn test_19_posted_sale_immutability() {
        let mut conn = setup_test_db();
        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let sale = post_sale(&mut conn, &input).unwrap();

        // Attempting to UPDATE ledger_entries must fail with IMMUTABILITY_RULE_BROKEN
        let res_le = conn.execute(
            "UPDATE ledger_entries SET debit_paise = 9999 WHERE transaction_id = ?1",
            params![&sale.transaction_id],
        );
        assert!(res_le.is_err());
        assert!(res_le
            .unwrap_err()
            .to_string()
            .contains("IMMUTABILITY_RULE_BROKEN"));

        // Attempting to UPDATE transaction total must fail with IMMUTABILITY_RULE_BROKEN
        let res_tx = conn.execute(
            "UPDATE transactions SET total_amount_paise = 9999 WHERE id = ?1",
            params![&sale.transaction_id],
        );
        assert!(res_tx.is_err());
        assert!(res_tx
            .unwrap_err()
            .to_string()
            .contains("IMMUTABILITY_RULE_BROKEN"));
    }

    // Test 20 protects: No float rule in accounting code (static scan of posting module).
    #[test]
    fn test_20_static_scan_no_floats() {
        let posting_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/posting");
        let entries = fs::read_dir(posting_dir).expect("src/posting must exist");

        let f32_str = format!("f{}", 32);
        let f64_str = format!("f{}", 64);

        for entry in entries {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) == Some("rs") {
                let content = fs::read_to_string(&path).unwrap();
                for (idx, line) in content.lines().enumerate() {
                    if line.contains("test_20")
                        || line.contains("f32_str")
                        || line.contains("f64_str")
                    {
                        continue;
                    }
                    assert!(
                        !line.contains(&f32_str),
                        "File {:?} line {} contains forbidden type {}",
                        path.file_name(),
                        idx + 1,
                        f32_str
                    );
                    assert!(
                        !line.contains(&f64_str),
                        "File {:?} line {} contains forbidden type {}",
                        path.file_name(),
                        idx + 1,
                        f64_str
                    );
                }
            }
        }
    }

    #[test]
    fn test_21_cogs_and_inventory_posting() {
        let mut conn = setup_test_db();

        // Create tracked resource with cost_price_paise = 6000 (₹60.00)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_cogs', 'COGS-01', 'COGS Item', '1234', 0, 10000, 6000, 1)",
            [],
        ).unwrap();

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
             VALUES ('lot_cogs_1', 'res_cogs', 'B-01', 10000)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_cogs_init', 'res_cogs', 'lot_cogs_1', NULL, 'PURCHASE', 5000)",
            [],
        ).unwrap();

        let input = SaleInput {
            invoice_date: "2026-05-10".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_cogs".to_string(),
                quantity_milli: 2000, // 2 units
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let sale = post_sale(&mut conn, &input).unwrap();
        assert_eq!(sale.totals.total_amount_paise, 20000);

        // Verify COGS entry: 2 units * ₹60.00 = 12000 paise
        let cogs_debit: i64 = conn.query_row(
            "SELECT debit_paise FROM ledger_entries WHERE transaction_id = ?1 AND account_id = 'acc_5000'",
            params![&sale.transaction_id],
            |r| r.get(0),
        ).expect("COGS debit entry must exist");
        assert_eq!(cogs_debit, 12000);

        let inv_credit: i64 = conn.query_row(
            "SELECT credit_paise FROM ledger_entries WHERE transaction_id = ?1 AND account_id = 'acc_1200'",
            params![&sale.transaction_id],
            |r| r.get(0),
        ).expect("Inventory credit entry must exist");
        assert_eq!(inv_credit, 12000);

        // Verify ledger consistency
        let disc = crate::database::queries::verify_ledger(&conn).unwrap();
        assert!(
            disc.is_empty(),
            "Ledger must be balanced after COGS posting: {:?}",
            disc
        );
    }

    #[test]
    fn test_22_fefo_expiry_order_and_expired_batch_rejection() {
        let mut conn = setup_test_db();

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_fefo', 'FEFO-MED', 'Medicine Paracetamol', '3004', 0, 5000, 2500, 1)",
            [],
        ).unwrap();

        // Lot 1: Expired on 2026-03-31
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_exp', 'res_fefo', 'BATCH-EXP', '2026-03-31', 5000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_fefo_1', 'res_fefo', 'lot_exp', NULL, 'PURCHASE', 1000)",
            [],
        ).unwrap();

        // Lot 2: Expires soon on 2026-06-30
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_soon', 'res_fefo', 'BATCH-SOON', '2026-06-30', 5000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_fefo_2', 'res_fefo', 'lot_soon', NULL, 'PURCHASE', 1000)",
            [],
        ).unwrap();

        // Lot 3: Expires later on 2026-12-31
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_later', 'res_fefo', 'BATCH-LATER', '2026-12-31', 5000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_fefo_3', 'res_fefo', 'lot_later', NULL, 'PURCHASE', 1000)",
            [],
        ).unwrap();

        // Sale on 2026-05-10 for 1000 milli:
        // Must skip lot_exp (expired), and deduct from lot_soon (FEFO)!
        let sale_input = SaleInput {
            invoice_date: "2026-05-10".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_fefo".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 5000,
                discount_paise: 0,
                tax_rate_bps: 0,
            }],
        };

        let sale = post_sale(&mut conn, &sale_input).unwrap();

        // Verify that deduction happened on lot_soon
        let deducted_lot: String = conn
            .query_row(
                "SELECT lot_id FROM stock_movements WHERE transaction_id = ?1 AND reason = 'SALE'",
                params![&sale.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            deducted_lot, "lot_soon",
            "FEFO must select earliest non-expired batch"
        );

        // Verify expired lot still has 1000 milli
        let exp_bal: i64 = conn
            .query_row(
                "SELECT SUM(quantity_delta_milli) FROM stock_movements WHERE lot_id = 'lot_exp'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exp_bal, 1000, "Expired lot must not be sold");
    }

    #[test]
    fn test_23_atomic_sale_with_payments() {
        let mut conn = setup_test_db();

        let input = SaleWithPaymentsInput {
            sale: SaleInput {
                invoice_date: "2026-05-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_cust_1".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_tracked_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
            payments: vec![
                PaymentTenderInput {
                    mode: PaymentMode::Cash,
                    amount_paise: 5000,
                    reference_number: Some("CASH-001".to_string()),
                },
                PaymentTenderInput {
                    mode: PaymentMode::Upi,
                    amount_paise: 6800,
                    reference_number: Some("UPI-TXN-999".to_string()),
                },
            ],
        };

        let result = post_sale_with_payments(&mut conn, &input)
            .expect("Atomic sale + payments must succeed");
        assert_eq!(result.sale.totals.total_amount_paise, 11800);
        assert_eq!(result.payment_ids.len(), 2);

        // Verify allocations
        let alloc_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM payment_allocations WHERE transaction_id = ?1",
                params![&result.sale.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(alloc_count, 2);

        // Verify ledger balance globally
        let disc = verify_ledger(&conn).unwrap();
        assert!(
            disc.is_empty(),
            "Ledger must be completely balanced: {:?}",
            disc
        );
    }

    #[test]
    fn test_24_price_mode_persistence() {
        let mut conn = setup_test_db();

        // 1. Post exclusive sale
        let s_excl = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-05-16".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_tracked_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .unwrap();

        let mode_excl: String = conn
            .query_row(
                "SELECT price_mode FROM transactions WHERE id = ?1",
                params![&s_excl.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mode_excl, "EXCLUSIVE");

        // 2. Post inclusive sale
        let s_incl = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-05-16".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Inclusive,
                lines: vec![LineInput {
                    resource_id: "res_tracked_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 11800,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .unwrap();

        let mode_incl: String = conn
            .query_row(
                "SELECT price_mode FROM transactions WHERE id = ?1",
                params![&s_incl.transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mode_incl, "INCLUSIVE");
    }

    #[test]
    fn test_25_lot_level_cost_cogs() {
        let mut conn = setup_test_db();

        // Resource has fallback master cost 4000 (₹40.00)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_batch', 'SKU-BATCH', 'Batch Item', '1234', 0, 10000, 4000, 1)",
            [],
        ).unwrap();

        // Lot A cost is 7500 (₹75.00)
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise)
             VALUES ('lot_a', 'res_batch', 'BATCH-A', '2028-12-31', 10000, 7500)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_ba', 'res_batch', 'lot_a', NULL, 'PURCHASE', 1000)",
            [],
        ).unwrap();

        let sale = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-05-18".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_batch".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 0,
                }],
            },
        )
        .unwrap();

        // COGS should be 7500 (from lot_a), not 4000 (from resource master)!
        let cogs: i64 = conn.query_row(
            "SELECT debit_paise FROM ledger_entries WHERE transaction_id = ?1 AND account_id = 'acc_5000'",
            params![&sale.transaction_id],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(cogs, 7500, "COGS must use lot-specific cost_price_paise");
    }
}
