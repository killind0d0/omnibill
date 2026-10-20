use super::PostingError;
use super::series::allocate_invoice_number;
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PaymentMode {
    #[serde(alias = "Cash", alias = "cash")]
    Cash,
    #[serde(alias = "Upi", alias = "upi")]
    Upi,
    #[serde(alias = "Card", alias = "card")]
    Card,
    #[serde(
        alias = "BankTransfer",
        alias = "bank_transfer",
        alias = "BANK_TRANSFER"
    )]
    BankTransfer,
    #[serde(alias = "Cheque", alias = "cheque")]
    Cheque,
}

impl PaymentMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            PaymentMode::Cash => "CASH",
            PaymentMode::Upi => "UPI",
            PaymentMode::Card => "CARD",
            PaymentMode::BankTransfer => "BANK_TRANSFER",
            PaymentMode::Cheque => "CHEQUE",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "CASH" => Some(PaymentMode::Cash),
            "UPI" => Some(PaymentMode::Upi),
            "CARD" => Some(PaymentMode::Card),
            "BANK_TRANSFER" => Some(PaymentMode::BankTransfer),
            "CHEQUE" => Some(PaymentMode::Cheque),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentAllocationInput {
    pub transaction_id: String,
    pub amount_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentInput {
    pub entity_id: String,
    pub payment_mode: PaymentMode,
    pub amount_paise: i64,
    pub reference_number: Option<String>,
    pub payment_date: String,
    pub allocations: Vec<PaymentAllocationInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedPayment {
    pub payment_id: String,
    pub payment_number: String,
    pub entity_id: String,
    pub amount_paise: i64,
    pub allocated_paise: i64,
    pub unallocated_paise: i64,
}

fn generate_id(tx: &Transaction<'_>, prefix: &str) -> Result<String, PostingError> {
    let hex_val: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
    Ok(format!("{}_{}", prefix, hex_val))
}

/// Atomically posts a payment into SQLite inside an immediate transaction.
/// Supports both customer receipts (crediting Accounts Receivable) and
/// supplier vouchers (debiting Accounts Payable).
pub fn post_payment(
    conn: &mut Connection,
    input: &PaymentInput,
) -> Result<PostedPayment, PostingError> {
    // 1. Connection guard: verify recursive_triggers and foreign_keys
    let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

    if recursive_triggers != 1 || foreign_keys != 1 {
        return Err(PostingError::InsecureConnection {
            recursive_triggers,
            foreign_keys,
        });
    }

    // 2. Input validation
    if input.amount_paise <= 0 {
        return Err(PostingError::InvalidAmount(input.amount_paise));
    }

    let mut total_allocated_paise: i64 = 0;
    for alloc in &input.allocations {
        if alloc.amount_paise <= 0 {
            return Err(PostingError::InvalidAmount(alloc.amount_paise));
        }
        total_allocated_paise = total_allocated_paise
            .checked_add(alloc.amount_paise)
            .ok_or(PostingError::MathOverflow)?;
    }

    if total_allocated_paise > input.amount_paise {
        return Err(PostingError::AllocationExceedsPayment {
            allocated_paise: total_allocated_paise,
            payment_paise: input.amount_paise,
        });
    }

    // Begin immediate transaction
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 3. Verify entity exists and get entity_type
    let entity_type: String = match tx.query_row(
        "SELECT entity_type FROM entities WHERE id = ?1",
        params![&input.entity_id],
        |r| r.get(0),
    ) {
        Ok(t) => t,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(PostingError::EntityNotFound(input.entity_id.clone()));
        }
        Err(e) => return Err(PostingError::Database(e)),
    };

    // 4. Validate allocations (transaction must exist, belong to entity, and not be overpaid)
    let mut requested_alloc_per_tx: HashMap<String, i64> = HashMap::new();
    for alloc in &input.allocations {
        let entry = requested_alloc_per_tx.entry(alloc.transaction_id.clone()).or_insert(0);
        *entry = entry.checked_add(alloc.amount_paise).ok_or(PostingError::MathOverflow)?;
    }

    for (tx_id, requested_alloc) in requested_alloc_per_tx {
        let (tx_entity_id, status, total_amount_paise): (String, String, i64) = match tx.query_row(
            "SELECT entity_id, status, total_amount_paise FROM transactions WHERE id = ?1",
            params![&tx_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ) {
            Ok(res) => res,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(PostingError::TransactionNotFound(tx_id));
            }
            Err(e) => return Err(PostingError::Database(e)),
        };

        if status != "POSTED" {
            return Err(PostingError::InvalidOriginalTransaction(format!(
                "Transaction {} has status {}, expected POSTED",
                tx_id, status
            )));
        }

        if tx_entity_id != input.entity_id {
            return Err(PostingError::InvalidOriginalTransaction(format!(
                "Transaction {} entity '{}' does not match payment entity '{}'",
                tx_id, tx_entity_id, input.entity_id
            )));
        }

        // Query sum of all prior allocations on this transaction
        let prior_allocated_paise: i64 = tx.query_row(
            "SELECT COALESCE(SUM(amount_allocated_paise), 0)
             FROM payment_allocations
             WHERE transaction_id = ?1",
            params![&tx_id],
            |r| r.get(0),
        )?;

        let unpaid_balance_paise = total_amount_paise
            .checked_sub(prior_allocated_paise)
            .ok_or(PostingError::MathOverflow)?;

        if requested_alloc > unpaid_balance_paise {
            return Err(PostingError::AllocationExceedsInvoiceBalance {
                transaction_id: tx_id,
                allocated_paise: requested_alloc,
                unpaid_balance_paise,
            });
        }
    }

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

    // 5. Allocate gapless payment number
    let (_series, payment_number) = allocate_invoice_number(&tx, "PAY", &input.payment_date)?;

    let payment_id = generate_id(&tx, "pay")?;

    // 6. Insert payments row
    tx.execute(
        "INSERT INTO payments (
            id, payment_number, entity_id, payment_mode, amount_paise,
            reference_number, created_by_user_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &payment_id,
            &payment_number,
            &input.entity_id,
            input.payment_mode.as_str(),
            input.amount_paise,
            &input.reference_number,
            &user_id,
        ],
    )?;

    // 7. Insert payment_allocations
    for alloc in &input.allocations {
        let alloc_id = generate_id(&tx, "pa")?;
        tx.execute(
            "INSERT INTO payment_allocations (
                id, payment_id, transaction_id, amount_allocated_paise
            ) VALUES (?1, ?2, ?3, ?4)",
            params![
                &alloc_id,
                &payment_id,
                &alloc.transaction_id,
                alloc.amount_paise,
            ],
        )?;
    }

    // 8. Balanced ledger entries
    let cash_bank_account = match input.payment_mode {
        PaymentMode::Cash => "acc_1000",
        PaymentMode::Upi | PaymentMode::Card | PaymentMode::BankTransfer | PaymentMode::Cheque => {
            "acc_1010"
        }
    };

    let narration = match &input.reference_number {
        Some(ref_no) => format!(
            "Payment {} via {} (Ref: {})",
            payment_number,
            input.payment_mode.as_str(),
            ref_no
        ),
        None => format!(
            "Payment {} via {}",
            payment_number,
            input.payment_mode.as_str()
        ),
    };

    if entity_type == "SUPPLIER" {
        // Outbound voucher to supplier:
        // Debit Accounts Payable (acc_2000), Credit Cash/Bank
        let le_debit_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, 'acc_2000', ?3, 0, ?4)",
            params![&le_debit_id, &payment_id, input.amount_paise, &narration],
        )?;

        let le_credit_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, ?3, 0, ?4, ?5)",
            params![
                &le_credit_id,
                &payment_id,
                cash_bank_account,
                input.amount_paise,
                &narration,
            ],
        )?;
    } else {
        // Inbound receipt from customer / patient / student:
        // Debit Cash/Bank, Credit Accounts Receivable (acc_1100)
        let le_debit_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, ?3, ?4, 0, ?5)",
            params![
                &le_debit_id,
                &payment_id,
                cash_bank_account,
                input.amount_paise,
                &narration,
            ],
        )?;

        let le_credit_id = generate_id(&tx, "le")?;
        tx.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES (?1, NULL, ?2, 'acc_1100', 0, ?3, ?4)",
            params![&le_credit_id, &payment_id, input.amount_paise, &narration],
        )?;
    }

    // 9. Commit transaction
    tx.commit()?;

    let unallocated = input
        .amount_paise
        .checked_sub(total_allocated_paise)
        .ok_or(PostingError::MathOverflow)?;

    Ok(PostedPayment {
        payment_id,
        payment_number,
        entity_id: input.entity_id.clone(),
        amount_paise: input.amount_paise,
        allocated_paise: total_allocated_paise,
        unallocated_paise: unallocated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::{MIGRATIONS, run_migrations};
    use crate::database::open_connection;
    use crate::database::queries::verify_ledger;
    use crate::posting::{LineInput, PriceMode, SaleInput, post_sale};
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = open_connection(":memory:").expect("open test db");
        run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

        // Seed customer entity
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_cust_1', 'CUST001', 'CUSTOMER', 'Acme Corp', '27')",
            [],
        )
        .expect("seed customer");

        // Seed supplier entity
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_supp_1', 'SUPP001', 'SUPPLIER', 'Global Supplies', '27')",
            [],
        )
        .expect("seed supplier");

        // Seed resource and lot for sale
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
             VALUES ('res_1', 'SKU-01', 'Test Item', '1234', 1800, 10000, 1)",
            [],
        )
        .expect("seed resource");

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
             VALUES ('lot_1', 'res_1', 'B001', 15000)",
            [],
        )
        .expect("seed lot");

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, reason, quantity_delta_milli)
             VALUES ('sm_seed', 'res_1', 'lot_1', 'PURCHASE', 100000)",
            [],
        )
        .expect("seed stock");

        conn
    }

    #[test]
    fn test_valid_cash_customer_payment_with_allocation() {
        let mut conn = setup_test_db();

        // First post a sale
        let sale_res = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-10-20".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_cust_1".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 1000,    // 1 unit
                    unit_price_paise: 10000, // 100 INR
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("post sale");

        let sale_total = sale_res.totals.total_amount_paise; // 11800 paise

        // Now post customer payment receipt
        let pay_res = post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_cust_1".to_string(),
                payment_mode: PaymentMode::Cash,
                amount_paise: sale_total,
                reference_number: Some("CASH-REC-001".to_string()),
                payment_date: "2026-10-20".to_string(),
                allocations: vec![PaymentAllocationInput {
                    transaction_id: sale_res.transaction_id,
                    amount_paise: sale_total,
                }],
            },
        )
        .expect("post payment");

        assert_eq!(pay_res.amount_paise, sale_total);
        assert_eq!(pay_res.allocated_paise, sale_total);
        assert_eq!(pay_res.unallocated_paise, 0);

        // Verify ledger consistency
        let discrepancies = verify_ledger(&conn).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "Discrepancies: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_valid_supplier_payout_voucher() {
        let mut conn = setup_test_db();

        let pay_res = post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_supp_1".to_string(),
                payment_mode: PaymentMode::BankTransfer,
                amount_paise: 50000, // 500 INR
                reference_number: Some("NEFT123456".to_string()),
                payment_date: "2026-10-20".to_string(),
                allocations: vec![],
            },
        )
        .expect("post supplier payment");

        assert_eq!(pay_res.amount_paise, 50000);
        assert_eq!(pay_res.allocated_paise, 0);
        assert_eq!(pay_res.unallocated_paise, 50000);

        let discrepancies = verify_ledger(&conn).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "Discrepancies: {:?}",
            discrepancies
        );
    }

    #[test]
    fn test_allocation_exceeds_payment_rejected() {
        let mut conn = setup_test_db();

        let err = post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_cust_1".to_string(),
                payment_mode: PaymentMode::Upi,
                amount_paise: 1000,
                reference_number: None,
                payment_date: "2026-10-20".to_string(),
                allocations: vec![PaymentAllocationInput {
                    transaction_id: "tx_dummy".to_string(),
                    amount_paise: 2000,
                }],
            },
        )
        .unwrap_err();

        assert!(matches!(err, PostingError::AllocationExceedsPayment { .. }));
    }

    #[test]
    fn test_insecure_connection_rejected() {
        let mut conn = Connection::open_in_memory().unwrap();
        // Pragmas not applied!

        let err = post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_cust_1".to_string(),
                payment_mode: PaymentMode::Cash,
                amount_paise: 1000,
                reference_number: None,
                payment_date: "2026-10-20".to_string(),
                allocations: vec![],
            },
        )
        .unwrap_err();

        assert!(matches!(err, PostingError::InsecureConnection { .. }));
    }
}
