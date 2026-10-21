use rusqlite::{named_params, params, Connection};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshReport {
    pub resources_updated: u64,
    pub gmroi_skipped: u64,
    pub inventory_snapshots_written: u64,
}

struct SalesWindowAgg {
    q7: i64,
    q30: i64,
    q90: i64,
    gp90: i64,
}

/// Refreshes windowed product statistics and snapshots daily inventory.
///
/// Steps:
/// 1. Ensures all active resources have product_stats entries.
/// 2. Takes inventory_daily snapshot for resources with stock > 0.
/// 3. Computes 90-day ABC classification via window query.
/// 4. Aggregates 7/30/90-day sales windows from sales_daily.
/// 5. Computes stocked_out_days and 90-day average inventory from inventory_daily.
/// 6. Updates runout, margin, GMROI, and ABC class on product_stats.
///
/// Fully idempotent: running multiple times for the same `today` produces identical tables.
#[allow(clippy::manual_unwrap_or_default, clippy::manual_unwrap_or)]
pub fn refresh_stats(conn: &mut Connection, today: i64) -> Result<RefreshReport, rusqlite::Error> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    // 1. Ensure all active resources exist in product_stats
    tx.execute(
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
         WHERE r.is_active = 1",
        [],
    )?;

    // 2. Write today's inventory_daily snapshot rows for all resources with stock
    tx.execute(
        "INSERT INTO inventory_daily (resource_id, day, stock_milli, value_paise)
         SELECT resource_id, ?1, stock_milli, stock_value_paise
         FROM product_stats
         WHERE stock_milli > 0
         ON CONFLICT(resource_id, day) DO UPDATE SET
             stock_milli = excluded.stock_milli,
             value_paise = excluded.value_paise",
        params![today],
    )?;

    let inventory_snapshots_written: i64 = tx.query_row(
        "SELECT COUNT(*) FROM inventory_daily WHERE day = ?1",
        params![today],
        |r| r.get(0),
    )?;

    // 3. ABC window query (verbatim from task specification)
    let mut abc_map = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare(
            "WITH ranked AS (
               SELECT resource_id, rev,
                      SUM(rev) OVER (ORDER BY rev DESC, resource_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS cum_before,
                      SUM(rev) OVER () AS total
               FROM (SELECT resource_id, SUM(net_paise) AS rev FROM sales_daily
                     WHERE day > :d0 AND day <= :today GROUP BY resource_id HAVING rev > 0)
             )
             SELECT resource_id, COALESCE(cum_before,0) AS cum_before, total FROM ranked;",
        )?;
        let mut rows = stmt.query(named_params! { ":d0": today - 90, ":today": today })?;
        while let Some(row) = rows.next()? {
            let res_id: String = row.get(0)?;
            let cum_before: i64 = row.get(1)?;
            let total: i64 = row.get(2)?;
            let class = crate::discovery::math::abc_class(cum_before, total);
            abc_map.insert(res_id, class);
        }
    }

    // 4. Sales window aggregates from sales_daily
    let mut sales_map = std::collections::HashMap::new();
    {
        let d7 = today - 7;
        let d30 = today - 30;
        let d90 = today - 90;
        let mut stmt = tx.prepare(
            "SELECT
                resource_id,
                COALESCE(SUM(CASE WHEN day > ?1 THEN qty_milli ELSE 0 END), 0) AS q7,
                COALESCE(SUM(CASE WHEN day > ?2 THEN qty_milli ELSE 0 END), 0) AS q30,
                COALESCE(SUM(qty_milli), 0) AS q90,
                COALESCE(SUM(net_paise), 0) AS rev90,
                COALESCE(SUM(net_paise - cogs_paise), 0) AS gp90
             FROM sales_daily
             WHERE day > ?3 AND day <= ?4
             GROUP BY resource_id",
        )?;
        let mut rows = stmt.query(params![d7, d30, d90, today])?;
        while let Some(row) = rows.next()? {
            let res_id: String = row.get(0)?;
            let q7: i64 = row.get(1)?;
            let q30: i64 = row.get(2)?;
            let q90: i64 = row.get(3)?;
            let rev90: i64 = row.get(4)?;
            let gp90: i64 = row.get(5)?;
            sales_map.insert(res_id, (SalesWindowAgg { q7, q30, q90, gp90 }, rev90));
        }
    }

    // 5. Stocked-out days from inventory_daily
    let mut stocked_out_map = std::collections::HashMap::new();
    {
        let d30 = today - 30;
        let mut stmt = tx.prepare(
            "SELECT resource_id, COUNT(*)
             FROM inventory_daily
             WHERE day > ?1 AND day <= ?2 AND stock_milli = 0
             GROUP BY resource_id",
        )?;
        let mut rows = stmt.query(params![d30, today])?;
        while let Some(row) = rows.next()? {
            let res_id: String = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            stocked_out_map.insert(res_id, cnt);
        }
    }

    // 6. GMROI 90-day inventory value and snapshot counts from inventory_daily
    let mut inv_map = std::collections::HashMap::new();
    {
        let d90 = today - 90;
        let mut stmt = tx.prepare(
            "SELECT resource_id, COUNT(*), COALESCE(SUM(value_paise), 0)
             FROM inventory_daily
             WHERE day > ?1 AND day <= ?2
             GROUP BY resource_id",
        )?;
        let mut rows = stmt.query(params![d90, today])?;
        while let Some(row) = rows.next()? {
            let res_id: String = row.get(0)?;
            let cnt: i64 = row.get(1)?;
            let total_val: i64 = row.get(2)?;
            inv_map.insert(res_id, (cnt, total_val));
        }
    }

    // 7. Iterate over active resources and update product_stats
    let mut resources_to_update = Vec::new();
    {
        let mut stmt = tx.prepare(
            "SELECT resource_id, sell_paise, avg_cost_paise, stock_milli
             FROM product_stats
             WHERE is_active = 1",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let res_id: String = row.get(0)?;
            let sell_paise: i64 = row.get(1)?;
            let avg_cost_paise: i64 = row.get(2)?;
            let stock_milli: i64 = row.get(3)?;
            resources_to_update.push((res_id, sell_paise, avg_cost_paise, stock_milli));
        }
    }

    let mut resources_updated = 0u64;
    let mut gmroi_skipped = 0u64;

    let mut update_stmt = tx.prepare(
        "UPDATE product_stats SET
            qty_7_milli = ?2,
            qty_30_milli = ?3,
            qty_90_milli = ?4,
            rev_90_paise = ?5,
            gp_90_paise = ?6,
            runout_days_x10 = ?7,
            margin_bp = ?8,
            gmroi_bp = ?9,
            abc_class = ?10,
            stats_day = ?11
         WHERE resource_id = ?1",
    )?;

    for (res_id, sell_paise, avg_cost_paise, stock_milli) in resources_to_update {
        let (q7, q30, q90, rev90, gp90) = match sales_map.get(&res_id) {
            Some((sales, rev)) => (sales.q7, sales.q30, sales.q90, *rev, sales.gp90),
            None => (0, 0, 0, 0, 0),
        };

        let stocked_out_days = match stocked_out_map.get(&res_id) {
            Some(&cnt) => cnt,
            None => 0,
        };

        let eff_days = crate::discovery::math::effective_days(30, stocked_out_days);

        let runout_days_x10 =
            match crate::discovery::math::runout_days_x10(stock_milli, q30, eff_days) {
                Ok(r) => r,
                Err(_) => crate::discovery::math::SENTINEL_RUNOUT_DAYS_X10,
            };

        let margin_bp = if let Ok(m) = crate::discovery::math::margin_bp(sell_paise, avg_cost_paise)
        {
            m
        } else {
            0
        };

        let (gmroi_bp, is_skipped) = match inv_map.get(&res_id) {
            Some(&(cnt, total_val)) => {
                if cnt < 7 {
                    (0, true)
                } else {
                    match crate::discovery::math::div_round_half_up(total_val as i128, cnt as i128)
                    {
                        Ok(avg_inv) => match crate::discovery::math::gmroi_bp(gp90, avg_inv) {
                            Ok(g) => (g, false),
                            Err(_) => (0, true),
                        },
                        Err(_) => (0, true),
                    }
                }
            }
            None => (0, true),
        };

        if is_skipped {
            gmroi_skipped += 1;
        }

        let abc_class = match abc_map.get(&res_id) {
            Some(&c) => c,
            None => 3,
        };

        update_stmt.execute(params![
            &res_id,
            q7,
            q30,
            q90,
            rev90,
            gp90,
            runout_days_x10,
            margin_bp,
            gmroi_bp,
            abc_class as i64,
            today,
        ])?;

        resources_updated += 1;
    }

    drop(update_stmt);
    tx.commit()?;

    Ok(RefreshReport {
        resources_updated,
        gmroi_skipped,
        inventory_snapshots_written: inventory_snapshots_written as u64,
    })
}
