use super::series::allocate_invoice_number;
use super::tax::{compute_sale, round_div_i128};
use super::{LineInput, PostedSaleTotals, PostingError, PriceMode, SaleInput};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReturnLineInput {
    pub resource_id: String,
    pub lot_id: Option<String>,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub discount_paise: i64,
    pub tax_rate_bps: i64,
}

impl From<LineInput> for ReturnLineInput {
    fn from(l: LineInput) -> Self {
        Self {
            resource_id: l.resource_id,
            lot_id: None,
            quantity_milli: l.quantity_milli,
            unit_price_paise: l.unit_price_paise,
            discount_paise: l.discount_paise,
            tax_rate_bps: l.tax_rate_bps,
        }
    }
}

impl From<ReturnLineInput> for LineInput {
    fn from(r: ReturnLineInput) -> Self {
        Self {
            resource_id: r.resource_id,
            quantity_milli: r.quantity_milli,
            unit_price_paise: r.unit_price_paise,
            discount_paise: r.discount_paise,
            tax_rate_bps: r.tax_rate_bps,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaleReturnInput {
    pub return_date: String,
    pub original_transaction_id: String,
    pub reason: Option<String>,
    pub lines: Vec<LineInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PurchaseReturnInput {
    pub return_date: String,
    pub original_transaction_id: String,
    pub reason: Option<String>,
    pub lines: Vec<LineInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedReturn {
    pub transaction_id: String,
    pub invoice_number: String,
    pub totals: PostedSaleTotals,
}

fn generate_id(tx: &Transaction<'_>, prefix: &str) -> Result<String, PostingError> {
    let hex_val: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    Ok(format!("{}_{}", prefix, hex_val))
}

/// Derives the original transaction's `PriceMode` by examining the mathematical relationship
/// between line totals, gross amounts, and tax breakdowns in `transaction_items`.
pub(crate) fn detect_original_price_mode(
    tx: &Transaction<'_>,
    original_tx_id: &str,
) -> Result<PriceMode, PostingError> {
    let mut stmt = tx.prepare(
        "SELECT quantity_milli, unit_price_paise, discount_paise, taxable_paise, tax_rate_bps, line_total_paise
         FROM transaction_items
         WHERE transaction_id = ?1",
    )?;
    let rows = stmt.query_map(params![original_tx_id], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
        ))
    })?;

    for row in rows {
        let (qty, unit_price, discount, taxable, rate_bps, line_total) = row?;
        if rate_bps > 0 {
            // gross = (qty * unit_price) / 1000
            let gross = (qty as i128)
                .checked_mul(unit_price as i128)
                .ok_or(PostingError::MathOverflow)?
                / 1000;
            let line_base = (gross as i64)
                .checked_sub(discount)
                .ok_or(PostingError::MathOverflow)?;

            if line_total == line_base && taxable < line_base {
                return Ok(PriceMode::Inclusive);
            } else if taxable == line_base && line_total > line_base {
                return Ok(PriceMode::Exclusive);
            }
        }
    }
    // If all lines had 0% tax, Exclusive and Inclusive produce identical calculations.
    Ok(PriceMode::Exclusive)
}

pub fn post_sale_return(
    conn: &mut Connection,
    input: &SaleReturnInput,
) -> Result<PostedReturn, PostingError> {
    // 1. Connection guard: verify PRAGMA recursive_triggers = ON and foreign_keys = ON
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // Begin immediate transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 2. Verify original transaction exists, is POSTED, and has transaction_type = 'SALE'
    let (orig_status, orig_type, seller_state_code, place_of_supply_state_code, entity_id): (
        String,
        String,
        String,
        String,
        String,
    ) = match tx.query_row(
        "SELECT status, transaction_type, seller_state_code, place_of_supply_state_code, entity_id
         FROM transactions WHERE id = ?1",
        params![&input.original_transaction_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PostingError::TransactionNotFound(
                input.original_transaction_id.clone(),
            ));
        }
        Err(e) => return Err(PostingError::Database(e)),
    };

    if orig_status != "POSTED" {
        return Err(PostingError::InvalidOriginalTransaction(format!(
            "Original transaction '{}' status is '{}', expected 'POSTED'",
            input.original_transaction_id, orig_status
        )));
    }

    if orig_type != "SALE" {
        return Err(PostingError::InvalidOriginalTransaction(format!(
            "Original transaction '{}' type is '{}', expected 'SALE'",
            input.original_transaction_id, orig_type
        )));
    }

    // 3. Line & tax computation
    let orig_price_mode = detect_original_price_mode(&tx, &input.original_transaction_id)?;
    let sale_input = SaleInput {
        invoice_date: input.return_date.clone(),
        seller_state_code: seller_state_code.clone(),
        place_of_supply_state_code: place_of_supply_state_code.clone(),
        customer: Some(entity_id.clone()),
        price_mode: orig_price_mode,
        lines: input.lines.clone(),
    };
    let computation = compute_sale(&sale_input)?;

    // 3b. Validate items & enforce return quantity ceiling
    let mut requested_per_resource: HashMap<String, i64> = HashMap::new();
    for line in &input.lines {
        if line.quantity_milli <= 0 {
            return Err(PostingError::InvalidQuantity(line.quantity_milli));
        }
        let entry = requested_per_resource.entry(line.resource_id.clone()).or_insert(0);
        *entry = entry.checked_add(line.quantity_milli).ok_or(PostingError::MathOverflow)?;
    }

    for (resource_id, requested_milli) in &requested_per_resource {
        // Query original quantity sold for this resource
        let sold_quantity: i64 = tx.query_row(
            "SELECT COALESCE(SUM(quantity_milli), 0)
             FROM transaction_items
             WHERE transaction_id = ?1 AND resource_id = ?2",
            params![&input.original_transaction_id, resource_id],
            |r| r.get(0),
        )?;

        if sold_quantity == 0 {
            return Err(PostingError::InvalidOriginalTransaction(format!(
                "Resource '{}' was not part of original transaction '{}'",
                resource_id, input.original_transaction_id
            )));
        }

        // Query previously returned quantity for this resource across all POSTED SALE_RETURNs
        let prior_returned_quantity: i64 = tx.query_row(
            "SELECT COALESCE(SUM(ti.quantity_milli), 0)
             FROM transaction_items ti
             JOIN transactions t ON t.id = ti.transaction_id
             WHERE t.original_transaction_id = ?1
               AND t.status = 'POSTED'
               AND t.transaction_type = 'SALE_RETURN'
               AND ti.resource_id = ?2",
            params![&input.original_transaction_id, resource_id],
            |r| r.get(0),
        )?;

        let available_milli = sold_quantity
            .checked_sub(prior_returned_quantity)
            .ok_or(PostingError::MathOverflow)?;

        if *requested_milli > available_milli {
            return Err(PostingError::ReturnQuantityExceedsOriginal {
                resource_id: resource_id.clone(),
                requested_milli: *requested_milli,
                available_milli,
            });
        }
    }

    // 4. Allocate gapless credit note invoice number ("CN")
    let (series, invoice_number) = allocate_invoice_number(&tx, "CN", &input.return_date)?;

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

    // 5. Insert transactions row
    tx.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            notes, created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            ?1, 'POSTED', ?2, ?3, ?4,
            ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14,
            ?15, ?16, 'SALE_RETURN', ?17, ?18
        )",
        params![
            &tx_id,
            &seller_state_code,
            &place_of_supply_state_code,
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
            input.reason.as_deref(),
            &user_id,
            &input.original_transaction_id,
            &input.return_date,
        ],
    )?;

    // Insert transaction_items
    for line in &computation.lines {
        let item_id = generate_id(&tx, "ti")?;
        tx.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4,
                ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12
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
            ],
        )?;
    }

    // 6. Balanced ledger entries:
    // Debit Sales Returns (acc_4010) for taxable_paise
    if computation.totals.taxable_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_4010', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.taxable_paise,
                format!("Sales Return for {}", invoice_number),
            ],
        )?;
    }

    // Debit Output CGST (acc_2100) for cgst_paise
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
                format!("Output CGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Debit Output SGST (acc_2110) for sgst_paise
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
                format!("Output SGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Debit Output IGST (acc_2120) for igst_paise
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
                format!("Output IGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Round-off handling (acc_4900)
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
                format!("Round off loss on {}", invoice_number),
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
                format!("Round off gain on {}", invoice_number),
            ],
        )?;
    }

    // Credit Accounts Receivable (acc_1100) for total_amount_paise
    if computation.totals.total_amount_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1100', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.total_amount_paise,
                format!("Credit Note {}", invoice_number),
            ],
        )?;
    }

    // 7. Stock restoration for stock-tracked resources
    let mut total_restored_cost_paise: i64 = 0;

    for (resource_id, needed_milli) in requested_per_resource {
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

        // Find lots affected in the original sale and their deducted quantities
        let mut orig_lots_stmt = tx.prepare(
            "SELECT lot_id, ABS(quantity_delta_milli)
             FROM stock_movements
             WHERE transaction_id = ?1
               AND resource_id = ?2
               AND lot_id IS NOT NULL
               AND quantity_delta_milli < 0
             ORDER BY created_at DESC, id DESC",
        )?;

        let orig_lots: Vec<(String, i64)> = orig_lots_stmt
            .query_map(params![&input.original_transaction_id, &resource_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut remaining = needed_milli;

        for (lot_id, orig_deducted) in orig_lots {
            if remaining == 0 {
                break;
            }

            // Query how much has already been restored to this specific lot from prior returns
            let prior_restored_to_lot: i64 = tx.query_row(
                "SELECT COALESCE(SUM(sm.quantity_delta_milli), 0)
                 FROM stock_movements sm
                 JOIN transactions t ON t.id = sm.transaction_id
                 WHERE t.original_transaction_id = ?1
                   AND t.status = 'POSTED'
                   AND t.transaction_type = 'SALE_RETURN'
                   AND sm.lot_id = ?2
                   AND sm.reason = 'SALE_RETURN'",
                params![&input.original_transaction_id, &lot_id],
                |r| r.get(0),
            )?;

            let lot_restorable = orig_deducted
                .checked_sub(prior_restored_to_lot)
                .ok_or(PostingError::MathOverflow)?;

            if lot_restorable <= 0 {
                continue;
            }

            let restore = std::cmp::min(remaining, lot_restorable);
            let sm_id = generate_id(&tx, "sm")?;

            tx.execute(
                "INSERT INTO stock_movements (
                    id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli
                ) VALUES (?1, ?2, ?3, ?4, 'SALE_RETURN', ?5)",
                params![&sm_id, &resource_id, &lot_id, &tx_id, restore],
            )?;

            // Reconcile restored lot cost for COGS reversal
            let unit_cost_paise: i64 = {
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
            };

            if unit_cost_paise > 0 {
                let cost_i128 = round_div_i128(
                    (restore as i128)
                        .checked_mul(unit_cost_paise as i128)
                        .ok_or(PostingError::MathOverflow)?,
                    1000,
                )?;
                let lot_cost_paise =
                    i64::try_from(cost_i128).map_err(|_| PostingError::MathOverflow)?;
                total_restored_cost_paise = total_restored_cost_paise
                    .checked_add(lot_cost_paise)
                    .ok_or(PostingError::MathOverflow)?;
            }

            remaining = remaining
                .checked_sub(restore)
                .ok_or(PostingError::MathOverflow)?;
        }

        // If any quantity cannot be restored to original lots, reject! Never fallback to arbitrary lots.
        if remaining > 0 {
            return Err(PostingError::InvalidOriginalTransaction(format!(
                "Cannot restore {} milli for resource '{}': insufficient lot allocations in original transaction",
                remaining, resource_id
            )));
        }
    }

    // 8. Reversal of Cost of Goods Sold (COGS) & Inventory Asset restoration
    if total_restored_cost_paise > 0 {
        // Debit Inventory Asset (acc_1200)
        let le_inv_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1200', ?3, 0, ?4)",
            params![
                &le_inv_id,
                &tx_id,
                total_restored_cost_paise,
                format!("Inventory restored for return {}", invoice_number),
            ],
        )?;

        // Credit Cost of Goods Sold (acc_5000)
        let le_cogs_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_5000', 0, ?3, ?4)",
            params![
                &le_cogs_id,
                &tx_id,
                total_restored_cost_paise,
                format!("COGS reversal for return {}", invoice_number),
            ],
        )?;
    }

    tx.commit()?;

    Ok(PostedReturn {
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

pub fn post_purchase_return(
    conn: &mut Connection,
    input: &PurchaseReturnInput,
) -> Result<PostedReturn, PostingError> {
    // 1. Connection guard: verify PRAGMA recursive_triggers = ON and foreign_keys = ON
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // Begin immediate transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 2. Verify original transaction exists, is POSTED, and has transaction_type = 'PURCHASE'
    let (orig_status, orig_type, seller_state_code, place_of_supply_state_code, entity_id): (
        String,
        String,
        String,
        String,
        String,
    ) = match tx.query_row(
        "SELECT status, transaction_type, seller_state_code, place_of_supply_state_code, entity_id
         FROM transactions WHERE id = ?1",
        params![&input.original_transaction_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PostingError::TransactionNotFound(
                input.original_transaction_id.clone(),
            ));
        }
        Err(e) => return Err(PostingError::Database(e)),
    };

    if orig_status != "POSTED" {
        return Err(PostingError::InvalidOriginalTransaction(format!(
            "Original transaction '{}' status is '{}', expected 'POSTED'",
            input.original_transaction_id, orig_status
        )));
    }

    if orig_type != "PURCHASE" {
        return Err(PostingError::InvalidOriginalTransaction(format!(
            "Original transaction '{}' type is '{}', expected 'PURCHASE'",
            input.original_transaction_id, orig_type
        )));
    }

    // 3. Line & tax computation
    let orig_price_mode = detect_original_price_mode(&tx, &input.original_transaction_id)?;
    let sale_input = SaleInput {
        invoice_date: input.return_date.clone(),
        seller_state_code: seller_state_code.clone(),
        place_of_supply_state_code: place_of_supply_state_code.clone(),
        customer: Some(entity_id.clone()),
        price_mode: orig_price_mode,
        lines: input.lines.clone(),
    };
    let computation = compute_sale(&sale_input)?;

    // 3b. Validate items & enforce return quantity ceiling
    let mut requested_per_resource: HashMap<String, i64> = HashMap::new();
    for line in &input.lines {
        if line.quantity_milli <= 0 {
            return Err(PostingError::InvalidQuantity(line.quantity_milli));
        }
        let entry = requested_per_resource.entry(line.resource_id.clone()).or_insert(0);
        *entry = entry.checked_add(line.quantity_milli).ok_or(PostingError::MathOverflow)?;
    }

    for (resource_id, requested_milli) in &requested_per_resource {
        // Query original quantity purchased for this resource
        let purchased_quantity: i64 = tx.query_row(
            "SELECT COALESCE(SUM(quantity_milli), 0)
             FROM transaction_items
             WHERE transaction_id = ?1 AND resource_id = ?2",
            params![&input.original_transaction_id, resource_id],
            |r| r.get(0),
        )?;

        if purchased_quantity == 0 {
            return Err(PostingError::InvalidOriginalTransaction(format!(
                "Resource '{}' was not part of original transaction '{}'",
                resource_id, input.original_transaction_id
            )));
        }

        // Query previously returned quantity for this resource across all POSTED PURCHASE_RETURNs
        let prior_returned_quantity: i64 = tx.query_row(
            "SELECT COALESCE(SUM(ti.quantity_milli), 0)
             FROM transaction_items ti
             JOIN transactions t ON t.id = ti.transaction_id
             WHERE t.original_transaction_id = ?1
               AND t.status = 'POSTED'
               AND t.transaction_type = 'PURCHASE_RETURN'
               AND ti.resource_id = ?2",
            params![&input.original_transaction_id, resource_id],
            |r| r.get(0),
        )?;

        let available_milli = purchased_quantity
            .checked_sub(prior_returned_quantity)
            .ok_or(PostingError::MathOverflow)?;

        if *requested_milli > available_milli {
            return Err(PostingError::ReturnQuantityExceedsOriginal {
                resource_id: resource_id.clone(),
                requested_milli: *requested_milli,
                available_milli,
            });
        }
    }

    // 4. Allocate gapless debit note invoice number ("DN")
    let (series, invoice_number) = allocate_invoice_number(&tx, "DN", &input.return_date)?;

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

    // 5. Insert transactions row
    tx.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            notes, created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            ?1, 'POSTED', ?2, ?3, ?4,
            ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14,
            ?15, ?16, 'PURCHASE_RETURN', ?17, ?18
        )",
        params![
            &tx_id,
            &seller_state_code,
            &place_of_supply_state_code,
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
            input.reason.as_deref(),
            &user_id,
            &input.original_transaction_id,
            &input.return_date,
        ],
    )?;

    // Insert transaction_items
    for line in &computation.lines {
        let item_id = generate_id(&tx, "ti")?;
        tx.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4,
                ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12
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
            ],
        )?;
    }

    // 6. Balanced ledger entries:
    // Debit Accounts Payable (acc_2000) for total_amount_paise
    if computation.totals.total_amount_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_2000', ?3, 0, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.total_amount_paise,
                format!("Debit Note {}", invoice_number),
            ],
        )?;
    }

    // Credit Inventory (acc_1200) for taxable_paise
    if computation.totals.taxable_paise > 0 {
        let le_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, ?2, NULL, 'acc_1200', 0, ?3, ?4)",
            params![
                &le_id,
                &tx_id,
                computation.totals.taxable_paise,
                format!("Inventory return for {}", invoice_number),
            ],
        )?;
    }

    // Credit Input CGST (acc_2100) for cgst_paise
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
                format!("Input CGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Credit Input SGST (acc_2110) for sgst_paise
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
                format!("Input SGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Credit Input IGST (acc_2120) for igst_paise
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
                format!("Input IGST reversal on {}", invoice_number),
            ],
        )?;
    }

    // Round-off handling (acc_4900)
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

    // 7. Stock deduction for stock-tracked resources (FIFO across lots)
    for (resource_id, needed_milli) in requested_per_resource {
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

        // Fetch lots in FIFO order
        let mut lots_stmt = tx.prepare(
            "SELECT id FROM resource_lots
             WHERE resource_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;

        let lot_ids: Vec<String> = lots_stmt
            .query_map(params![&resource_id], |r| r.get(0))?
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
                    ) VALUES (?1, ?2, ?3, ?4, 'PURCHASE_RETURN', ?5)",
                    params![&sm_id, &resource_id, &lot_id, &tx_id, -deduct],
                )?;

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

    tx.commit()?;

    Ok(PostedReturn {
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
    use crate::posting::post_sale;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::database::apply_pragmas(&conn).unwrap();
        run_migrations(&mut conn, MIGRATIONS).unwrap();

        // Seed fixtures
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
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_supp_1', 'SUPP-001', 'SUPPLIER', 'Acme Supplies', '27')",
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

        // Initial stock: 10,000 milli in lot_1
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_init_1', 'res_tracked_1', 'lot_1', NULL, 'PURCHASE', 10000)",
            [],
        ).unwrap();

        conn
    }

    #[test]
    fn test_connection_guard() {
        let mut raw_conn = Connection::open_in_memory().unwrap();
        let input = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: "tx_dummy".to_string(),
            reason: Some("Damaged goods".to_string()),
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_sale_return(&mut raw_conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InsecureConnection { .. } => {}
            other => panic!("Expected InsecureConnection, got {:?}", other),
        }
    }

    #[test]
    fn test_valid_sale_return_restores_stock_and_balances_ledger() {
        let mut conn = setup_test_db();

        // 1. Post original sale: 2000 milli
        let sale_input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("ent_cust_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 2000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        let sale = post_sale(&mut conn, &sale_input).unwrap();

        // Verify stock after sale: 10000 - 2000 = 8000 milli
        let stock_after_sale: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity_delta_milli), 0) FROM stock_movements WHERE resource_id = 'res_tracked_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stock_after_sale, 8000);

        // 2. Post sale return for 1000 milli
        let return_input = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: sale.transaction_id.clone(),
            reason: Some("Customer returned 1 item".to_string()),
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let posted_return = post_sale_return(&mut conn, &return_input).unwrap();
        assert!(posted_return.invoice_number.starts_with("CN/"));
        assert_eq!(posted_return.totals.taxable_paise, 10000);
        assert_eq!(posted_return.totals.cgst_paise, 900);
        assert_eq!(posted_return.totals.sgst_paise, 900);
        assert_eq!(posted_return.totals.igst_paise, 0);
        assert_eq!(posted_return.totals.total_amount_paise, 11800);

        // Verify transaction fields in DB
        let (status, tx_type, orig_id, notes): (String, String, Option<String>, Option<String>) = conn.query_row(
            "SELECT status, transaction_type, original_transaction_id, notes FROM transactions WHERE id = ?1",
            params![&posted_return.transaction_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).unwrap();
        assert_eq!(status, "POSTED");
        assert_eq!(tx_type, "SALE_RETURN");
        assert_eq!(orig_id, Some(sale.transaction_id.clone()));
        assert_eq!(notes, Some("Customer returned 1 item".to_string()));

        // Verify stock movement: +1000 milli with reason SALE_RETURN
        let (qty, reason): (i64, String) = conn.query_row(
            "SELECT quantity_delta_milli, reason FROM stock_movements WHERE transaction_id = ?1",
            params![&posted_return.transaction_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(qty, 1000);
        assert_eq!(reason, "SALE_RETURN");

        // Total stock now 8000 + 1000 = 9000 milli
        let stock_after_return: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity_delta_milli), 0) FROM stock_movements WHERE resource_id = 'res_tracked_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stock_after_return, 9000);

        // Verify ledger entries
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
            .query_map(params![&posted_return.transaction_id], |r| {
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
                ("1100".to_string(), 0, 11800), // AR credit
                ("2100".to_string(), 900, 0),   // Output CGST debit (reversal)
                ("2110".to_string(), 900, 0),   // Output SGST debit (reversal)
                ("4010".to_string(), 10000, 0), // Sales Returns debit
            ]
        );

        // Audit general ledger consistency
        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_valid_purchase_return_deducts_stock_and_balances_ledger() {
        let mut conn = setup_test_db();

        // 1. Manually seed a valid POSTED PURCHASE transaction
        let tx_purch_id = "tx_purch_test_1";
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                ?1, 'POSTED', '27', '27', 'PUR',
                'PUR/26-27/0001', 'ent_supp_1', 20000, 0, 20000,
                1800, 1800, 0, 0, 23600,
                'PURCHASE', NULL, '2026-04-10', 'usr_1'
            )",
            params![tx_purch_id],
        )
        .unwrap();

        // Seed corresponding transaction items
        conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                'ti_purch_1', ?1, 'res_tracked_1', 'lot_1', 2000,
                10000, 0, 20000, 1800,
                1800, 1800, 0, 23600
            )",
            params![tx_purch_id],
        )
        .unwrap();

        // Seed balanced ledger entries for the purchase
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('le_p1', ?1, 'acc_1200', 20000, 0, 'Inventory purchase')",
            params![tx_purch_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('le_p2', ?1, 'acc_2100', 1800, 0, 'Input CGST')",
            params![tx_purch_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('le_p3', ?1, 'acc_2110', 1800, 0, 'Input SGST')",
            params![tx_purch_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('le_p4', ?1, 'acc_2000', 0, 23600, 'Accounts payable')",
            params![tx_purch_id],
        ).unwrap();

        // Add 2000 milli stock from this purchase
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_p1', 'res_tracked_1', 'lot_1', ?1, 'PURCHASE', 2000)",
            params![tx_purch_id],
        ).unwrap();

        // Current stock = 10000 + 2000 = 12000 milli
        let stock_before_return: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity_delta_milli), 0) FROM stock_movements WHERE resource_id = 'res_tracked_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stock_before_return, 12000);

        // 2. Post purchase return for 1000 milli
        let return_input = PurchaseReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: tx_purch_id.to_string(),
            reason: Some("Defective goods returned to vendor".to_string()),
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let posted_return = post_purchase_return(&mut conn, &return_input).unwrap();
        assert!(posted_return.invoice_number.starts_with("DN/"));
        assert_eq!(posted_return.totals.taxable_paise, 10000);
        assert_eq!(posted_return.totals.cgst_paise, 900);
        assert_eq!(posted_return.totals.sgst_paise, 900);
        assert_eq!(posted_return.totals.total_amount_paise, 11800);

        // Verify stock movement: -1000 milli with reason PURCHASE_RETURN
        let (qty, reason): (i64, String) = conn.query_row(
            "SELECT quantity_delta_milli, reason FROM stock_movements WHERE transaction_id = ?1",
            params![&posted_return.transaction_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(qty, -1000);
        assert_eq!(reason, "PURCHASE_RETURN");

        // Stock after return: 12000 - 1000 = 11000 milli
        let stock_after_return: i64 = conn.query_row(
            "SELECT COALESCE(SUM(quantity_delta_milli), 0) FROM stock_movements WHERE resource_id = 'res_tracked_1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(stock_after_return, 11000);

        // Verify ledger entries
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
            .query_map(params![&posted_return.transaction_id], |r| {
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
                ("1200".to_string(), 0, 10000), // Inventory credit
                ("2000".to_string(), 11800, 0), // AP debit
                ("2100".to_string(), 0, 900),   // Input CGST credit (reversal)
                ("2110".to_string(), 0, 900),   // Input SGST credit (reversal)
            ]
        );

        // Audit general ledger consistency
        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies found: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_sale_return_on_purchase_transaction_fails() {
        let mut conn = setup_test_db();

        // Seed a PURCHASE transaction
        let tx_purch_id = "tx_purch_test_2";
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                ?1, 'POSTED', '27', '27', 'PUR',
                'PUR/26-27/0002', 'ent_supp_1', 10000, 0, 10000,
                900, 900, 0, 0, 11800,
                'PURCHASE', NULL, '2026-04-10', 'usr_1'
            )",
            params![tx_purch_id],
        )
        .unwrap();

        // Attempting sale return on purchase transaction must fail
        let input = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: tx_purch_id.to_string(),
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_sale_return(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InvalidOriginalTransaction(msg) => {
                assert!(msg.contains("PURCHASE"));
                assert!(msg.contains("SALE"));
            }
            other => panic!("Expected InvalidOriginalTransaction, got {:?}", other),
        }
    }

    #[test]
    fn test_purchase_return_on_sale_transaction_fails() {
        let mut conn = setup_test_db();

        let sale_input = SaleInput {
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
        let sale = post_sale(&mut conn, &sale_input).unwrap();

        // Attempting purchase return on sale transaction must fail
        let input = PurchaseReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: sale.transaction_id,
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_purchase_return(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InvalidOriginalTransaction(msg) => {
                assert!(msg.contains("SALE"));
                assert!(msg.contains("PURCHASE"));
            }
            other => panic!("Expected InvalidOriginalTransaction, got {:?}", other),
        }
    }

    #[test]
    fn test_return_with_missing_original_transaction_fails() {
        let mut conn = setup_test_db();

        // 1. Sale return with missing original ID
        let sale_ret = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: "tx_non_existent".to_string(),
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res1 = post_sale_return(&mut conn, &sale_ret);
        assert!(res1.is_err());
        match res1.unwrap_err() {
            PostingError::TransactionNotFound(id) => assert_eq!(id, "tx_non_existent"),
            other => panic!("Expected TransactionNotFound, got {:?}", other),
        }

        // 2. Purchase return with missing original ID
        let purch_ret = PurchaseReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: "tx_non_existent".to_string(),
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res2 = post_purchase_return(&mut conn, &purch_ret);
        assert!(res2.is_err());
        match res2.unwrap_err() {
            PostingError::TransactionNotFound(id) => assert_eq!(id, "tx_non_existent"),
            other => panic!("Expected TransactionNotFound, got {:?}", other),
        }
    }

    #[test]
    fn test_return_on_cancelled_transaction_fails() {
        let mut conn = setup_test_db();

        let sale_input = SaleInput {
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
        let sale = post_sale(&mut conn, &sale_input).unwrap();

        // Cancel the sale
        conn.execute(
            "UPDATE transactions SET status = 'CANCELLED' WHERE id = ?1",
            params![&sale.transaction_id],
        )
        .unwrap();

        let input = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: sale.transaction_id,
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_sale_return(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InvalidOriginalTransaction(msg) => {
                assert!(msg.contains("CANCELLED"));
            }
            other => panic!("Expected InvalidOriginalTransaction, got {:?}", other),
        }
    }

    #[test]
    fn test_inter_state_returns_balance_and_use_igst() {
        let mut conn = setup_test_db();

        // 1. Inter-state sale: seller 27, place of supply 29 (Karnataka)
        let sale_input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
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
        let sale = post_sale(&mut conn, &sale_input).unwrap();

        // Inter-state sale return
        let ret_input = SaleReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: sale.transaction_id,
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        let sale_ret = post_sale_return(&mut conn, &ret_input).unwrap();
        assert_eq!(sale_ret.totals.cgst_paise, 0);
        assert_eq!(sale_ret.totals.sgst_paise, 0);
        assert_eq!(sale_ret.totals.igst_paise, 1800);
        assert_eq!(sale_ret.totals.total_amount_paise, 11800);

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
            .query_map(params![&sale_ret.transaction_id], |r| {
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
                ("1100".to_string(), 0, 11800), // AR credit
                ("2120".to_string(), 1800, 0),  // Output IGST debit
                ("4010".to_string(), 10000, 0), // Sales Returns debit
            ]
        );

        let discrepancies = verify_ledger(&conn).unwrap();
        assert!(discrepancies.is_empty());
    }

    #[test]
    fn test_purchase_return_insufficient_stock_fails() {
        let mut conn = setup_test_db();

        let tx_purch_id = "tx_purch_test_3";
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                ?1, 'POSTED', '27', '27', 'PUR',
                'PUR/26-27/0003', 'ent_supp_1', 10000, 0, 10000,
                900, 900, 0, 0, 11800,
                'PURCHASE', NULL, '2026-04-10', 'usr_1'
            )",
            params![tx_purch_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli,
                unit_price_paise, discount_paise, taxable_paise, tax_rate_bps,
                cgst_paise, sgst_paise, igst_paise, line_total_paise
            ) VALUES (
                'ti_purch_3', ?1, 'res_tracked_1', 'lot_1', 1000,
                10000, 0, 10000, 1800,
                900, 900, 0, 11800
            )",
            params![tx_purch_id],
        )
        .unwrap();

        // Deduct almost all stock (so available is only 100 milli)
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_drain', 'res_tracked_1', 'lot_1', NULL, 'DAMAGE', -9900)",
            [],
        ).unwrap();

        let input = PurchaseReturnInput {
            return_date: "2026-04-16".to_string(),
            original_transaction_id: tx_purch_id.to_string(),
            reason: None,
            lines: vec![LineInput {
                resource_id: "res_tracked_1".to_string(),
                quantity_milli: 1000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };

        let res = post_purchase_return(&mut conn, &input);
        assert!(res.is_err());
        match res.unwrap_err() {
            PostingError::InsufficientStock {
                resource_id,
                requested_milli,
                available_milli,
            } => {
                assert_eq!(resource_id, "res_tracked_1");
                assert_eq!(requested_milli, 1000);
                assert_eq!(available_milli, 100);
            }
            other => panic!("Expected InsufficientStock, got {:?}", other),
        }
    }
}
