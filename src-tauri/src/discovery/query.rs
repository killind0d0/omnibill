use crate::discovery::cursor::{decode_cursor, encode_cursor, CursorError, CursorVal};
use rusqlite::{types::ToSqlOutput, Connection, ToSql};
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub min: Option<i64>,
    pub max: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    Name,
    Margin,
    Velocity,
    Stock,
    Runout,
    Expiry,
    LastSold,
    Received,
    Value,
    Gmroi,
    Revenue,
}

impl SortKey {
    pub fn column_expr(&self) -> &'static str {
        match self {
            SortKey::Name => "r.name COLLATE NOCASE",
            SortKey::Margin => "s.margin_bp",
            SortKey::Velocity => "s.qty_30_milli",
            SortKey::Stock => "s.stock_milli",
            SortKey::Runout => "s.runout_days_x10",
            SortKey::Expiry => "s.earliest_expiry_day",
            SortKey::LastSold => "s.last_sold_day",
            SortKey::Received => "s.last_received_day",
            SortKey::Value => "s.stock_value_paise",
            SortKey::Gmroi => "s.gmroi_bp",
            SortKey::Revenue => "s.rev_90_paise",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Dir {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SortSpec {
    pub key: SortKey,
    pub dir: Dir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    Fast,
    Slow,
    Dead30,
    Dead60,
    Dead90,
    Expiring30,
    Expiring60,
    Expiring90,
    Out,
    BelowReorder,
    Overstock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DiscoveryQuery {
    pub text: Option<String>,
    #[serde(default)]
    pub brand_ids: Vec<i64>,
    #[serde(default)]
    pub supplier_ids: Vec<i64>,
    #[serde(default)]
    pub category_ids: Vec<i64>,
    #[serde(default)]
    pub tax_bp: Vec<i64>,
    pub sell_paise: Option<Range>,
    pub cost_paise: Option<Range>,
    pub margin_bp: Option<Range>,
    pub stock_milli: Option<Range>,
    pub received_day: Option<Range>,
    pub last_sold_day: Option<Range>,
    pub expiry_day: Option<Range>,
    pub preset: Option<Preset>,
    #[serde(default)]
    pub abc: Vec<u8>,
    #[serde(default)]
    pub sort: Vec<SortSpec>,
    #[serde(default = "default_limit")]
    pub limit: u32,
    pub cursor: Option<String>,
}

fn default_limit() -> u32 {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDiscoveryItem {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub barcode: Option<String>,
    pub brand_id: Option<i64>,
    pub category_id: Option<i64>,
    pub tax_bp: i64,
    pub sell_paise: i64,
    pub avg_cost_paise: i64,
    pub margin_bp: i64,
    pub stock_milli: i64,
    pub reorder_milli: i64,
    pub max_stock_milli: i64,
    pub stock_value_paise: i64,
    pub earliest_expiry_day: i64,
    pub last_received_day: i64,
    pub last_sold_day: i64,
    pub qty_7_milli: i64,
    pub qty_30_milli: i64,
    pub qty_90_milli: i64,
    pub rev_90_paise: i64,
    pub gp_90_paise: i64,
    pub runout_days_x10: i64,
    pub gmroi_bp: i64,
    pub abc_class: u8,
    pub is_critical: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPage {
    pub items: Vec<ProductDiscoveryItem>,
    pub next_cursor: Option<String>,
    pub total_capped: u64,
}

#[derive(Debug, Clone)]
pub enum QueryError {
    ListTooLarge(&'static str),
    Cursor(CursorError),
    Db(String),
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryError::ListTooLarge(msg) => write!(f, "Filter list too large (max 500): {}", msg),
            QueryError::Cursor(e) => write!(f, "Cursor error: {}", e),
            QueryError::Db(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for QueryError {}

impl From<CursorError> for QueryError {
    fn from(e: CursorError) -> Self {
        QueryError::Cursor(e)
    }
}

impl From<rusqlite::Error> for QueryError {
    fn from(e: rusqlite::Error) -> Self {
        QueryError::Db(e.to_string())
    }
}

#[derive(Debug, Clone)]
pub enum QueryParam {
    Int(i64),
    Str(String),
}

impl ToSql for QueryParam {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        match self {
            QueryParam::Int(i) => (*i).to_sql(),
            QueryParam::Str(s) => s.as_str().to_sql(),
        }
    }
}

pub fn compute_spec_hash(specs: &[SortSpec]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    specs.hash(&mut hasher);
    hasher.finish()
}

#[derive(Default)]
pub struct WhereFilterOptions {
    pub skip_brand: bool,
    pub skip_supplier: bool,
    pub skip_category: bool,
    pub skip_tax: bool,
}

/// Builds base WHERE clauses and parameters (excluding cursor pagination)
pub fn build_base_where(
    conn: &Connection,
    vertical: &str,
    today: i64,
    q: &DiscoveryQuery,
    opts: WhereFilterOptions,
) -> Result<(Vec<String>, Vec<QueryParam>), QueryError> {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<QueryParam> = Vec::new();

    clauses.push("s.vertical = ?".to_string());
    params.push(QueryParam::Str(vertical.to_string()));

    clauses.push("s.is_active = 1".to_string());

    // 1. Brand filter
    if !opts.skip_brand && !q.brand_ids.is_empty() {
        if q.brand_ids.len() > 500 {
            return Err(QueryError::ListTooLarge("brand_ids"));
        }
        let placeholders = vec!["?"; q.brand_ids.len()].join(", ");
        clauses.push(format!("s.brand_id IN ({})", placeholders));
        for &id in &q.brand_ids {
            params.push(QueryParam::Int(id));
        }
    }

    // 2. Category filter
    if !opts.skip_category && !q.category_ids.is_empty() {
        if q.category_ids.len() > 500 {
            return Err(QueryError::ListTooLarge("category_ids"));
        }
        let placeholders = vec!["?"; q.category_ids.len()].join(", ");
        clauses.push(format!("s.category_id IN ({})", placeholders));
        for &id in &q.category_ids {
            params.push(QueryParam::Int(id));
        }
    }

    // 3. Tax basis points filter
    if !opts.skip_tax && !q.tax_bp.is_empty() {
        if q.tax_bp.len() > 500 {
            return Err(QueryError::ListTooLarge("tax_bp"));
        }
        let placeholders = vec!["?"; q.tax_bp.len()].join(", ");
        clauses.push(format!("s.tax_bp IN ({})", placeholders));
        for &bp in &q.tax_bp {
            params.push(QueryParam::Int(bp));
        }
    }

    // 4. ABC classification filter
    if !q.abc.is_empty() {
        let placeholders = vec!["?"; q.abc.len()].join(", ");
        clauses.push(format!("s.abc_class IN ({})", placeholders));
        for &c in &q.abc {
            params.push(QueryParam::Int(c as i64));
        }
    }

    // 5. Ranges on product_stats
    if let Some(ref r) = q.sell_paise {
        if let Some(min) = r.min {
            clauses.push("s.sell_paise >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.sell_paise <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    if let Some(ref r) = q.cost_paise {
        if let Some(min) = r.min {
            clauses.push("s.avg_cost_paise >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.avg_cost_paise <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    if let Some(ref r) = q.margin_bp {
        if let Some(min) = r.min {
            clauses.push("s.margin_bp >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.margin_bp <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    if let Some(ref r) = q.stock_milli {
        if let Some(min) = r.min {
            clauses.push("s.stock_milli >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.stock_milli <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    if let Some(ref r) = q.last_sold_day {
        if let Some(min) = r.min {
            clauses.push("s.last_sold_day >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.last_sold_day <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    if let Some(ref r) = q.expiry_day {
        if let Some(min) = r.min {
            clauses.push("s.earliest_expiry_day >= ?".to_string());
            params.push(QueryParam::Int(min));
        }
        if let Some(max) = r.max {
            clauses.push("s.earliest_expiry_day <= ?".to_string());
            params.push(QueryParam::Int(max));
        }
    }

    // 6. Supplier and received_day on resource_lots via EXISTS
    let has_supplier = !opts.skip_supplier && !q.supplier_ids.is_empty();
    let has_received = q.received_day.is_some();
    if has_supplier || has_received {
        let mut sub_clauses = vec!["l.resource_id = s.resource_id".to_string()];
        if has_supplier {
            if q.supplier_ids.len() > 500 {
                return Err(QueryError::ListTooLarge("supplier_ids"));
            }
            let placeholders = vec!["?"; q.supplier_ids.len()].join(", ");
            sub_clauses.push(format!(
                "(l.supplier_id IN ({}) OR l.supplier_id IN (SELECT CAST(? AS TEXT)))",
                placeholders
            ));
            for &id in &q.supplier_ids {
                params.push(QueryParam::Str(id.to_string()));
            }
            params.push(QueryParam::Int(q.supplier_ids[0]));
        }
        if let Some(ref r) = q.received_day {
            if let Some(min) = r.min {
                sub_clauses.push("l.received_day >= ?".to_string());
                params.push(QueryParam::Int(min));
            }
            if let Some(max) = r.max {
                sub_clauses.push("l.received_day <= ?".to_string());
                params.push(QueryParam::Int(max));
            }
        }
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM resource_lots l WHERE {})",
            sub_clauses.join(" AND ")
        ));
    }

    // 7. Presets
    if let Some(preset) = q.preset {
        match preset {
            Preset::Out => {
                clauses.push("s.stock_milli = 0".to_string());
            }
            Preset::BelowReorder => {
                clauses.push("s.stock_milli > 0 AND s.stock_milli <= s.reorder_milli".to_string());
            }
            Preset::Overstock => {
                clauses.push(
                    "s.max_stock_milli > 0 AND s.stock_milli > s.max_stock_milli".to_string(),
                );
            }
            Preset::Dead30 => {
                clauses.push(
                    "s.stock_milli > 0 AND (? - MAX(s.last_sold_day, s.last_received_day)) >= 30"
                        .to_string(),
                );
                params.push(QueryParam::Int(today));
            }
            Preset::Dead60 => {
                clauses.push(
                    "s.stock_milli > 0 AND (? - MAX(s.last_sold_day, s.last_received_day)) >= 60"
                        .to_string(),
                );
                params.push(QueryParam::Int(today));
            }
            Preset::Dead90 => {
                clauses.push(
                    "s.stock_milli > 0 AND (? - MAX(s.last_sold_day, s.last_received_day)) >= 90"
                        .to_string(),
                );
                params.push(QueryParam::Int(today));
            }
            Preset::Expiring30 => {
                clauses.push("s.stock_milli > 0 AND s.earliest_expiry_day <= ? + 30".to_string());
                params.push(QueryParam::Int(today));
            }
            Preset::Expiring60 => {
                clauses.push("s.stock_milli > 0 AND s.earliest_expiry_day <= ? + 60".to_string());
                params.push(QueryParam::Int(today));
            }
            Preset::Expiring90 => {
                clauses.push("s.stock_milli > 0 AND s.earliest_expiry_day <= ? + 90".to_string());
                params.push(QueryParam::Int(today));
            }
            Preset::Fast => {
                clauses.push("s.qty_30_milli > 0".to_string());
            }
            Preset::Slow => {
                clauses.push(
                    "s.stock_milli > 0 AND s.qty_90_milli > 0 AND s.qty_30_milli = 0".to_string(),
                );
            }
        }
    }

    // 8. Text search
    if let Some(ref text) = q.text {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let is_pure_digits = trimmed.len() >= 6 && trimmed.chars().all(|c| c.is_ascii_digit());
            let barcode_matches = if is_pure_digits {
                let cnt: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM resources r JOIN product_stats s ON s.resource_id = r.id WHERE s.vertical = ?1 AND s.is_active = 1 AND r.barcode = ?2",
                    rusqlite::params![vertical, trimmed],
                    |r| r.get(0),
                ).unwrap_or(0);
                cnt > 0
            } else {
                false
            };

            if barcode_matches {
                clauses.push("r.barcode = ?".to_string());
                params.push(QueryParam::Str(trimmed.to_string()));
            } else if trimmed.chars().count() >= 3 {
                let sanitized_phrase = format!("\"{}\"", trimmed.replace('"', "\"\""));
                clauses.push(
                    "s.resource_id IN (SELECT r_fts.id FROM resources r_fts WHERE r_fts.rowid IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?))"
                        .to_string(),
                );
                params.push(QueryParam::Str(sanitized_phrase));
            } else {
                let escaped = trimmed
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_");
                clauses.push("r.name LIKE ? ESCAPE '\\'".to_string());
                params.push(QueryParam::Str(format!("{}%", escaped)));
            }
        }
    }

    Ok((clauses, params))
}

/// Executes product discovery query with keyset cursor pagination.
pub fn discover_products(
    conn: &Connection,
    vertical: &str,
    today: i64,
    q: &DiscoveryQuery,
) -> Result<DiscoveryPage, QueryError> {
    let limit = q.limit.clamp(1, 200);

    // Determine effective sort keys (capped at 3; default Velocity Desc if empty)
    let effective_sort = if q.sort.is_empty() {
        vec![SortSpec {
            key: SortKey::Velocity,
            dir: Dir::Desc,
        }]
    } else {
        q.sort.iter().take(3).copied().collect()
    };

    let spec_hash = compute_spec_hash(&effective_sort);

    // Build base WHERE clause
    let (mut where_clauses, mut where_params) =
        build_base_where(conn, vertical, today, q, WhereFilterOptions::default())?;

    // Keyset cursor handling
    if let Some(ref cursor_str) = q.cursor {
        let (cursor_vals, cursor_id) = decode_cursor(cursor_str, spec_hash)?;

        // Expanded OR predicate for arbitrary mixed directions
        // (k1 OP1 ?) OR (k1 = ? AND k2 OP2 ?) OR (k1 = ? AND k2 = ? AND id OP3 ?)
        let first_dir = effective_sort[0].dir;
        let mut key_columns: Vec<(&'static str, Dir)> = effective_sort
            .iter()
            .map(|s| (s.key.column_expr(), s.dir))
            .collect();
        key_columns.push(("s.resource_id", first_dir));

        let mut all_vals = cursor_vals;
        all_vals.push(CursorVal::Str(cursor_id));

        let mut or_branches = Vec::new();
        let total_keys = key_columns.len();

        for m in 0..total_keys {
            let mut and_parts = Vec::new();
            for k in 0..m {
                let (col, _) = key_columns[k];
                if col.contains("COLLATE NOCASE") {
                    and_parts.push("r.name = ? COLLATE NOCASE".to_string());
                } else {
                    and_parts.push(format!("{} = ?", col));
                }
                match &all_vals[k] {
                    CursorVal::Int(v) => where_params.push(QueryParam::Int(*v)),
                    CursorVal::Str(s) => where_params.push(QueryParam::Str(s.clone())),
                }
            }

            let (col_m, dir_m) = key_columns[m];
            let op = if dir_m == Dir::Desc { "<" } else { ">" };
            if col_m.contains("COLLATE NOCASE") {
                and_parts.push(format!("r.name {} ? COLLATE NOCASE", op));
            } else {
                and_parts.push(format!("{} {} ?", col_m, op));
            }
            match &all_vals[m] {
                CursorVal::Int(v) => where_params.push(QueryParam::Int(*v)),
                CursorVal::Str(s) => where_params.push(QueryParam::Str(s.clone())),
            }

            or_branches.push(format!("({})", and_parts.join(" AND ")));
        }

        where_clauses.push(format!("({})", or_branches.join(" OR ")));
    }

    let where_str = where_clauses.join(" AND ");

    // ORDER BY clause: static column expressions with resource_id tiebreaker
    let first_dir = effective_sort[0].dir;
    let mut order_parts: Vec<String> = effective_sort
        .iter()
        .map(|s| {
            let dir_str = if s.dir == Dir::Asc { "ASC" } else { "DESC" };
            format!("{} {}", s.key.column_expr(), dir_str)
        })
        .collect();

    let tie_dir_str = if first_dir == Dir::Asc { "ASC" } else { "DESC" };
    order_parts.push(format!("s.resource_id {}", tie_dir_str));
    let order_str = format!("ORDER BY {}", order_parts.join(", "));

    // Query limit + 1 to detect next page
    let query_sql = format!(
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
         {}
         LIMIT {}",
        where_str,
        order_str,
        limit + 1
    );

    let mut stmt = conn.prepare(&query_sql)?;
    let rusqlite_params: Vec<&dyn ToSql> = where_params.iter().map(|p| p as &dyn ToSql).collect();

    let mut rows = stmt.query(rusqlite_params.as_slice())?;
    let mut items = Vec::new();

    while let Some(row) = rows.next()? {
        let item = ProductDiscoveryItem {
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
        };
        items.push(item);
    }
    drop(rows);
    drop(stmt);

    let has_extra = items.len() > limit as usize;
    if has_extra {
        items.pop();
    }

    let next_cursor = if has_extra && !items.is_empty() {
        let last_item = items.last().unwrap();
        let mut sort_vals = Vec::new();
        for s in &effective_sort {
            let val = match s.key {
                SortKey::Name => CursorVal::Str(last_item.name.clone()),
                SortKey::Margin => CursorVal::Int(last_item.margin_bp),
                SortKey::Velocity => CursorVal::Int(last_item.qty_30_milli),
                SortKey::Stock => CursorVal::Int(last_item.stock_milli),
                SortKey::Runout => CursorVal::Int(last_item.runout_days_x10),
                SortKey::Expiry => CursorVal::Int(last_item.earliest_expiry_day),
                SortKey::LastSold => CursorVal::Int(last_item.last_sold_day),
                SortKey::Received => CursorVal::Int(last_item.last_received_day),
                SortKey::Value => CursorVal::Int(last_item.stock_value_paise),
                SortKey::Gmroi => CursorVal::Int(last_item.gmroi_bp),
                SortKey::Revenue => CursorVal::Int(last_item.rev_90_paise),
            };
            sort_vals.push(val);
        }
        Some(encode_cursor(sort_vals, &last_item.id, spec_hash)?)
    } else {
        None
    };

    // Total capped query (without cursor condition)
    let (base_where_clauses, base_where_params) =
        build_base_where(conn, vertical, today, q, WhereFilterOptions::default())?;
    let total_sql = format!(
        "SELECT COUNT(*) FROM (
            SELECT 1 FROM product_stats s
            JOIN resources r ON r.id = s.resource_id
            WHERE {}
            LIMIT 10001
        )",
        base_where_clauses.join(" AND ")
    );

    let total_params: Vec<&dyn ToSql> = base_where_params.iter().map(|p| p as &dyn ToSql).collect();
    let total_capped: u64 = conn.query_row(&total_sql, total_params.as_slice(), |r| r.get(0))?;

    Ok(DiscoveryPage {
        items,
        next_cursor,
        total_capped,
    })
}
