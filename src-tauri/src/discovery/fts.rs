use rusqlite::{params, Connection, Result};

/// Rebuilds the `products_fts` trigram table from scratch by clearing it
/// and repopulating from `resources` joined with `brands`.
///
/// `rowid` is populated with `CAST(r.id AS INTEGER)` if numeric (or `r.rowid`),
/// ensuring rowid equals `resources.id`.
pub fn rebuild_fts(conn: &Connection) -> Result<u64> {
    conn.execute("DELETE FROM products_fts", [])?;
    let count = conn.execute(
        "INSERT INTO products_fts (rowid, name, sku, barcode, brand)
         SELECT
             COALESCE(CAST(r.id AS INTEGER), r.rowid),
             r.name,
             r.sku_or_code,
             COALESCE(r.barcode, ''),
             COALESCE(b.name, '')
         FROM resources r
         LEFT JOIN brands b ON b.id = r.brand_id",
        [],
    )?;
    Ok(count as u64)
}

/// Upserts a single resource into `products_fts`.
/// Deletes any existing row with the matching rowid and re-inserts.
pub fn upsert_fts(conn: &Connection, resource_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM products_fts WHERE rowid = (
             SELECT COALESCE(CAST(r.id AS INTEGER), r.rowid)
             FROM resources r WHERE r.id = ?1
         )",
        params![resource_id],
    )?;

    conn.execute(
        "INSERT INTO products_fts (rowid, name, sku, barcode, brand)
         SELECT
             COALESCE(CAST(r.id AS INTEGER), r.rowid),
             r.name,
             r.sku_or_code,
             COALESCE(r.barcode, ''),
             COALESCE(b.name, '')
         FROM resources r
         LEFT JOIN brands b ON b.id = r.brand_id
         WHERE r.id = ?1",
        params![resource_id],
    )?;
    Ok(())
}
