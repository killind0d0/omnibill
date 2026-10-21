use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

/// Computes (year, month) for a given day offset from 1970-01-01 (day 0).
/// Uses Howard Hinnant's integer civil-from-days algorithm.
pub fn month_of_day(day: i64) -> (i64, u8) {
    let z = day + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y_final = if m <= 2 { y + 1 } else { y };
    (y_final, m as u8)
}

/// Computes weekday index (0..=6) where 0 = Sunday, 4 = Thursday (day 0: 1970-01-01).
pub fn weekday_of_day(day: i64) -> usize {
    (day + 4).rem_euclid(7) as usize
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MetricBy {
    Qty,
    Revenue,
    GrossProfit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopMoverItem {
    pub resource_id: String,
    pub name: String,
    pub qty_milli: i64,
    pub rev_paise: i64,
    pub gp_paise: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowMoverItem {
    pub resource_id: String,
    pub name: String,
    pub stock_milli: i64,
    pub stock_value_paise: i64,
    pub qty_milli: i64,
    pub rev_paise: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadStockItem {
    pub resource_id: String,
    pub name: String,
    pub stock_milli: i64,
    pub stock_value_paise: i64,
    pub last_sold_day: i64,
    pub last_received_day: i64,
    pub inactive_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginVelocityPoint {
    pub resource_id: String,
    pub name: String,
    pub margin_bp: i64,
    pub qty_30_milli: i64,
    pub rev_90_paise: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrendBucket {
    Day,
    Week,
    Month,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTrendPoint {
    pub category_id: i64,
    pub bucket_key: String,
    pub rev_paise: i64,
    pub qty_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub weekday: u8,
    pub hour: u8,
    pub bills: u64,
    pub net_paise: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockoutItem {
    pub resource_id: String,
    pub name: String,
    pub stock_milli: i64,
    pub runout_days_x10: i64,
    pub qty_30_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpiryRiskItem {
    pub resource_id: String,
    pub name: String,
    pub stock_milli: i64,
    pub stock_value_paise: i64,
    pub earliest_expiry_day: i64,
    pub at_risk_milli: i64,
    pub at_risk_value_paise: i64,
    pub is_critical: bool,
}

/// Retrieves top selling products ordered by quantity, revenue, or gross profit.
pub fn top_movers(
    conn: &Connection,
    vertical: &str,
    today: i64,
    window_days: i64,
    limit: u32,
    by: MetricBy,
) -> Result<Vec<TopMoverItem>> {
    let bounded_limit = limit.clamp(1, 100);
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            COALESCE(SUM(sd.qty_milli), 0) AS total_qty,
            COALESCE(SUM(sd.net_paise), 0) AS total_rev,
            COALESCE(SUM(sd.net_paise - sd.cogs_paise), 0) AS total_gp
         FROM sales_daily sd
         JOIN product_stats s ON s.resource_id = sd.resource_id
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1
           AND sd.day > ?2 - ?3 AND sd.day <= ?2
         GROUP BY s.resource_id, r.name
         ORDER BY (CASE ?4
             WHEN 'Qty' THEN total_qty
             WHEN 'Revenue' THEN total_rev
             ELSE total_gp END) DESC, s.resource_id DESC
         LIMIT ?5",
    )?;

    let by_str = match by {
        MetricBy::Qty => "Qty",
        MetricBy::Revenue => "Revenue",
        MetricBy::GrossProfit => "GrossProfit",
    };

    let rows = stmt.query_map(
        params![vertical, today, window_days, by_str, bounded_limit],
        |row| {
            Ok(TopMoverItem {
                resource_id: row.get(0)?,
                name: row.get(1)?,
                qty_milli: row.get(2)?,
                rev_paise: row.get(3)?,
                gp_paise: row.get(4)?,
            })
        },
    )?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Retrieves slow moving items with positive stock ordered by lowest velocity.
pub fn slow_movers(
    conn: &Connection,
    vertical: &str,
    today: i64,
    window_days: i64,
    limit: u32,
) -> Result<Vec<SlowMoverItem>> {
    let bounded_limit = limit.clamp(1, 100);
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.stock_milli,
            s.stock_value_paise,
            COALESCE(SUM(sd.qty_milli), 0) AS total_qty,
            COALESCE(SUM(sd.net_paise), 0) AS total_rev
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         LEFT JOIN sales_daily sd ON sd.resource_id = s.resource_id
                                AND sd.day > ?2 - ?3 AND sd.day <= ?2
         WHERE s.vertical = ?1 AND s.is_active = 1 AND s.stock_milli > 0
         GROUP BY s.resource_id, r.name, s.stock_milli, s.stock_value_paise
         ORDER BY total_qty ASC, s.stock_value_paise DESC, s.resource_id DESC
         LIMIT ?4",
    )?;

    let rows = stmt.query_map(
        params![vertical, today, window_days, bounded_limit],
        |row| {
            Ok(SlowMoverItem {
                resource_id: row.get(0)?,
                name: row.get(1)?,
                stock_milli: row.get(2)?,
                stock_value_paise: row.get(3)?,
                qty_milli: row.get(4)?,
                rev_paise: row.get(5)?,
            })
        },
    )?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Retrieves dead stock items exceeding inactive threshold.
/// Excludes critical medicines if vertical is hospital.
pub fn dead_stock(
    conn: &Connection,
    vertical: &str,
    today: i64,
    threshold_days: i64,
    limit: u32,
) -> Result<Vec<DeadStockItem>> {
    let bounded_limit = limit.clamp(1, 200);
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.stock_milli,
            s.stock_value_paise,
            s.last_sold_day,
            s.last_received_day,
            (?2 - MAX(s.last_sold_day, s.last_received_day)) AS inactive_days
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1 AND s.stock_milli > 0
           AND (?2 - MAX(s.last_sold_day, s.last_received_day)) >= ?3
           AND (CASE WHEN ?1 = 'hospital' THEN r.is_critical = 0 ELSE 1 END)
         ORDER BY s.stock_value_paise DESC, s.resource_id DESC
         LIMIT ?4",
    )?;

    let rows = stmt.query_map(
        params![vertical, today, threshold_days, bounded_limit],
        |row| {
            Ok(DeadStockItem {
                resource_id: row.get(0)?,
                name: row.get(1)?,
                stock_milli: row.get(2)?,
                stock_value_paise: row.get(3)?,
                last_sold_day: row.get(4)?,
                last_received_day: row.get(5)?,
                inactive_days: row.get(6)?,
            })
        },
    )?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Retrieves margin versus velocity scatter data points, ordered by revenue.
pub fn margin_vs_velocity(
    conn: &Connection,
    vertical: &str,
    limit: u32,
) -> Result<Vec<MarginVelocityPoint>> {
    let bounded_limit = limit.clamp(1, 2000);
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.margin_bp,
            s.qty_30_milli,
            s.rev_90_paise
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1
         ORDER BY s.rev_90_paise DESC, s.resource_id DESC
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![vertical, bounded_limit], |row| {
        Ok(MarginVelocityPoint {
            resource_id: row.get(0)?,
            name: row.get(1)?,
            margin_bp: row.get(2)?,
            qty_30_milli: row.get(3)?,
            rev_90_paise: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Retrieves category sales trend bucketed by Day, Week, or Month.
pub fn category_trend(
    conn: &Connection,
    vertical: &str,
    from_day: i64,
    to_day: i64,
    bucket: TrendBucket,
) -> Result<Vec<CategoryTrendPoint>> {
    let mut stmt = conn.prepare(
        "SELECT
            sd.day,
            s.category_id,
            SUM(sd.net_paise),
            SUM(sd.qty_milli)
         FROM sales_daily sd
         JOIN product_stats s ON s.resource_id = sd.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1
           AND sd.day >= ?2 AND sd.day <= ?3
         GROUP BY sd.day, s.category_id
         ORDER BY sd.day ASC, s.category_id ASC",
    )?;

    let mut map: std::collections::BTreeMap<(i64, i64, String), (i64, i64)> =
        std::collections::BTreeMap::new();

    let mut rows = stmt.query(params![vertical, from_day, to_day])?;
    while let Some(row) = rows.next()? {
        let day: i64 = row.get(0)?;
        let cat_id: i64 = row.get(1)?;
        let rev: i64 = row.get(2)?;
        let qty: i64 = row.get(3)?;

        let (sort_order, bucket_key) = match bucket {
            TrendBucket::Day => (day, day.to_string()),
            TrendBucket::Week => (day / 7, format!("W{}", day / 7)),
            TrendBucket::Month => {
                let (y, m) = month_of_day(day);
                (y * 100 + m as i64, format!("{:04}-{:02}", y, m))
            }
        };

        let entry = map
            .entry((cat_id, sort_order, bucket_key))
            .or_insert((0, 0));
        entry.0 += rev;
        entry.1 += qty;
    }

    let mut result = Vec::new();
    for ((category_id, _sort_order, bucket_key), (rev_paise, qty_milli)) in map {
        result.push(CategoryTrendPoint {
            category_id,
            bucket_key,
            rev_paise,
            qty_milli,
        });
    }
    Ok(result)
}

/// Retrieves 7x24 hourly heatmap cells across days of week (0=Sun..6=Sat).
pub fn hourly_heatmap(conn: &Connection, from_day: i64, to_day: i64) -> Result<Vec<HeatmapCell>> {
    let mut stmt = conn.prepare(
        "SELECT
            day,
            hour,
            COALESCE(SUM(bills), 0),
            COALESCE(SUM(net_paise), 0)
         FROM sales_heat
         WHERE day >= ?1 AND day <= ?2
         GROUP BY day, hour",
    )?;

    let mut matrix = vec![vec![(0u64, 0i64); 24]; 7];
    let mut rows = stmt.query(params![from_day, to_day])?;
    while let Some(row) = rows.next()? {
        let day: i64 = row.get(0)?;
        let hour: i64 = row.get(1)?;
        let bills: i64 = row.get(2)?;
        let net_paise: i64 = row.get(3)?;

        let wd = weekday_of_day(day);
        let h = hour.clamp(0, 23) as usize;
        matrix[wd][h].0 += bills as u64;
        matrix[wd][h].1 += net_paise;
    }

    let mut result = Vec::with_capacity(7 * 24);
    for (wd, day_hours) in matrix.iter().enumerate().take(7) {
        for (h, &(bills, net_paise)) in day_hours.iter().enumerate().take(24) {
            result.push(HeatmapCell {
                weekday: wd as u8,
                hour: h as u8,
                bills,
                net_paise,
            });
        }
    }
    Ok(result)
}

/// Retrieves stockout forecast ordered by runout days ascending.
pub fn stockout_forecast(
    conn: &Connection,
    vertical: &str,
    limit: u32,
) -> Result<Vec<StockoutItem>> {
    let bounded_limit = limit.clamp(1, 100);
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.stock_milli,
            s.runout_days_x10,
            s.qty_30_milli
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1
           AND s.stock_milli > 0 AND s.runout_days_x10 < 999999
         ORDER BY s.runout_days_x10 ASC, s.stock_milli ASC, s.resource_id DESC
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![vertical, bounded_limit], |row| {
        Ok(StockoutItem {
            resource_id: row.get(0)?,
            name: row.get(1)?,
            stock_milli: row.get(2)?,
            runout_days_x10: row.get(3)?,
            qty_30_milli: row.get(4)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Retrieves expiry risk items calculating excess unsold stock milli-units.
pub fn expiry_risk(conn: &Connection, vertical: &str, today: i64) -> Result<Vec<ExpiryRiskItem>> {
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.stock_milli,
            s.stock_value_paise,
            s.earliest_expiry_day,
            s.qty_30_milli,
            r.cost_price_paise,
            r.is_critical
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1
           AND s.stock_milli > 0 AND s.earliest_expiry_day <= ?2 + 90
         ORDER BY s.earliest_expiry_day ASC, s.stock_value_paise DESC
         LIMIT 200",
    )?;

    let mut rows = stmt.query(params![vertical, today])?;
    let mut result = Vec::new();

    while let Some(row) = rows.next()? {
        let res_id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let stock_milli: i64 = row.get(2)?;
        let stock_value_paise: i64 = row.get(3)?;
        let earliest_expiry_day: i64 = row.get(4)?;
        let qty_30_milli: i64 = row.get(5)?;
        let cost_price_paise: i64 = row.get(6)?;
        let is_critical = row.get::<_, i64>(7)? != 0;

        let days_to_expiry = earliest_expiry_day.saturating_sub(today);
        let at_risk = match crate::discovery::math::at_risk_milli(
            stock_milli,
            qty_30_milli,
            30,
            days_to_expiry,
        ) {
            Ok(v) => v,
            Err(_) => stock_milli,
        };

        let at_risk_val =
            crate::discovery::math::lot_value_paise(at_risk, cost_price_paise).unwrap_or_default();

        result.push(ExpiryRiskItem {
            resource_id: res_id,
            name,
            stock_milli,
            stock_value_paise,
            earliest_expiry_day,
            at_risk_milli: at_risk,
            at_risk_value_paise: at_risk_val,
            is_critical,
        });
    }

    Ok(result)
}

/// Calculates median gap in days between customer invoice business_days using LAG.
/// Returns None if customer made fewer than 3 purchases.
pub fn wholesale_reorder_interval(
    conn: &Connection,
    customer_id: &str,
    resource_id: &str,
) -> Result<Option<i64>> {
    let mut stmt = conn.prepare(
        "WITH invoice_days AS (
            SELECT DISTINCT ti.business_day
            FROM transactions t
            JOIN transaction_items ti ON ti.transaction_id = t.id
            WHERE t.status = 'POSTED' AND t.transaction_type = 'SALE'
              AND t.entity_id = ?1 AND ti.resource_id = ?2
            ORDER BY ti.business_day ASC
         ),
         gaps AS (
            SELECT business_day - LAG(business_day) OVER (ORDER BY business_day) AS gap
            FROM invoice_days
         )
         SELECT gap FROM gaps WHERE gap IS NOT NULL ORDER BY gap ASC",
    )?;

    let rows = stmt.query_map(params![customer_id, resource_id], |row| {
        row.get::<_, i64>(0)
    })?;
    let mut gaps = Vec::new();
    for r in rows {
        gaps.push(r?);
    }

    // Must have at least 2 gaps (corresponding to at least 3 purchases)
    if gaps.len() < 2 {
        return Ok(None);
    }

    let n = gaps.len();
    let median = if n % 2 == 1 {
        gaps[n / 2]
    } else {
        (gaps[n / 2 - 1] + gaps[n / 2]) / 2
    };

    Ok(Some(median))
}
