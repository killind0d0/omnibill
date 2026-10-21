//! Product Discovery CSV Export & WhatsApp Summary Module
//!
//! Provides streaming CSV export with UTF-8 BOM, RFC 4180 quoting, CSV-injection defense,
//! and float-free integer currency math.
//! Generates concise WhatsApp-friendly day summaries for business owners.

use crate::discovery::graph::civil_from_days;
use crate::discovery::math::div_round_half_up;
use crate::discovery::query::{
    build_base_where, Dir, DiscoveryQuery, ProductDiscoveryItem,
    SortKey, SortSpec, WhereFilterOptions,
};
use rusqlite::{params, Connection};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
pub const MAX_EXPORT_ROWS: u64 = 200_000;
pub const EXPORT_CHUNK_SIZE: u32 = 1_000;

/// Formats paise integer as a decimal rupee string without floating-point math.
/// Example: `1250` -> `"12.50"`, `-50` -> `"-0.50"`, `0` -> `"0.00"`.
pub fn format_paise_str(paise: i64) -> String {
    let sign = if paise < 0 { "-" } else { "" };
    let abs_p = paise.abs();
    format!("{}{}.{:02}", sign, abs_p / 100, abs_p % 100)
}

/// Applies CSV-injection defense and RFC 4180 escaping to text fields.
/// 1. If text starts with `=, +, -, @, \t, \r`, prefixes `'`.
/// 2. If text contains `, ", \r, \n`, wraps in double quotes and doubles internal quotes.
pub fn sanitize_csv_field(val: &str) -> String {
    let mut s = val.to_string();
    if s.starts_with('=')
        || s.starts_with('+')
        || s.starts_with('-')
        || s.starts_with('@')
        || s.starts_with('\t')
        || s.starts_with('\r')
    {
        s = format!("'{}", s);
    }

    if s.contains(',') || s.contains('"') || s.contains('\r') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// Formats a single product row as an RFC 4180 CSV line terminated by `\r\n`.
pub fn format_csv_row(item: &ProductDiscoveryItem) -> String {
    let abc_str = match item.abc_class {
        1 => "A",
        2 => "B",
        _ => "C",
    };

    format!(
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\r\n",
        sanitize_csv_field(&item.id),
        sanitize_csv_field(&item.sku),
        sanitize_csv_field(item.barcode.as_deref().unwrap_or("")),
        sanitize_csv_field(&item.name),
        item.tax_bp,
        format_paise_str(item.sell_paise),
        format_paise_str(item.avg_cost_paise),
        item.margin_bp,
        item.stock_milli,
        format_paise_str(item.stock_value_paise),
        item.reorder_milli,
        item.max_stock_milli,
        item.earliest_expiry_day,
        item.last_received_day,
        item.last_sold_day,
        item.qty_7_milli,
        item.qty_30_milli,
        item.qty_90_milli,
        format_paise_str(item.rev_90_paise),
        format_paise_str(item.gp_90_paise),
        item.runout_days_x10,
        item.gmroi_bp,
        abc_str,
        if item.is_critical { 1 } else { 0 },
    )
}

pub fn csv_header() -> &'static str {
    "ID,SKU,Barcode,Name,Tax Rate (bps),Sell Price (INR),Cost Price (INR),Margin (bps),Stock (milli),Stock Value (INR),Reorder (milli),Max Stock (milli),Earliest Expiry Day,Last Received Day,Last Sold Day,Qty 7D (milli),Qty 30D (milli),Qty 90D (milli),Rev 90D (INR),GP 90D (INR),Runout (days x10),GMROI (bps),ABC Class,Is Critical\r\n"
}

/// Streams all matching rows for the given query to a CSV file inside a single read transaction.
/// Enforces a hard cap of 200,000 rows.
pub fn export_discovery(
    conn: &Connection,
    query: &DiscoveryQuery,
    vertical: &str,
    today: i64,
    out_dir: Option<&str>,
) -> Result<PathBuf, String> {
    // 1. Determine sort specs
    let effective_sort = if query.sort.is_empty() {
        vec![SortSpec {
            key: SortKey::Name,
            dir: Dir::Asc,
        }]
    } else {
        query.sort.clone()
    };

    // 2. Build base WHERE clause
    let (where_clauses, where_params) =
        build_base_where(conn, vertical, today, query, WhereFilterOptions::default())
            .map_err(|e| e.to_string())?;

    let where_str = where_clauses.join(" AND ");

    // Count total matching rows to enforce hard cap
    let count_sql = format!(
        "SELECT COUNT(*)
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE {}",
        where_str
    );

    let rusqlite_slice: Vec<&dyn rusqlite::ToSql> =
        where_params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();

    let total_count: u64 = conn
        .query_row(&count_sql, rusqlite_slice.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if total_count > MAX_EXPORT_ROWS {
        return Err(format!(
            "Export row count exceeds maximum hard cap of {} (found {})",
            MAX_EXPORT_ROWS, total_count
        ));
    }

    // 3. Prepare output file path
    let (y, m, d) = civil_from_days(today);
    let filename = format!("omnibill-discovery-{}-{:04}{:02}{:02}.csv", vertical, y, m, d);
    let target_dir = out_dir.unwrap_or(".");
    let out_path = Path::new(target_dir).join(&filename);

    let mut file = File::create(&out_path).map_err(|e| format!("Failed to create export file: {}", e))?;

    // 4. Write UTF-8 BOM and Header
    file.write_all(UTF8_BOM)
        .map_err(|e| format!("Failed to write BOM: {}", e))?;
    file.write_all(csv_header().as_bytes())
        .map_err(|e| format!("Failed to write header: {}", e))?;

    if total_count == 0 {
        file.flush().map_err(|e| e.to_string())?;
        return Ok(out_path);
    }

    // 5. Build ORDER BY clause
    let mut order_parts: Vec<String> = effective_sort
        .iter()
        .map(|s| {
            let dir_str = if s.dir == Dir::Asc { "ASC" } else { "DESC" };
            format!("{} {}", s.key.column_expr(), dir_str)
        })
        .collect();
    order_parts.push(format!(
        "s.resource_id {}",
        if effective_sort[0].dir == Dir::Asc {
            "ASC"
        } else {
            "DESC"
        }
    ));
    let order_str = order_parts.join(", ");

    let select_sql = format!(
        "SELECT
            s.resource_id,
            r.sku_or_code,
            r.name,
            r.barcode,
            s.brand_id,
            s.category_id,
            s.tax_bp,
            s.sell_paise,
            s.avg_cost_paise,
            s.margin_bp,
            s.stock_milli,
            s.reorder_milli,
            s.max_stock_milli,
            s.stock_value_paise,
            s.earliest_expiry_day,
            s.last_received_day,
            s.last_sold_day,
            s.qty_7_milli,
            s.qty_30_milli,
            s.qty_90_milli,
            s.rev_90_paise,
            s.gp_90_paise,
            s.runout_days_x10,
            s.gmroi_bp,
            s.abc_class,
            r.is_critical
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE {}
         ORDER BY {}
         LIMIT ? OFFSET ?",
        where_str, order_str
    );

    // 6. Execute consistent snapshot streaming in chunks of 1,000 using read transaction
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to begin read snapshot transaction: {}", e))?;

    let mut offset = 0u64;
    while offset < total_count {
        let chunk_limit = EXPORT_CHUNK_SIZE as i64;
        let offset_i64 = offset as i64;
        let mut chunk_slice: Vec<&dyn rusqlite::ToSql> =
            where_params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        chunk_slice.push(&chunk_limit);
        chunk_slice.push(&offset_i64);

        let mut stmt = tx.prepare(&select_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(chunk_slice.as_slice(), |row| {
                Ok(ProductDiscoveryItem {
                    id: row.get(0)?,
                    sku: row.get(1)?,
                    name: row.get(2)?,
                    barcode: row.get(3)?,
                    brand_id: row.get(4)?,
                    category_id: row.get(5)?,
                    tax_bp: row.get(6)?,
                    sell_paise: row.get(7)?,
                    avg_cost_paise: row.get(8)?,
                    margin_bp: row.get(9)?,
                    stock_milli: row.get(10)?,
                    reorder_milli: row.get(11)?,
                    max_stock_milli: row.get(12)?,
                    stock_value_paise: row.get(13)?,
                    earliest_expiry_day: row.get(14)?,
                    last_received_day: row.get(15)?,
                    last_sold_day: row.get(16)?,
                    qty_7_milli: row.get(17)?,
                    qty_30_milli: row.get(18)?,
                    qty_90_milli: row.get(19)?,
                    rev_90_paise: row.get(20)?,
                    gp_90_paise: row.get(21)?,
                    runout_days_x10: row.get(22)?,
                    gmroi_bp: row.get(23)?,
                    abc_class: row.get(24)?,
                    is_critical: row.get::<_, i64>(25)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut count_in_chunk = 0u64;
        for item in rows {
            let item = item.map_err(|e| e.to_string())?;
            let line = format_csv_row(&item);
            file.write_all(line.as_bytes())
                .map_err(|e| format!("Failed to write CSV line: {}", e))?;
            count_in_chunk += 1;
        }

        if count_in_chunk == 0 {
            break;
        }
        offset += count_in_chunk;
    }

    file.flush()
        .map_err(|e| format!("Failed to flush CSV: {}", e))?;

    // Read transaction finishes naturally (no commit needed on read)
    let _ = tx.finish();

    Ok(out_path)
}

/// Generates a concise WhatsApp day-summary plain text under 1,000 characters.
pub fn day_summary_text(
    conn: &Connection,
    vertical: &str,
    day: i64,
) -> Result<String, rusqlite::Error> {
    let (y, m, d) = civil_from_days(day);

    // 1. Sales & Gross Profit totals for that day
    let (bills, net_paise, cogs_paise): (i64, i64, i64) = conn.query_row(
        "SELECT
            COALESCE(SUM(s.bills), 0),
            COALESCE(SUM(s.net_paise), 0),
            COALESCE(SUM(s.cogs_paise), 0)
         FROM sales_daily s
         JOIN product_stats ps ON ps.resource_id = s.resource_id
         WHERE s.day = ?1 AND ps.vertical = ?2",
        params![day, vertical],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let gp_paise = net_paise.saturating_sub(cogs_paise);
    let margin_bp = if net_paise > 0 {
        div_round_half_up((gp_paise as i128) * 10000, net_paise as i128).unwrap_or(0)
    } else {
        0
    };

    // 2. Top 5 Products by Revenue
    let mut top_stmt = conn.prepare(
        "SELECT r.name, SUM(s.net_paise) as rev, SUM(s.qty_milli) as qty
         FROM sales_daily s
         JOIN resources r ON r.id = s.resource_id
         JOIN product_stats ps ON ps.resource_id = s.resource_id
         WHERE s.day = ?1 AND ps.vertical = ?2
         GROUP BY s.resource_id, r.name
         ORDER BY rev DESC
         LIMIT 5",
    )?;

    let top_rows = top_stmt.query_map(params![day, vertical], |row| {
        let name: String = row.get(0)?;
        let rev: i64 = row.get(1)?;
        let qty: i64 = row.get(2)?;
        Ok((name, rev, qty))
    })?;

    let mut top_lines = Vec::new();
    for (rank, r) in (1..).zip(top_rows) {
        let (name, rev, qty) = r?;
        top_lines.push(format!(
            "{}. {} - ₹{} ({} units)",
            rank,
            name,
            format_paise_str(rev),
            qty / 1000
        ));
    }

    // 3. Alerts by kind on this day
    let mut alert_stmt = conn.prepare(
        "SELECT kind, COUNT(*)
         FROM alerts
         WHERE day = ?1
         GROUP BY kind
         ORDER BY kind",
    )?;

    let alert_rows = alert_stmt.query_map(params![day], |row| {
        let kind: String = row.get(0)?;
        let cnt: i64 = row.get(1)?;
        Ok((kind, cnt))
    })?;

    let mut expiry_alerts = 0i64;
    let mut stockout_alerts = 0i64;
    let mut dead_alerts = 0i64;
    let mut reorder_alerts = 0i64;

    for r in alert_rows {
        let (kind, cnt) = r?;
        match kind.as_str() {
            "expiry" => expiry_alerts = cnt,
            "stockout" => stockout_alerts = cnt,
            "dead" => dead_alerts = cnt,
            "below_reorder" => reorder_alerts = cnt,
            _ => {}
        }
    }

    let top_section = if top_lines.is_empty() {
        "• No item sales recorded today".to_string()
    } else {
        top_lines.join("\n")
    };

    let summary = format!(
        "*OmniBill Daily Summary* ({}, Day {})\n\
         📅 Date: {:04}-{:02}-{:02}\n\
         ━━━━━━━━━━━━━━━━━━━━\n\
         📊 *Performance*\n\
         • Bills: {}\n\
         • Net Sales: ₹{}\n\
         • Gross Profit: ₹{}\n\
         • Margin: {}.{:02}%\n\n\
         🏆 *Top Products by Revenue*\n\
         {}\n\n\
         ⚠️ *Active Risk Alerts*\n\
         • Expiry: {}\n\
         • Stockout: {}\n\
         • Dead Stock: {}\n\
         • Below Reorder: {}\n\
         ━━━━━━━━━━━━━━━━━━━━\n\
         OmniBill Offline ERP",
        vertical.to_uppercase(),
        day,
        y,
        m,
        d,
        bills,
        format_paise_str(net_paise),
        format_paise_str(gp_paise),
        margin_bp / 100,
        (margin_bp % 100).abs(),
        top_section,
        expiry_alerts,
        stockout_alerts,
        dead_alerts,
        reorder_alerts
    );

    Ok(summary)
}
