use rusqlite::{params, Connection, Result};

/// Report of rows updated during rollup rebuild.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RebuildReport {
    pub sales_daily_rows: u64,
    pub sales_heat_rows: u64,
    pub product_stats_updated: u64,
}

/// Ensures a product_stats row exists for the given resource_id.
pub fn ensure_product_stats_exists(conn: &Connection, resource_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO product_stats (
            resource_id, vertical, is_active, brand_id, category_id, tax_bp,
            sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
            max_stock_milli, stock_value_paise, first_received_day, last_received_day,
            last_supplier_id, earliest_expiry_day, last_sold_day, qty_7_milli,
            qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10,
            gmroi_bp, abc_class, stats_day
         )
         SELECT
            r.id,
            'retail',
            r.is_active,
            r.brand_id,
            1,
            r.tax_rate_bps,
            r.base_price_paise,
            r.cost_price_paise,
            CASE WHEN r.base_price_paise > 0
                 THEN ((r.base_price_paise - r.cost_price_paise) * 10000) / r.base_price_paise
                 ELSE 0 END,
            0, 0, 0, 0, 0, 0, NULL, 99999999, 0, 0, 0, 0, 0, 0, 999999, 0, 3, 0
         FROM resources r
         WHERE r.id = ?1",
        params![resource_id],
    )?;
    Ok(())
}

/// Updates point fields on product_stats: stock_milli, stock_value_paise, and optionally last_sold_day.
pub fn update_product_stats_point_fields(
    conn: &Connection,
    resource_id: &str,
    last_sold: Option<i64>,
) -> Result<()> {
    match last_sold {
        Some(day) => {
            conn.execute(
                "UPDATE product_stats SET
                     stock_milli = COALESCE((
                         SELECT SUM(sm.quantity_delta_milli)
                         FROM stock_movements sm
                         WHERE sm.resource_id = ?1
                     ), 0),
                     stock_value_paise = (
                         COALESCE((
                             SELECT SUM(sm.quantity_delta_milli)
                             FROM stock_movements sm
                             WHERE sm.resource_id = ?1
                         ), 0) / 1000
                     ) * product_stats.avg_cost_paise,
                     last_sold_day = CASE WHEN ?2 > last_sold_day THEN ?2 ELSE last_sold_day END
                 WHERE resource_id = ?1",
                params![resource_id, day],
            )?;
        }
        None => {
            conn.execute(
                "UPDATE product_stats SET
                     stock_milli = COALESCE((
                         SELECT SUM(sm.quantity_delta_milli)
                         FROM stock_movements sm
                         WHERE sm.resource_id = ?1
                     ), 0),
                     stock_value_paise = (
                         COALESCE((
                             SELECT SUM(sm.quantity_delta_milli)
                             FROM stock_movements sm
                             WHERE sm.resource_id = ?1
                         ), 0) / 1000
                     ) * product_stats.avg_cost_paise
                 WHERE resource_id = ?1",
                params![resource_id],
            )?;
        }
    }
    Ok(())
}

/// Applies a single sale line to the daily rollup and product_stats.
pub fn apply_sale_line(
    conn: &Connection,
    resource_id: &str,
    day: i64,
    qty_milli: i64,
    net_paise: i64,
    cogs_paise: i64,
) -> Result<()> {
    // 1. Upsert sales_daily
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(resource_id, day) DO UPDATE SET
             qty_milli = qty_milli + excluded.qty_milli,
             net_paise = net_paise + excluded.net_paise,
             cogs_paise = cogs_paise + excluded.cogs_paise,
             bills = bills + excluded.bills",
        params![resource_id, day, qty_milli, net_paise, cogs_paise],
    )?;

    // 2. Ensure product_stats row exists for resource_id
    ensure_product_stats_exists(conn, resource_id)?;

    // 3. Update point fields on product_stats: stock_milli, stock_value_paise, last_sold_day
    update_product_stats_point_fields(conn, resource_id, Some(day))?;

    Ok(())
}

/// Records a sale bill into the hourly heatmap rollup once per bill.
pub fn apply_sale_heat(conn: &Connection, day: i64, hour: i64, net_paise: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO sales_heat (day, hour, bills, net_paise)
         VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(day, hour) DO UPDATE SET
             bills = bills + 1,
             net_paise = net_paise + excluded.net_paise",
        params![day, hour, net_paise],
    )?;
    Ok(())
}

/// Applies a sale return line to the daily rollup and product_stats.
pub fn apply_return_line(
    conn: &Connection,
    resource_id: &str,
    day: i64,
    qty_milli: i64,
    net_paise: i64,
    cogs_paise: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills)
         VALUES (?1, ?2, -?3, -?4, -?5, 0)
         ON CONFLICT(resource_id, day) DO UPDATE SET
             qty_milli = qty_milli + excluded.qty_milli,
             net_paise = net_paise + excluded.net_paise,
             cogs_paise = cogs_paise + excluded.cogs_paise",
        params![resource_id, day, qty_milli, net_paise, cogs_paise],
    )?;

    ensure_product_stats_exists(conn, resource_id)?;
    update_product_stats_point_fields(conn, resource_id, None)?;
    Ok(())
}

/// Applies reversal for invoice cancellation: decrements sales_daily, sales_heat, and updates product_stats.
pub fn apply_cancellation(conn: &Connection, transaction_id: &str) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT ti.resource_id, ti.business_day, ti.quantity_milli, ti.taxable_paise, ti.cogs_paise
         FROM transaction_items ti
         WHERE ti.transaction_id = ?1",
    )?;

    let items = stmt.query_map(params![transaction_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
        ))
    })?;

    let mut bill_taxable = 0i64;
    let mut b_day = 0i64;

    for item in items {
        let (res_id, day, qty, taxable, cogs) = item?;
        b_day = day;
        bill_taxable = bill_taxable.checked_add(taxable).unwrap_or(bill_taxable);

        conn.execute(
            "UPDATE sales_daily SET
                 qty_milli = qty_milli - ?1,
                 net_paise = net_paise - ?2,
                 cogs_paise = cogs_paise - ?3,
                 bills = bills - 1
             WHERE resource_id = ?4 AND day = ?5",
            params![qty, taxable, cogs, res_id, day],
        )?;

        update_product_stats_point_fields(conn, &res_id, None)?;
    }

    let hour: i64 = conn
        .query_row(
            "SELECT CAST(strftime('%H', datetime(created_at, '+330 minutes')) AS INTEGER) FROM transactions WHERE id = ?1",
            params![transaction_id],
            |r| r.get(0),
        )
        .unwrap_or_default();

    conn.execute(
        "UPDATE sales_heat SET
             bills = bills - 1,
             net_paise = net_paise - ?1
         WHERE day = ?2 AND hour = ?3",
        params![bill_taxable, b_day, hour],
    )?;

    Ok(())
}

/// Completely clears and repopulates sales_daily, sales_heat, and product_stats point fields
/// from immutable transaction records in a single transaction.
pub fn rebuild_rollups(conn: &Connection) -> Result<RebuildReport> {
    // 1. Clear derived rollup tables
    conn.execute("DELETE FROM sales_daily", [])?;
    conn.execute("DELETE FROM sales_heat", [])?;

    // 2. Repopulate sales_daily from POSTED sales and returns
    let sales_daily_rows = conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills)
         SELECT
             ti.resource_id,
             ti.business_day,
             SUM(CASE WHEN t.transaction_type = 'SALE' THEN ti.quantity_milli ELSE -ti.quantity_milli END),
             SUM(CASE WHEN t.transaction_type = 'SALE' THEN ti.taxable_paise ELSE -ti.taxable_paise END),
             SUM(CASE WHEN t.transaction_type = 'SALE' THEN ti.cogs_paise ELSE -ti.cogs_paise END),
             COUNT(DISTINCT CASE WHEN t.transaction_type = 'SALE' THEN t.id ELSE NULL END)
         FROM transaction_items ti
         JOIN transactions t ON ti.transaction_id = t.id
         WHERE t.status = 'POSTED' AND t.transaction_type IN ('SALE', 'SALE_RETURN')
         GROUP BY ti.resource_id, ti.business_day",
        [],
    )? as u64;

    // 3. Repopulate sales_heat from POSTED sales
    let sales_heat_rows = conn.execute(
        "INSERT INTO sales_heat (day, hour, bills, net_paise)
         SELECT
             ti.business_day,
             CAST(strftime('%H', datetime(t.created_at, '+330 minutes')) AS INTEGER),
             COUNT(DISTINCT CASE WHEN t.transaction_type = 'SALE' THEN t.id ELSE NULL END),
             SUM(CASE WHEN t.transaction_type = 'SALE' THEN ti.taxable_paise ELSE -ti.taxable_paise END)
         FROM transaction_items ti
         JOIN transactions t ON ti.transaction_id = t.id
         WHERE t.status = 'POSTED' AND t.transaction_type = 'SALE'
         GROUP BY ti.business_day, CAST(strftime('%H', datetime(t.created_at, '+330 minutes')) AS INTEGER)",
        [],
    )? as u64;

    // 4. Ensure all catalog resources exist in product_stats
    conn.execute(
        "INSERT OR IGNORE INTO product_stats (
            resource_id, vertical, is_active, brand_id, category_id, tax_bp,
            sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
            max_stock_milli, stock_value_paise, first_received_day, last_received_day,
            last_supplier_id, earliest_expiry_day, last_sold_day, qty_7_milli,
            qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10,
            gmroi_bp, abc_class, stats_day
         )
         SELECT
            r.id,
            'retail',
            r.is_active,
            r.brand_id,
            1,
            r.tax_rate_bps,
            r.base_price_paise,
            r.cost_price_paise,
            CASE WHEN r.base_price_paise > 0
                 THEN ((r.base_price_paise - r.cost_price_paise) * 10000) / r.base_price_paise
                 ELSE 0 END,
            0, 0, 0, 0, 0, 0, NULL, 99999999, 0, 0, 0, 0, 0, 0, 999999, 0, 3, 0
         FROM resources r",
        [],
    )?;

    // 5. Update point fields on product_stats from stock_movements and transaction_items
    let product_stats_updated = conn.execute(
        "UPDATE product_stats SET
             stock_milli = COALESCE((
                 SELECT SUM(sm.quantity_delta_milli)
                 FROM stock_movements sm
                 WHERE sm.resource_id = product_stats.resource_id
             ), 0),
             stock_value_paise = (
                 COALESCE((
                     SELECT SUM(sm.quantity_delta_milli)
                     FROM stock_movements sm
                     WHERE sm.resource_id = product_stats.resource_id
                 ), 0) / 1000
             ) * product_stats.avg_cost_paise,
             last_sold_day = COALESCE((
                 SELECT MAX(ti.business_day)
                 FROM transaction_items ti
                 JOIN transactions t ON ti.transaction_id = t.id
                 WHERE ti.resource_id = product_stats.resource_id
                   AND t.status = 'POSTED' AND t.transaction_type = 'SALE'
             ), 0)",
        [],
    )? as u64;

    Ok(RebuildReport {
        sales_daily_rows,
        sales_heat_rows,
        product_stats_updated,
    })
}
