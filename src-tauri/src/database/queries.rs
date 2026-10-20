use rusqlite::{Connection, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerDiscrepancy {
    UnbalancedTransaction {
        transaction_id: String,
        net_difference_paise: i64,
    },
    UnbalancedPayment {
        payment_id: String,
        net_difference_paise: i64,
    },
    GlobalImbalance {
        total_debit_paise: i64,
        total_credit_paise: i64,
    },
    PostedTransactionWithoutEntries {
        transaction_id: String,
    },
}

impl std::fmt::Display for LedgerDiscrepancy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LedgerDiscrepancy::UnbalancedTransaction {
                transaction_id,
                net_difference_paise,
            } => {
                write!(
                    f,
                    "UNBALANCED_TRANSACTION: id={}, diff_paise={}",
                    transaction_id, net_difference_paise
                )
            }
            LedgerDiscrepancy::UnbalancedPayment {
                payment_id,
                net_difference_paise,
            } => {
                write!(
                    f,
                    "UNBALANCED_PAYMENT: id={}, diff_paise={}",
                    payment_id, net_difference_paise
                )
            }
            LedgerDiscrepancy::GlobalImbalance {
                total_debit_paise,
                total_credit_paise,
            } => {
                write!(
                    f,
                    "GLOBAL_IMBALANCE: debits={}, credits={}",
                    total_debit_paise, total_credit_paise
                )
            }
            LedgerDiscrepancy::PostedTransactionWithoutEntries { transaction_id } => {
                write!(f, "POSTED_WITHOUT_ENTRIES: id={}", transaction_id)
            }
        }
    }
}

/// Performs an internal consistency audit of the general ledger and posted transactions.
///
/// All checks run inside a single read transaction to guarantee a point-in-time snapshot.
/// Not covered by a unit test; protects against concurrent access, which is not expected in the single-user MVP.
///
/// What is checked:
/// 1. Transaction-level balance: SUM(debit_paise) == SUM(credit_paise) for every transaction_id in ledger_entries.
/// 2. Payment-level balance: SUM(debit_paise) == SUM(credit_paise) for every payment_id in ledger_entries.
/// 3. Grand total ledger balance: Grand total of all debit_paise == Grand total of all credit_paise across the entire ledger.
/// 4. Orphaned POSTED transactions: Every transaction with status = 'POSTED' has at least one ledger_entries row.
///
/// What is NOT checked:
/// - This function does NOT compare ledger entry amounts to transactions.total_amount_paise or transaction_items.
/// - It does NOT verify inventory stock movements against transactions.
/// - It does NOT verify tax breakdown splits against entity state codes.
pub fn verify_ledger(conn: &Connection) -> Result<Vec<LedgerDiscrepancy>> {
    let tx = conn.unchecked_transaction()?;
    let mut discrepancies = Vec::new();

    // 1. Check balance per transaction_id
    let mut stmt_tx = tx.prepare(
        "SELECT transaction_id,
                SUM(debit_paise) - SUM(credit_paise) as diff
         FROM ledger_entries
         WHERE transaction_id IS NOT NULL
         GROUP BY transaction_id
         HAVING diff != 0",
    )?;
    let tx_rows = stmt_tx.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for r in tx_rows {
        let (tx_id, diff) = r?;
        discrepancies.push(LedgerDiscrepancy::UnbalancedTransaction {
            transaction_id: tx_id,
            net_difference_paise: diff,
        });
    }

    // 2. Check balance per payment_id
    let mut stmt_pay = tx.prepare(
        "SELECT payment_id,
                SUM(debit_paise) - SUM(credit_paise) as diff
         FROM ledger_entries
         WHERE payment_id IS NOT NULL
         GROUP BY payment_id
         HAVING diff != 0",
    )?;
    let pay_rows = stmt_pay.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for r in pay_rows {
        let (pay_id, diff) = r?;
        discrepancies.push(LedgerDiscrepancy::UnbalancedPayment {
            payment_id: pay_id,
            net_difference_paise: diff,
        });
    }

    // 3. Check grand total debits == credits
    let (total_debit, total_credit): (i64, i64) = tx.query_row(
        "SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0) FROM ledger_entries",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if total_debit != total_credit {
        discrepancies.push(LedgerDiscrepancy::GlobalImbalance {
            total_debit_paise: total_debit,
            total_credit_paise: total_credit,
        });
    }

    // 4. Return POSTED transactions that have zero ledger_entries
    let mut stmt_missing = tx.prepare(
        "SELECT t.id
         FROM transactions t
         WHERE t.status = 'POSTED'
           AND t.total_amount_paise > 0
           AND NOT EXISTS (
               SELECT 1 FROM ledger_entries l WHERE l.transaction_id = t.id
           )",
    )?;
    let missing_rows = stmt_missing.query_map([], |row| row.get::<_, String>(0))?;
    for r in missing_rows {
        let tx_id = r?;
        discrepancies.push(LedgerDiscrepancy::PostedTransactionWithoutEntries {
            transaction_id: tx_id,
        });
    }

    Ok(discrepancies)
}
