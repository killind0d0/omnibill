use rusqlite::{Connection, Result};

/// Scans ledger_entries for any transaction_id where SUM(debit_paise) != SUM(credit_paise).
/// Returns a list of transaction IDs that are imbalanced.
/// If all transactions in the ledger are balanced, returns an empty vector.
pub fn verify_ledger(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT transaction_id
         FROM ledger_entries
         WHERE transaction_id IS NOT NULL
         GROUP BY transaction_id
         HAVING SUM(debit_paise) != SUM(credit_paise)",
    )?;

    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut imbalanced = Vec::new();
    for id in rows {
        imbalanced.push(id?);
    }
    Ok(imbalanced)
}
