use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use omnibill_core::discovery::graph::{
    MetricBy, TrendBucket, category_trend, dead_stock, expiry_risk, hourly_heatmap,
    margin_vs_velocity, month_of_day, slow_movers, stockout_forecast, top_movers, weekday_of_day,
    wholesale_reorder_interval,
};
use rusqlite::Connection;

#[test]
fn test_category_trend() {
    let conn = setup_fixture_db();

    // In setup_fixture_db:
    // r1 category_id = 1
    // Day 999: net_paise = 20000, qty_milli = 4000
    // Day 1000: net_paise = 30000, qty_milli = 6000
    let trend_day = category_trend(&conn, "retail", 999, 1000, TrendBucket::Day).unwrap();
    assert_eq!(trend_day.len(), 2);
    assert_eq!(trend_day[0].bucket_key, "999");
    assert_eq!(trend_day[0].rev_paise, 20000);
    assert_eq!(trend_day[0].qty_milli, 4000);
    assert_eq!(trend_day[1].bucket_key, "1000");
    assert_eq!(trend_day[1].rev_paise, 30000);
    assert_eq!(trend_day[1].qty_milli, 6000);

    // Week bucket:
    // 999 / 7 = 142
    // 1000 / 7 = 142
    // Both fall in bucket "W142"
    // Sum rev = 20000 + 30000 = 50000, sum qty = 4000 + 6000 = 10000
    let trend_week = category_trend(&conn, "retail", 999, 1000, TrendBucket::Week).unwrap();
    assert_eq!(trend_week.len(), 1);
    assert_eq!(trend_week[0].bucket_key, "W142");
    assert_eq!(trend_week[0].rev_paise, 50000);
    assert_eq!(trend_week[0].qty_milli, 10000);
}

#[test]
fn test_civil_from_days_month_and_weekday() {
    // 1970-01-01 is day 0
    assert_eq!(month_of_day(0), (1970, 1));
    assert_eq!(weekday_of_day(0), 4); // Thursday

    // 2000-02-29 is a leap day
    // Days from 1970-01-01 to 2000-02-29:
    // 30 years (1970..2000): 30 * 365 + 7 leap years (1972, 76, 80, 84, 88, 92, 96) = 10950 + 7 = 10957 days to 2000-01-01.
    // In year 2000: Jan (31) + Feb 29 (28 days elapsed) = 31 + 28 = 59 days.
    // Total = 10957 + 59 = 11016 days.
    assert_eq!(month_of_day(11016), (2000, 2));

    // 2026-10-21:
    // Days from 1970-01-01 to 2026-10-21:
    // 56 years (1970..2026): 56 * 365 + 14 leap years (1972..2024 = 14) = 20440 + 14 = 20454 to 2026-01-01.
    // Days in 2026 before Oct 21:
    // Jan: 31, Feb: 28, Mar: 31, Apr: 30, May: 31, Jun: 30, Jul: 31, Aug: 31, Sep: 30 = 273 days.
    // Oct 21 is 20 days after Oct 1: 273 + 20 = 293 days.
    // Total = 20454 + 293 = 20747 or 20748? Let's check:
    // 20747: 20454 + 293 = 20747. Let's test day 20748 as well.
    let (y, m) = month_of_day(20747);
    assert_eq!((y, m), (2026, 10));
    assert_eq!(month_of_day(20748), (2026, 10));
}

fn setup_fixture_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    run_migrations(&mut conn, MIGRATIONS).unwrap();

    // Insert user
    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role) VALUES ('u1', 'admin', 'hash', 'Admin User', 'ADMIN')",
        [],
    ).unwrap();

    // Insert customer
    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
         VALUES ('cust_1', 'CUST001', 'CUSTOMER', 'Acme Corp', '27')",
        [],
    )
    .unwrap();

    // Insert resources
    // r1: Retail fast mover (qty=10000 milli, rev=50000 paise, cost=30000 paise -> gp=20000 paise)
    // r2: Retail slow mover (high stock=50000, zero sales in window)
    // r3: Retail dead stock (last sold 100 days ago, stock=20000, value=60000)
    // r4: Hospital critical drug (dead stock eligible by days, but is_critical=1 so excluded from dead_stock)
    // r5: Hospital expiring drug (stock=10000, expires in 10 days, qty_30=6000 -> excess stock at risk)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
         VALUES ('r1', 'SKU1', 'Fast Widget', '0001', 1800, 5000, 3000, 1, 1, 0)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
         VALUES ('r2', 'SKU2', 'Slow Widget', '0002', 1800, 5000, 3000, 1, 1, 0)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
         VALUES ('r3', 'SKU3', 'Dead Widget', '0003', 1800, 3000, 2000, 1, 1, 0)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
         VALUES ('r4', 'SKU4', 'Critical Antidote', '3004', 500, 10000, 8000, 1, 1, 1)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
         VALUES ('r5', 'SKU5', 'Expiring Vial', '3004', 500, 1000, 800, 1, 1, 1)",
        [],
    ).unwrap();

    // Populate product_stats
    // today = 1000
    conn.execute(
        "INSERT INTO product_stats (
            resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, margin_bp,
            stock_milli, stock_value_paise, last_received_day, earliest_expiry_day, last_sold_day,
            qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10, stats_day, category_id
        ) VALUES
        ('r1', 'retail', 1, 1800, 5000, 3000, 4000, 5000, 15000, 950, 99999999, 1000, 2000, 10000, 30000, 150000, 60000, 150, 1000, 1),
        ('r2', 'retail', 1, 1800, 5000, 3000, 4000, 50000, 150000, 980, 99999999, 900, 0, 0, 1000, 5000, 2000, 999999, 1000, 1),
        ('r3', 'retail', 1, 1800, 3000, 2000, 3333, 20000, 40000, 800, 99999999, 850, 0, 0, 0, 0, 0, 999999, 1000, 2),
        ('r4', 'hospital', 1, 500, 10000, 8000, 2000, 15000, 120000, 800, 99999999, 850, 0, 0, 0, 0, 0, 999999, 1000, 10),
        ('r5', 'hospital', 1, 500, 1000, 800, 2000, 10000, 8000, 950, 1010, 995, 1400, 6000, 18000, 18000, 3600, 500, 1000, 10)",
        [],
    ).unwrap();

    // Populate sales_daily for window tests (days 971..=1000)
    // Day 999: r1 sold 4000 milli, net 20000 paise, cogs 12000 paise (gp = 8000)
    // Day 1000: r1 sold 6000 milli, net 30000 paise, cogs 18000 paise (gp = 12000)
    // Total for r1 in window 30: qty = 10000 milli, rev = 50000 paise, gp = 20000 paise
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills)
         VALUES ('r1', 999, 4000, 20000, 12000, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills)
         VALUES ('r1', 1000, 6000, 30000, 18000, 2)",
        [],
    )
    .unwrap();

    // Populate sales_heat (day 1000 is Thursday, weekday 4; day 1001 is Friday, weekday 5)
    // Day 1000 (wd 4), Hour 14: 5 bills, 25000 net_paise
    // Day 1001 (wd 5), Hour 10: 2 bills, 12000 net_paise
    conn.execute(
        "INSERT INTO sales_heat (day, hour, bills, net_paise) VALUES (1000, 14, 5, 25000)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO sales_heat (day, hour, bills, net_paise) VALUES (1001, 10, 2, 12000)",
        [],
    )
    .unwrap();

    conn
}

#[test]
fn test_top_movers_and_slow_movers() {
    let conn = setup_fixture_db();
    let today = 1000;

    // Hand arithmetic:
    // r1 sales in window: qty = 10000, rev = 50000, gp = 20000
    let movers_qty = top_movers(&conn, "retail", today, 30, 10, MetricBy::Qty).unwrap();
    assert_eq!(movers_qty.len(), 1);
    assert_eq!(movers_qty[0].resource_id, "r1");
    assert_eq!(movers_qty[0].qty_milli, 10000);
    assert_eq!(movers_qty[0].rev_paise, 50000);
    assert_eq!(movers_qty[0].gp_paise, 20000);

    let movers_rev = top_movers(&conn, "retail", today, 30, 10, MetricBy::Revenue).unwrap();
    assert_eq!(movers_rev[0].rev_paise, 50000);

    let movers_gp = top_movers(&conn, "retail", today, 30, 10, MetricBy::GrossProfit).unwrap();
    assert_eq!(movers_gp[0].gp_paise, 20000);

    // Slow movers: positive stock, lowest velocity
    // r2 and r3 have 0 sales in window, r1 has 10000 sales
    // r2 stock value = 150000, r3 stock value = 40000
    // r2 should appear before r3 because stock_value_paise DESC tiebreaker:
    let slow = slow_movers(&conn, "retail", today, 30, 10).unwrap();
    assert_eq!(slow.len(), 3);
    assert_eq!(slow[0].resource_id, "r2");
    assert_eq!(slow[0].stock_value_paise, 150000);
    assert_eq!(slow[0].qty_milli, 0);
    assert_eq!(slow[1].resource_id, "r3");
    assert_eq!(slow[1].stock_value_paise, 40000);
}

#[test]
fn test_dead_stock_hospital_critical_exclusion() {
    let conn = setup_fixture_db();
    let today = 1000;

    // In retail, r3 is dead: last_sold_day = 850, last_received_day = 800.
    // inactive_days = 1000 - max(850, 800) = 150 days >= threshold 90 days.
    let dead_retail = dead_stock(&conn, "retail", today, 90, 10).unwrap();
    assert_eq!(dead_retail.len(), 1);
    assert_eq!(dead_retail[0].resource_id, "r3");
    assert_eq!(dead_retail[0].inactive_days, 150);

    // In hospital, r4 has last_sold = 850, last_received = 800 (150 days dead),
    // but r4 is marked is_critical = 1, so it MUST be excluded from dead_stock!
    let dead_hospital = dead_stock(&conn, "hospital", today, 90, 10).unwrap();
    assert_eq!(dead_hospital.len(), 0);
}

#[test]
fn test_margin_vs_velocity_and_stockout() {
    let conn = setup_fixture_db();

    let points = margin_vs_velocity(&conn, "retail", 10).unwrap();
    assert_eq!(points.len(), 3);
    // Ordered by rev_90_paise DESC: r1 (150000) > r2 (5000) > r3 (0)
    assert_eq!(points[0].resource_id, "r1");
    assert_eq!(points[0].margin_bp, 4000);
    assert_eq!(points[0].qty_30_milli, 10000);
    assert_eq!(points[0].rev_90_paise, 150000);

    // Stockout forecast: ordered by runout_days_x10 ASC, excluding sentinel (999999)
    // r1 runout_days_x10 = 150, r2 and r3 are 999999
    let stockout = stockout_forecast(&conn, "retail", 10).unwrap();
    assert_eq!(stockout.len(), 1);
    assert_eq!(stockout[0].resource_id, "r1");
    assert_eq!(stockout[0].runout_days_x10, 150);
}

#[test]
fn test_hourly_heatmap() {
    let conn = setup_fixture_db();

    // Heatmap across days 1000..=1001
    let cells = hourly_heatmap(&conn, 1000, 1001).unwrap();
    assert_eq!(cells.len(), 7 * 24);

    // Day 1000: (1000 + 4) % 7 = 1004 % 7 = 3? Wait!
    // 1000 + 4 = 1004. 1004 / 7 = 143 * 7 = 1001. 1004 - 1001 = 3!
    // So weekday_of_day(1000) = 3 (Wednesday).
    // Let's verify cell at wd = 3, hour = 14:
    let cell_w3_h14 = cells
        .iter()
        .find(|c| c.weekday == 3 && c.hour == 14)
        .unwrap();
    assert_eq!(cell_w3_h14.bills, 5);
    assert_eq!(cell_w3_h14.net_paise, 25000);

    // Day 1001: weekday_of_day(1001) = 4 (Thursday), hour 10:
    let cell_w4_h10 = cells
        .iter()
        .find(|c| c.weekday == 4 && c.hour == 10)
        .unwrap();
    assert_eq!(cell_w4_h10.bills, 2);
    assert_eq!(cell_w4_h10.net_paise, 12000);
}

#[test]
fn test_expiry_risk_hospital() {
    let conn = setup_fixture_db();
    let today = 1000;

    // r5 in hospital:
    // stock_milli = 10000
    // earliest_expiry_day = 1010 (10 days away: 1010 - 1000 = 10)
    // qty_30_milli = 6000
    // rate_per_day = 6000 / 30 = 200 milli/day
    // estimated consumption in 10 days = 200 * 10 = 2000 milli
    // at_risk_milli = max(0, 10000 - 2000) = 8000 milli
    // cost_price_paise = 800 per whole unit
    // at_risk_val = div_round_half_up(8000 * 800, 1000) = 6400 paise
    // r5 is critical (is_critical = 1) and MUST be included in expiry risk!
    let risk = expiry_risk(&conn, "hospital", today).unwrap();
    assert_eq!(risk.len(), 1);
    assert_eq!(risk[0].resource_id, "r5");
    assert_eq!(risk[0].stock_milli, 10000);
    assert_eq!(risk[0].earliest_expiry_day, 1010);
    assert_eq!(risk[0].at_risk_milli, 8000);
    assert_eq!(risk[0].at_risk_value_paise, 6400);
    assert!(risk[0].is_critical);
}

#[test]
fn test_wholesale_reorder_interval() {
    let conn = setup_fixture_db();

    // 1. Initially 0 purchases -> returns None
    let int_none = wholesale_reorder_interval(&conn, "cust_1", "r1").unwrap();
    assert_eq!(int_none, None);

    // 2. Add 2 purchases (only 1 gap) -> still returns None (< 3 purchases)
    conn.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series, invoice_number,
            entity_id, subtotal_paise, taxable_paise, total_amount_paise, created_by_user_id,
            transaction_type, invoice_date
        ) VALUES
        ('tx1', 'DRAFT', '27', '27', 'A', 'INV-001', 'cust_1', 1000, 1000, 1000, 'u1', 'SALE', '2026-10-21'),
        ('tx2', 'DRAFT', '27', '27', 'A', 'INV-002', 'cust_1', 1000, 1000, 1000, 'u1', 'SALE', '2026-10-21')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO transaction_items (
            id, transaction_id, resource_id, quantity_milli, unit_price_paise,
            tax_rate_bps, taxable_paise, line_total_paise, business_day
        ) VALUES
        ('ti1', 'tx1', 'r1', 1000, 1000, 0, 1000, 1000, 100),
        ('ti2', 'tx2', 'r1', 1000, 1000, 0, 1000, 1000, 110)",
        [],
    )
    .unwrap();

    // Attach balanced ledger entries and post tx1 and tx2
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le1_dr', 'tx1', NULL, 'acc_1100', 1000, 0, 'tx1 dr')", []).unwrap();
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le1_cr', 'tx1', NULL, 'acc_4000', 0, 1000, 'tx1 cr')", []).unwrap();
    conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx1'", []).unwrap();

    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le2_dr', 'tx2', NULL, 'acc_1100', 1000, 0, 'tx2 dr')", []).unwrap();
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le2_cr', 'tx2', NULL, 'acc_4000', 0, 1000, 'tx2 cr')", []).unwrap();
    conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx2'", []).unwrap();

    let int_still_none = wholesale_reorder_interval(&conn, "cust_1", "r1").unwrap();
    assert_eq!(int_still_none, None);

    // 3. Add 3rd purchase at day 124:
    // Days: 100, 110, 124
    // Gaps: (110 - 100 = 10), (124 - 110 = 14)
    // Gaps array = [10, 14]
    // Median of [10, 14] is (10 + 14) / 2 = 12
    conn.execute(
        "INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series, invoice_number,
            entity_id, subtotal_paise, taxable_paise, total_amount_paise, created_by_user_id,
            transaction_type, invoice_date
        ) VALUES
        ('tx3', 'DRAFT', '27', '27', 'A', 'INV-003', 'cust_1', 1000, 1000, 1000, 'u1', 'SALE', '2026-10-21')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO transaction_items (
            id, transaction_id, resource_id, quantity_milli, unit_price_paise,
            tax_rate_bps, taxable_paise, line_total_paise, business_day
        ) VALUES
        ('ti3', 'tx3', 'r1', 1000, 1000, 0, 1000, 1000, 124)",
        [],
    )
    .unwrap();

    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le3_dr', 'tx3', NULL, 'acc_1100', 1000, 0, 'tx3 dr')", []).unwrap();
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le3_cr', 'tx3', NULL, 'acc_4000', 0, 1000, 'tx3 cr')", []).unwrap();
    conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx3'", []).unwrap();

    let int_median = wholesale_reorder_interval(&conn, "cust_1", "r1").unwrap();
    assert_eq!(int_median, Some(12));
}
