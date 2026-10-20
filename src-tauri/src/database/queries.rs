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

/// Scans ledger_entries and transactions for accounting discrepancies:
/// 1. Transaction-level imbalance: SUM(debit_paise) != SUM(credit_paise) per transaction_id.
/// 2. Payment-level imbalance: SUM(debit_paise) != SUM(credit_paise) per payment_id.
/// 3. Global ledger imbalance: grand total of debits != credits.
/// 4. Orphaned POSTED transactions: status = 'POSTED' with 0 ledger_entries.
///
/// Returns an empty vector if and only if the entire ledger is completely balanced and consistent.
pub fn verify_ledger(conn: &Connection) -> Result<Vec<LedgerDiscrepancy>> {
    let mut discrepancies = Vec::new();

    // 1. Check balance per transaction_id
    let mut stmt_tx = conn.prepare(
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
    let mut stmt_pay = conn.prepare(
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
    let (total_debit, total_credit): (i64, i64) = conn.query_row(
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
    let mut stmt_missing = conn.prepare(
        "SELECT t.id
         FROM transactions t
         WHERE t.status = 'POSTED'
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
