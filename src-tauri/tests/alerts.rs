use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use omnibill_core::discovery::alerts::{
    acknowledge_alert, generate_alerts, list_alerts,
};
use rusqlite::Connection;

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    run_migrations(&mut conn, MIGRATIONS).unwrap();

    // Insert user
    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role) VALUES ('u1', 'admin', 'hash', 'Admin', 'ADMIN')",
        [],
    ).unwrap();

    // Resources:
    // r1: Expiry in 5 days (severity 3)
    // r2: Expiry in 12 days (severity 2)
    // r3: Expiry in 25 days (severity 1)
    // r4: Stockout in 2.0 days (runout_days_x10 = 20, severity 3)
    // r5: Stockout in 5.0 days (runout_days_x10 = 50, severity 2)
    // r6: Dead stock (last active day 800, today 1000, 200 days inactive, severity 2, is_critical = 0)
    // r7: Hospital critical drug (inactive 200 days, is_critical = 1 -> MUST BE EXCLUDED from dead stock)
    // r8: Below reorder (stock = 4000, reorder = 10000, severity 1)
    // r9: Normal item (no alerts)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical) VALUES
        ('r1', 'SKU1', 'Expiring Urgent', '3004', 500, 1000, 600, 1, 1, 0),
        ('r2', 'SKU2', 'Expiring Mid', '3004', 500, 1000, 600, 1, 1, 0),
        ('r3', 'SKU3', 'Expiring Low', '3004', 500, 1000, 600, 1, 1, 0),
        ('r4', 'SKU4', 'Stockout Danger', '0001', 1800, 2000, 1500, 1, 1, 0),
        ('r5', 'SKU5', 'Stockout Warning', '0001', 1800, 2000, 1500, 1, 1, 0),
        ('r6', 'SKU6', 'Dead Merchandise', '0002', 1800, 5000, 3000, 1, 1, 0),
        ('r7', 'SKU7', 'Critical Hospital ICU Drug', '3004', 500, 15000, 12000, 1, 1, 1),
        ('r8', 'SKU8', 'Reorder Restock', '0003', 1800, 1000, 700, 1, 1, 0),
        ('r9', 'SKU9', 'Normal Healthy Item', '0004', 1800, 1000, 700, 1, 1, 0)",
        [],
    ).unwrap();

    // Product stats (today = 1000)
    conn.execute(
        "INSERT INTO product_stats (
            resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, margin_bp,
            stock_milli, stock_value_paise, reorder_milli, max_stock_milli,
            first_received_day, last_received_day, earliest_expiry_day, last_sold_day,
            qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise,
            runout_days_x10, stats_day, category_id
        ) VALUES
        ('r1', 'pharma', 1, 500, 1000, 600, 4000, 5000, 3000, 0, 0, 900, 950, 1005, 990, 1000, 2000, 5000, 5000, 2000, 150, 1000, 1),
        ('r2', 'pharma', 1, 500, 1000, 600, 4000, 8000, 4800, 0, 0, 900, 950, 1012, 990, 1000, 2000, 5000, 5000, 2000, 150, 1000, 1),
        ('r3', 'pharma', 1, 500, 1000, 600, 4000, 10000, 6000, 0, 0, 900, 950, 1025, 990, 1000, 2000, 5000, 5000, 2000, 150, 1000, 1),
        ('r4', 'retail', 1, 1800, 2000, 1500, 2500, 2000, 3000, 0, 0, 900, 980, 99999999, 999, 5000, 15000, 30000, 60000, 15000, 20, 1000, 2),
        ('r5', 'retail', 1, 1800, 2000, 1500, 2500, 5000, 7500, 0, 0, 900, 980, 99999999, 999, 3000, 10000, 20000, 40000, 10000, 50, 1000, 2),
        ('r6', 'retail', 1, 1800, 5000, 3000, 4000, 12000, 36000, 0, 0, 700, 750, 99999999, 800, 0, 0, 0, 0, 0, 999999, 1000, 3),
        ('r7', 'hospital', 1, 500, 15000, 12000, 2000, 10000, 120000, 0, 0, 700, 750, 99999999, 800, 0, 0, 0, 0, 0, 999999, 1000, 4),
        ('r8', 'retail', 1, 1800, 1000, 700, 3000, 4000, 2800, 10000, 20000, 900, 950, 99999999, 998, 1000, 3000, 6000, 6000, 1800, 120, 1000, 5),
        ('r9', 'retail', 1, 1800, 1000, 700, 3000, 20000, 14000, 5000, 25000, 900, 950, 99999999, 999, 1000, 3000, 6000, 6000, 1800, 150, 1000, 5)",
        [],
    ).unwrap();

    conn
}

#[test]
fn test_generate_alerts_exact_counts_and_severities() {
    let conn = setup_test_db();
    let today = 1000;

    // 1. Pharma vertical alerts:
    let rep_pharma = generate_alerts(&conn, "pharma", today).unwrap();
    assert_eq!(rep_pharma.expiry_alerts, 3);
    assert_eq!(rep_pharma.stockout_alerts, 0);
    assert_eq!(rep_pharma.dead_alerts, 0);
    assert_eq!(rep_pharma.reorder_alerts, 0);
    assert_eq!(rep_pharma.total_generated, 3);

    // Verify severities of pharma alerts:
    let alerts = list_alerts(&conn, true).unwrap();
    let r1_alert = alerts.iter().find(|a| a.resource_id == "r1").unwrap();
    assert_eq!(r1_alert.severity, 3); // 5 days left <= 7
    assert_eq!(r1_alert.kind, "expiry");
    assert_eq!(r1_alert.value_paise, 3000);

    let r2_alert = alerts.iter().find(|a| a.resource_id == "r2").unwrap();
    assert_eq!(r2_alert.severity, 2); // 12 days left <= 15
    assert_eq!(r2_alert.kind, "expiry");
    assert_eq!(r2_alert.value_paise, 4800);

    let r3_alert = alerts.iter().find(|a| a.resource_id == "r3").unwrap();
    assert_eq!(r3_alert.severity, 1); // 25 days left <= 30
    assert_eq!(r3_alert.kind, "expiry");
    assert_eq!(r3_alert.value_paise, 6000);

    // 2. Retail vertical alerts:
    let rep_retail = generate_alerts(&conn, "retail", today).unwrap();
    assert_eq!(rep_retail.expiry_alerts, 0);
    assert_eq!(rep_retail.stockout_alerts, 2); // r4 (< 30) and r5 (< 70)
    assert_eq!(rep_retail.dead_alerts, 1);     // r6 (inactive 200 days >= 90)
    assert_eq!(rep_retail.reorder_alerts, 1);  // r8 (stock 4000 <= reorder 10000)
    assert_eq!(rep_retail.total_generated, 4);

    let all_alerts = list_alerts(&conn, true).unwrap();
    let r4_alert = all_alerts.iter().find(|a| a.resource_id == "r4" && a.kind == "stockout").unwrap();
    assert_eq!(r4_alert.severity, 3); // runout_days_x10 = 20 < 30

    let r5_alert = all_alerts.iter().find(|a| a.resource_id == "r5" && a.kind == "stockout").unwrap();
    assert_eq!(r5_alert.severity, 2); // runout_days_x10 = 50 < 70

    let r6_alert = all_alerts.iter().find(|a| a.resource_id == "r6" && a.kind == "dead").unwrap();
    assert_eq!(r6_alert.severity, 2);
    assert_eq!(r6_alert.value_paise, 36000);

    let r8_alert = all_alerts.iter().find(|a| a.resource_id == "r8" && a.kind == "below_reorder").unwrap();
    assert_eq!(r8_alert.severity, 1);
}

#[test]
fn test_alerts_idempotency() {
    let conn = setup_test_db();
    let today = 1000;

    let rep1 = generate_alerts(&conn, "retail", today).unwrap();
    assert_eq!(rep1.total_generated, 4);

    // Running a second time for the exact same day:
    let rep2 = generate_alerts(&conn, "retail", today).unwrap();
    assert_eq!(rep2.total_generated, 0); // All 4 conflict on (day, kind, resource_id) -> DO NOTHING

    // Total rows in alerts table remains exactly 4:
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM alerts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 4);
}

#[test]
fn test_critical_drug_dead_stock_exclusion() {
    let conn = setup_test_db();
    let today = 1000;

    // r7 has positive stock (10000 milli) and inactive for 200 days,
    // but r7 is marked is_critical = 1 (ICU Antidote).
    let rep_hospital = generate_alerts(&conn, "hospital", today).unwrap();
    assert_eq!(rep_hospital.dead_alerts, 0);

    // Verify no dead stock alert exists for r7:
    let r7_dead: Option<i64> = conn
        .query_row(
            "SELECT id FROM alerts WHERE resource_id = 'r7' AND kind = 'dead'",
            [],
            |row| row.get(0),
        )
        .ok();
    assert_eq!(r7_dead, None);
}

#[test]
fn test_acknowledge_alert() {
    let conn = setup_test_db();
    let today = 1000;

    generate_alerts(&conn, "retail", today).unwrap();

    let unacked_before = list_alerts(&conn, false).unwrap();
    assert_eq!(unacked_before.len(), 4);

    let first_id = unacked_before[0].id;
    acknowledge_alert(&conn, first_id, today).unwrap();

    // With include_acknowledged = false, count drops to 3:
    let unacked_after = list_alerts(&conn, false).unwrap();
    assert_eq!(unacked_after.len(), 3);
    assert!(!unacked_after.iter().any(|a| a.id == first_id));

    // With include_acknowledged = true, all 4 are returned:
    let all = list_alerts(&conn, true).unwrap();
    assert_eq!(all.len(), 4);
    let acked_item = all.iter().find(|a| a.id == first_id).unwrap();
    assert_eq!(acked_item.acknowledged_day, Some(today));
}
