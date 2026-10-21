use omnibill_core::database::{
    migrations::{run_migrations, MIGRATIONS},
    open_connection,
};
use omnibill_core::discovery::math::{
    abc_class, at_risk_milli, div_round_half_up, effective_days, gmroi_annual_bp, gmroi_bp,
    is_dead, lot_value_paise, margin_bp, runout_days_x10, MathError, SENTINEL_RUNOUT_DAYS_X10,
};
use omnibill_core::discovery::refresh::refresh_stats;
use rusqlite::params;
use std::path::PathBuf;

fn setup_temp_db(name: &str) -> (rusqlite::Connection, PathBuf) {
    let mut temp_path = std::env::temp_dir();
    temp_path.push(format!("omnibill_test_{}_{}.db", name, std::process::id()));
    if temp_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
    }
    let mut conn = open_connection(&temp_path).unwrap();
    run_migrations(&mut conn, MIGRATIONS).unwrap();
    (conn, temp_path)
}

fn cleanup_temp_db(path: &PathBuf) {
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
}

// ----------------------------------------------------------------------------
// 1. GOLDEN TEST: div_round_half_up
// ----------------------------------------------------------------------------
#[test]
fn test_golden_div_round_half_up() {
    // Hand arithmetic:
    // (5 + 1) / 2 = 6 / 2 = 3
    assert_eq!(div_round_half_up(5, 2).unwrap(), 3);

    // (-5 - 1) / 2 = -6 / 2 = -3
    assert_eq!(div_round_half_up(-5, 2).unwrap(), -3);

    // (4 + 1) / 2 = 5 / 2 = 2
    assert_eq!(div_round_half_up(4, 2).unwrap(), 2);

    // (1 + 1) / 3 = 2 / 3 = 0
    assert_eq!(div_round_half_up(1, 3).unwrap(), 0);

    // (2 + 1) / 3 = 3 / 3 = 1
    assert_eq!(div_round_half_up(2, 3).unwrap(), 1);

    // Division by zero or negative denominator
    assert_eq!(div_round_half_up(10, 0), Err(MathError::DivByZero));
    assert_eq!(div_round_half_up(10, -2), Err(MathError::DivByZero));
}

// ----------------------------------------------------------------------------
// 2. GOLDEN TEST: margin_bp
// ----------------------------------------------------------------------------
#[test]
fn test_golden_margin_bp() {
    // Hand arithmetic:
    // net = 10000, cogs = 7500 -> diff = 2500
    // num = 2500 * 10000 = 25000000
    // (25000000 + 5000) / 10000 = 2500 bp (25%)
    assert_eq!(margin_bp(10_000, 7_500).unwrap(), 2500);

    // net = 0 -> definition returns 0
    assert_eq!(margin_bp(0, 0).unwrap(), 0);

    // net = 3, cogs = 1 -> diff = 2
    // num = 2 * 10000 = 20000
    // (20000 + 1) / 3 = 20001 / 3 = 6667 bp (66.67%)
    assert_eq!(margin_bp(3, 1).unwrap(), 6667);
}

// ----------------------------------------------------------------------------
// 3. GOLDEN TEST: runout_days_x10
// ----------------------------------------------------------------------------
#[test]
fn test_golden_runout_days_x10() {
    // Hand arithmetic:
    // stock = 12000 milli (12 units), sold = 6000 milli over eff_days = 30
    // num = 12000 * 30 * 10 = 3600000
    // (3600000 + 3000) / 6000 = 3603000 / 6000 = 600 (60.0 days)
    assert_eq!(runout_days_x10(12_000, 6_000, 30).unwrap(), 600);

    // Zero sales in window -> sentinel
    assert_eq!(
        runout_days_x10(12_000, 0, 30).unwrap(),
        SENTINEL_RUNOUT_DAYS_X10
    );
    assert_eq!(
        runout_days_x10(12_000, -100, 30).unwrap(),
        SENTINEL_RUNOUT_DAYS_X10
    );

    // Zero or negative stock
    assert_eq!(runout_days_x10(0, 6_000, 30).unwrap(), 0);
    assert_eq!(runout_days_x10(-500, 6_000, 30).unwrap(), 0);
}

// ----------------------------------------------------------------------------
// 4. GOLDEN TEST: gmroi_bp
// ----------------------------------------------------------------------------
#[test]
fn test_golden_gmroi_bp() {
    // Hand arithmetic:
    // gp = 25000 paise, avg_inv = 10000 paise
    // num = 25000 * 10000 = 250000000
    // 250000000 / 10000 = 25000 bp (2.5x return on inventory investment)
    assert_eq!(gmroi_bp(25_000, 10_000).unwrap(), 25_000);

    // Zero or negative average inventory -> 0
    assert_eq!(gmroi_bp(25_000, 0).unwrap(), 0);
    assert_eq!(gmroi_bp(25_000, -500).unwrap(), 0);

    // Annualised variant: gp = 25000, avg_inv = 10000, window_days = 365 -> 25000 bp
    assert_eq!(gmroi_annual_bp(25_000, 10_000, 365).unwrap(), 25_000);
}

// ----------------------------------------------------------------------------
// 5. GOLDEN TEST: abc_class boundary
// ----------------------------------------------------------------------------
#[test]
fn test_golden_abc_class_boundary() {
    // Hand arithmetic:
    // total = 100_000. 80% threshold = 8000 * 100_000 = 800_000_000.
    // 95% threshold = 9500 * 100_000 = 950_000_000.
    //
    // cum_before = 79_999:
    // 79_999 * 10_000 = 799_990_000 < 800_000_000 -> Class 1
    assert_eq!(abc_class(79_999, 100_000), 1);

    // cum_before = 80_000:
    // 80_000 * 10_000 = 800_000_000 (not < 800_000_000, but < 950_000_000) -> Class 2
    assert_eq!(abc_class(80_000, 100_000), 2);

    // cum_before = 94_999:
    // 94_999 * 10_000 = 949_990_000 < 950_000_000 -> Class 2
    assert_eq!(abc_class(94_999, 100_000), 2);

    // cum_before = 95_000:
    // 95_000 * 10_000 = 950_000_000 (not < 950_000_000) -> Class 3
    assert_eq!(abc_class(95_000, 100_000), 3);

    // Non-positive total -> Class 3
    assert_eq!(abc_class(0, 0), 3);
    assert_eq!(abc_class(10, -5), 3);
}

// ----------------------------------------------------------------------------
// 6. GOLDEN TEST: is_dead boundary
// ----------------------------------------------------------------------------
#[test]
fn test_golden_is_dead_boundary() {
    // Hand arithmetic:
    // today = 100, threshold = 30
    //
    // 1. Exactly at threshold:
    // last_sold = 70, last_received = 50 -> max = 70
    // 100 - 70 = 30 >= 30 -> true
    assert!(is_dead(1_000, 70, 50, 100, 30));

    // 2. One day short of threshold:
    // last_sold = 71, last_received = 50 -> max = 71
    // 100 - 71 = 29 < 30 -> false
    assert!(!is_dead(1_000, 71, 50, 100, 30));

    // 3. Newly received item (received yesterday):
    // last_sold = 50, last_received = 99 -> max = 99
    // 100 - 99 = 1 < 30 -> false
    assert!(!is_dead(1_000, 50, 99, 100, 30));

    // 4. Zero stock is never dead
    assert!(!is_dead(0, 10, 10, 100, 30));
}

// ----------------------------------------------------------------------------
// 7. GOLDEN TEST: Overflow
// ----------------------------------------------------------------------------
#[test]
fn test_golden_overflow() {
    // div_round_half_up(i128::MAX, 1) returns Err(Overflow) because result exceeds i64::MAX
    let res = div_round_half_up(i128::MAX, 1);
    assert_eq!(res, Err(MathError::Overflow));
}

// ----------------------------------------------------------------------------
// 8. GOLDEN TEST: Property-style LCG loop (10,000 iterations)
// ----------------------------------------------------------------------------
#[test]
fn test_golden_property_lcg_loop() {
    let mut state: u64 = 0xDEADBEEF_CAFE1234;
    let mut next_lcg = || -> u64 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        state
    };

    for _ in 0..10_000 {
        let r1 = next_lcg();
        let r2 = next_lcg();
        let r3 = next_lcg();

        // Generate net_paise in 1..=1_000_000 (10000 rupees)
        let net = ((r1 % 1_000_000) + 1) as i64;
        // Generate cogs_paise in 0..=1_000_000
        let cogs = (r2 % 1_000_001) as i64;

        let margin = margin_bp(net, cogs).unwrap();
        // Since net >= 1, max margin when cogs = 0 is 10_000 bp (100%)
        // Min margin when cogs = 1_000_000 and net = 1 is:
        // (1 - 1_000_000) * 10000 / 1 = -9_999_990_000, well bounded
        assert!(margin <= 10_000);
        if cogs <= net * 1000 {
            assert!(margin >= -10_000_000);
        }

        // Test runout never panics
        let stock = ((r3 % 20_000) as i64) - 2_000; // may be negative
        let qty = ((r1 % 20_000) as i64) - 2_000;
        let eff = effective_days(30, (r2 % 35) as i64);

        let runout = runout_days_x10(stock, qty, eff);
        assert!(runout.is_ok());
        let val = runout.unwrap();
        assert!((0..=SENTINEL_RUNOUT_DAYS_X10).contains(&val));
    }
}

// ----------------------------------------------------------------------------
// 9. AUXILIARY PURE MATH TESTS: lot_value, effective_days, at_risk_milli
// ----------------------------------------------------------------------------
#[test]
fn test_auxiliary_pure_math() {
    // lot_value_paise: 5000 milli (5 units) at 12000 paise (Rs 120) per unit
    // num = 5000 * 12000 = 60000000 -> 60000000 / 1000 = 60000 paise
    assert_eq!(lot_value_paise(5_000, 12_000).unwrap(), 60_000);

    // effective_days: window 30, stocked out 5 -> max(25, 3) = 25
    assert_eq!(effective_days(30, 5), 25);
    // window 30, stocked out 29 -> max(1, 3) = 3 (minimum floor)
    assert_eq!(effective_days(30, 29), 3);

    // at_risk_milli: stock 10_000, rate 100 milli / day, 40 days to expiry
    // expected sold = 100 * 40 = 4000
    // at risk = 10_000 - 4000 = 6000 milli
    assert_eq!(at_risk_milli(10_000, 100, 1, 40).unwrap(), 6_000);
    // expired item (0 days to expiry) -> all 10_000 at risk
    assert_eq!(at_risk_milli(10_000, 100, 1, 0).unwrap(), 10_000);
}

// ----------------------------------------------------------------------------
// 10. DATABASE REFRESH STATS & IDEMPOTENCY TEST (10 resources)
// ----------------------------------------------------------------------------
type StatsSnapshotRow = (String, i64, i64, i64, i64, i64, i64, i64, i64);

#[test]
fn test_refresh_stats_database_idempotency_and_golden_verification() {
    let (mut conn, path) = setup_temp_db("refresh_golden");

    // Seed 10 resources: res_0 to res_9
    // Hand values:
    // res_0: sell = 20_000, cost = 15_000 -> margin = 2500 bp
    // res_1: sell = 10_000, cost = 5_000  -> margin = 5000 bp
    // res_2: sell = 50_000, cost = 40_000 -> margin = 2000 bp
    // res_3 to res_9: varying
    for i in 0..10 {
        let res_id = format!("res_{}", i);
        let sku = format!("SKU_{}", i);
        let name = format!("Item {}", i);
        let sell = (i as i64 + 1) * 10_000;
        let cost = (i as i64 + 1) * 6_000;

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active)
             VALUES (?1, ?2, ?3, '1234', 1800, ?4, ?5, 1, 1)",
            params![res_id, sku, name, sell, cost],
        ).unwrap();

        // Seed product_stats point fields
        let stock_milli = (10 - i as i64) * 2_000;
        let stock_val = stock_milli * cost / 1000;
        conn.execute(
            "INSERT INTO product_stats (
                resource_id, vertical, is_active, brand_id, category_id, tax_bp,
                sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
                max_stock_milli, stock_value_paise, first_received_day, last_received_day,
                last_supplier_id, earliest_expiry_day, last_sold_day, qty_7_milli,
                qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10,
                gmroi_bp, abc_class, stats_day
             ) VALUES (
                ?1, 'retail', 1, NULL, 1, 1800,
                ?2, ?3, 0, ?4, 0,
                0, ?5, 1, 10,
                NULL, 99999999, 90, 0,
                0, 0, 0, 0, 999999,
                0, 3, 0
             )",
            params![res_id, sell, cost, stock_milli, stock_val],
        )
        .unwrap();
    }

    let today = 100;

    // Seed sales_daily for res_0, res_1, res_2:
    // res_0: day 95 (qty=2_000, net=40_000, cogs=30_000), day 80 (qty=4_000, net=80_000, cogs=60_000)
    // res_1: day 98 (qty=10_000, net=100_000, cogs=50_000)
    // res_2: day 50 (qty=1_000, net=50_000, cogs=40_000)
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills) VALUES
         ('res_0', 95, 2000, 40000, 30000, 2),
         ('res_0', 80, 4000, 80000, 60000, 3),
         ('res_1', 98, 10000, 100000, 50000, 5),
         ('res_2', 50, 1000, 50000, 40000, 1)",
        [],
    )
    .unwrap();

    // Seed 8 inventory_daily rows for res_0 so it qualifies for GMROI (cnt >= 7)
    for d in 90..=97 {
        conn.execute(
            "INSERT INTO inventory_daily (resource_id, day, stock_milli, value_paise) VALUES ('res_0', ?1, 12000, 10000)",
            params![d],
        ).unwrap();
    }

    // Run 1: refresh_stats
    let report1 = refresh_stats(&mut conn, today).unwrap();
    println!("Refresh Report 1: {:?}", report1);
    assert_eq!(report1.resources_updated, 10);
    assert_eq!(report1.inventory_snapshots_written, 10);

    // Hand verification for res_0:
    // sell = 10_000, cost = 6_000 -> margin = (10000-6000)*10000 / 10000 = 4000 bp
    // sales windows for res_0:
    // q7 (day > 93): day 95 -> 2000
    // q30 (day > 70): day 95 + day 80 -> 2000 + 4000 = 6000
    // q90 (day > 10): day 95 + day 80 -> 6000
    // rev90: 40_000 + 80_000 = 120_000
    // gp90: (40000-30000) + (80000-60000) = 30_000
    // stocked_out_days in last 30 days = 0 -> eff_days = 30
    // stock_milli = (10 - 0)*2000 = 20_000
    // runout_days_x10: 20_000 * 30 * 10 / 6000 = 6_000_000 / 6000 = 1000 (100.0 days)
    // inventory snapshot avg over 90 days: 8 rows of 10000 + 1 snapshot today of stock_val (120000)
    // cnt = 9, sum = 8*10000 + 120000 = 200000 -> avg = 200000 / 9 = 22222
    // gmroi_bp = 30_000 * 10000 / 22222 = 13500 bp
    let (m_bp, q7, q30, q90, rev90, gp90, runout, abc, s_day): (i64, i64, i64, i64, i64, i64, i64, i64, i64) = conn.query_row(
        "SELECT margin_bp, qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10, abc_class, stats_day
         FROM product_stats WHERE resource_id = 'res_0'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
    ).unwrap();

    assert_eq!(m_bp, 4000);
    assert_eq!(q7, 2000);
    assert_eq!(q30, 6000);
    assert_eq!(q90, 6000);
    assert_eq!(rev90, 120_000);
    assert_eq!(gp90, 30_000);
    assert_eq!(runout, 1000);
    assert_eq!(s_day, today);
    // res_0 has rev 120_000, res_1 has 100_000, res_2 has 50_000. Total = 270_000.
    // res_0 is ranked #1. cum_before = 0 < 80% * 270_000 -> Class 1
    assert_eq!(abc, 1);

    // Capture snapshot of entire product_stats table after Run 1
    let snapshot1: Vec<StatsSnapshotRow> = {
        let mut stmt = conn.prepare(
            "SELECT resource_id, margin_bp, qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10, abc_class
             FROM product_stats ORDER BY resource_id",
        ).unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    };

    // Run 2: execute refresh_stats again with identical today (IDEMPOTENCY TEST)
    let report2 = refresh_stats(&mut conn, today).unwrap();
    println!("Refresh Report 2 (idempotency check): {:?}", report2);
    assert_eq!(report2.resources_updated, 10);

    let snapshot2: Vec<StatsSnapshotRow> = {
        let mut stmt = conn.prepare(
            "SELECT resource_id, margin_bp, qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10, abc_class
             FROM product_stats ORDER BY resource_id",
        ).unwrap();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })
            .unwrap();
        rows.map(|r| r.unwrap()).collect()
    };

    // Assert full table dumps are identical
    assert_eq!(snapshot1, snapshot2);

    cleanup_temp_db(&path);
}
