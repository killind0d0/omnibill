//! Inventory Risk & Day-Close Alerts Module
//!
//! Generates and tracks alerts for expiry, stockout danger, dead stock, and reorder levels.
//! All math is float-free integer arithmetic.

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertItem {
    pub id: i64,
    pub day: i64,
    pub kind: String,
    pub resource_id: String,
    pub resource_name: String,
    pub severity: u8,
    pub value_paise: i64,
    pub detail: String,
    pub acknowledged_day: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAlertsReport {
    pub expiry_alerts: u64,
    pub stockout_alerts: u64,
    pub dead_alerts: u64,
    pub reorder_alerts: u64,
    pub total_generated: u64,
}

/// Generates alerts for the specified business day and vertical.
/// Idempotent via UNIQUE(day, kind, resource_id) and ON CONFLICT DO NOTHING.
pub fn generate_alerts(
    conn: &Connection,
    vertical: &str,
    today: i64,
) -> Result<GenerateAlertsReport> {
    let mut stmt = conn.prepare(
        "SELECT
            s.resource_id,
            r.name,
            s.stock_milli,
            s.stock_value_paise,
            s.reorder_milli,
            s.earliest_expiry_day,
            s.last_sold_day,
            s.last_received_day,
            s.runout_days_x10,
            r.is_critical
         FROM product_stats s
         JOIN resources r ON r.id = s.resource_id
         WHERE s.vertical = ?1 AND s.is_active = 1",
    )?;

    let mut rows = stmt.query(params![vertical])?;

    let mut insert_stmt = conn.prepare(
        "INSERT INTO alerts (day, kind, resource_id, severity, value_paise, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(day, kind, resource_id) DO NOTHING",
    )?;

    let mut expiry_count = 0u64;
    let mut stockout_count = 0u64;
    let mut dead_count = 0u64;
    let mut reorder_count = 0u64;

    while let Some(row) = rows.next()? {
        let resource_id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let stock_milli: i64 = row.get(2)?;
        let stock_value_paise: i64 = row.get(3)?;
        let reorder_milli: i64 = row.get(4)?;
        let earliest_expiry_day: i64 = row.get(5)?;
        let last_sold_day: i64 = row.get(6)?;
        let last_received_day: i64 = row.get(7)?;
        let runout_days_x10: i64 = row.get(8)?;
        let is_critical = row.get::<_, i64>(9)? != 0;

        // 1. Expiry Alert: stock > 0 AND earliest_expiry_day <= today + 30
        if stock_milli > 0 && earliest_expiry_day <= today + 30 {
            let days_left = earliest_expiry_day.saturating_sub(today);
            let severity: u8 = if days_left <= 7 {
                3
            } else if days_left <= 15 {
                2
            } else {
                1
            };
            let detail = format!(
                "{} expires in {} days (stock: {} units, value: ₹{}.{:02})",
                name,
                days_left,
                stock_milli / 1000,
                stock_value_paise / 100,
                (stock_value_paise % 100).abs()
            );

            let affected = insert_stmt.execute(params![
                today,
                "expiry",
                resource_id,
                severity,
                stock_value_paise,
                detail
            ])?;
            if affected > 0 {
                expiry_count += 1;
            }
        }

        // 2. Stockout Alert: runout_days_x10 < 70 AND runout_days_x10 >= 0 (excluding sentinel 999999)
        if stock_milli > 0 && (0..70).contains(&runout_days_x10) {
            let severity: u8 = if runout_days_x10 < 30 { 3 } else { 2 };
            let runout_whole = runout_days_x10 / 10;
            let runout_frac = runout_days_x10 % 10;
            let detail = format!(
                "{} estimated stockout in {}.{} days (stock: {} units)",
                name,
                runout_whole,
                runout_frac,
                stock_milli / 1000
            );

            let affected = insert_stmt.execute(params![
                today,
                "stockout",
                resource_id,
                severity,
                stock_value_paise,
                detail
            ])?;
            if affected > 0 {
                stockout_count += 1;
            }
        }

        // 3. Dead Stock Alert: stock > 0 AND inactive >= 90 days, skip is_critical
        if !is_critical
            && crate::discovery::math::is_dead(
                stock_milli,
                last_sold_day,
                last_received_day,
                today,
                90,
            )
        {
            let inactive_days = today.saturating_sub(last_sold_day.max(last_received_day));
            let detail = format!(
                "{} inactive for {} days with locked capital of ₹{}.{:02}",
                name,
                inactive_days,
                stock_value_paise / 100,
                (stock_value_paise % 100).abs()
            );

            let affected = insert_stmt.execute(params![
                today,
                "dead",
                resource_id,
                2u8,
                stock_value_paise,
                detail
            ])?;
            if affected > 0 {
                dead_count += 1;
            }
        }

        // 4. Below Reorder Alert: stock_milli > 0 AND stock_milli <= reorder_milli
        if stock_milli > 0 && reorder_milli > 0 && stock_milli <= reorder_milli {
            let detail = format!(
                "{} stock ({} units) is at or below reorder threshold ({} units)",
                name,
                stock_milli / 1000,
                reorder_milli / 1000
            );

            let affected = insert_stmt.execute(params![
                today,
                "below_reorder",
                resource_id,
                1u8,
                stock_value_paise,
                detail
            ])?;
            if affected > 0 {
                reorder_count += 1;
            }
        }
    }

    Ok(GenerateAlertsReport {
        expiry_alerts: expiry_count,
        stockout_alerts: stockout_count,
        dead_alerts: dead_count,
        reorder_alerts: reorder_count,
        total_generated: expiry_count + stockout_count + dead_count + reorder_count,
    })
}

/// Lists alerts with optional filter for acknowledged alerts.
pub fn list_alerts(conn: &Connection, include_acknowledged: bool) -> Result<Vec<AlertItem>> {
    let mut stmt = conn.prepare(
        "SELECT
            a.id,
            a.day,
            a.kind,
            a.resource_id,
            COALESCE(r.name, a.resource_id) AS resource_name,
            a.severity,
            a.value_paise,
            a.detail,
            a.acknowledged_day
         FROM alerts a
         LEFT JOIN resources r ON r.id = a.resource_id
         WHERE (?1 = 1 OR a.acknowledged_day IS NULL)
         ORDER BY a.severity DESC, a.value_paise DESC, a.id DESC",
    )?;

    let rows = stmt.query_map(params![if include_acknowledged { 1 } else { 0 }], |row| {
        Ok(AlertItem {
            id: row.get(0)?,
            day: row.get(1)?,
            kind: row.get(2)?,
            resource_id: row.get(3)?,
            resource_name: row.get(4)?,
            severity: row.get(5)?,
            value_paise: row.get(6)?,
            detail: row.get(7)?,
            acknowledged_day: row.get(8)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

/// Marks an alert as acknowledged for the given business day.
/// Touches ONLY the alerts table.
pub fn acknowledge_alert(conn: &Connection, alert_id: i64, today: i64) -> Result<()> {
    conn.execute(
        "UPDATE alerts SET acknowledged_day = ?1 WHERE id = ?2",
        params![today, alert_id],
    )?;
    Ok(())
}
