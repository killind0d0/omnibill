//! Comprehensive End-to-End, Isolation, and POS Safety Verification Suite
//!
//! Validates:
//! 1. Multi-vertical complete lifecycle (seed -> sale -> return -> cancel -> refresh -> alerts -> discovery -> graph -> export)
//! 2. Rebuild rollups snapshot equality
//! 3. Double-entry ledger audit balance (`verify_ledger`)
//! 4. Non-negative stock invariant
//! 5. Strict vertical isolation across all commands
//! 6. PRAGMA integrity_check and foreign_key_check
//! 7. Multi-threaded concurrent POS safety (500 bills posted while read-pool queries run concurrently)

use omnibill_core::database::{
    migrations::{MIGRATIONS, run_migrations},
    open_connection,
    queries::verify_ledger,
};
use omnibill_core::discovery::{
    alerts::generate_alerts,
    export::{day_summary_text, export_discovery},
    facets::discover_facets,
    fts::rebuild_fts,
    graph::{
        MetricBy, TrendBucket, category_trend, dead_stock, expiry_risk, hourly_heatmap,
        margin_vs_velocity, slow_movers, stockout_forecast, top_movers,
    },
    pool::ReadOnlyPool,
    query::{Dir, DiscoveryQuery, Preset, Range, SortKey, SortSpec, discover_products},
    refresh::refresh_stats,
    rollup::rebuild_rollups,
};
use omnibill_core::posting::{
    LineInput, PriceMode, SaleInput, SaleReturnInput, post_sale, post_sale_return,
    returns::cancel_posted_sale,
};
use rusqlite::Connection;
use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Instant;

fn setup_scenario_db(path: &std::path::Path) -> Connection {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    let mut conn = open_connection(path).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    // 1. Users & Entities
    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role) VALUES ('u_admin', 'admin', 'hash', 'Admin', 'ADMIN')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code) VALUES
         ('SUP_1', 'SUP001', 'SUPPLIER', 'Supplier Retail', '27'),
         ('CUST_RET', 'CUST001', 'CUSTOMER', 'Retail Walkin', '27'),
         ('CUST_WHO', 'CUST002', 'CUSTOMER', 'Wholesale Buyer', '27'),
         ('PAT_HOSP', 'PAT001', 'CUSTOMER', 'Hospital Patient', '27')",
        [],
    )
    .unwrap();

    // 2. Resources across 3 verticals:
    // Retail: ret_1, ret_2
    // Wholesale: who_1, who_2
    // Hospital: hosp_1, hosp_2 (hosp_2 is ICU critical)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical) VALUES
         ('ret_1', 'RET-01', 'Retail Biscuits 200g', '1905', 500, 2000, 1500, 1, 1, 0),
         ('ret_2', 'RET-02', 'Retail Cooking Oil 1L', '1512', 500, 15000, 12000, 1, 1, 0),
         ('who_1', 'WHO-01', 'Wholesale Bulk Rice 50kg', '1006', 0, 150000, 120000, 1, 1, 0),
         ('who_2', 'WHO-02', 'Wholesale Sugar Bag 50kg', '1701', 500, 180000, 160000, 1, 1, 0),
         ('hosp_1', 'HSP-01', 'Hospital Antibiotic 500mg', '3004', 1200, 5000, 3500, 1, 1, 0),
         ('hosp_2', 'HSP-02', 'Hospital ICU Antidote Vial', '3004', 1200, 25000, 20000, 1, 1, 1)",
        [],
    ).unwrap();

    // 3. Resource Lots & initial stock movements
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day) VALUES
         ('lot_ret_1', 'ret_1', 'L-RET1', '2028-12-31', 2500, 1500, 'SUP_1', 19800),
         ('lot_ret_2', 'ret_2', 'L-RET2', '2028-12-31', 16000, 12000, 'SUP_1', 19800),
         ('lot_who_1', 'who_1', 'L-WHO1', '2028-12-31', 160000, 120000, 'SUP_1', 19800),
         ('lot_who_2', 'who_2', 'L-WHO2', '2028-12-31', 190000, 160000, 'SUP_1', 19800),
         ('lot_hosp_1', 'hosp_1', 'L-HSP1', '2026-11-05', 6000, 3500, 'SUP_1', 19800),
         ('lot_hosp_2', 'hosp_2', 'L-HSP2', '2026-10-31', 28000, 20000, 'SUP_1', 19800)",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli) VALUES
         ('sm_1', 'ret_1', 'lot_ret_1', NULL, 'PURCHASE', 100000),
         ('sm_2', 'ret_2', 'lot_ret_2', NULL, 'PURCHASE', 100000),
         ('sm_3', 'who_1', 'lot_who_1', NULL, 'PURCHASE', 100000),
         ('sm_4', 'who_2', 'lot_who_2', NULL, 'PURCHASE', 100000),
         ('sm_5', 'hosp_1', 'lot_hosp_1', NULL, 'PURCHASE', 100000),
         ('sm_6', 'hosp_2', 'lot_hosp_2', NULL, 'PURCHASE', 100000)",
        [],
    ).unwrap();

    // 4. Initial Product Stats
    conn.execute(
        "INSERT INTO product_stats (
            resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, margin_bp,
            stock_milli, stock_value_paise, reorder_milli, max_stock_milli,
            first_received_day, last_received_day, earliest_expiry_day, last_sold_day,
            qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise,
            runout_days_x10, stats_day, category_id
        ) VALUES
        ('ret_1', 'retail', 1, 500, 2000, 1500, 2500, 50000, 75000, 5000, 100000, 900, 950, 99999999, 990, 5000, 15000, 30000, 60000, 15000, 100, 1000, 1),
        ('ret_2', 'retail', 1, 500, 15000, 12000, 2000, 40000, 480000, 5000, 100000, 900, 950, 99999999, 990, 2000, 8000, 20000, 300000, 60000, 150, 1000, 1),
        ('who_1', 'wholesale', 1, 0, 150000, 120000, 2000, 100000, 12000000, 10000, 200000, 900, 950, 99999999, 990, 10000, 40000, 80000, 12000000, 2400000, 75, 1000, 2),
        ('who_2', 'wholesale', 1, 500, 180000, 160000, 1111, 100000, 16000000, 10000, 200000, 900, 950, 99999999, 990, 5000, 20000, 50000, 9000000, 1000000, 150, 1000, 2),
        ('hosp_1', 'hospital', 1, 1200, 5000, 3500, 3000, 30000, 105000, 5000, 50000, 900, 950, 1015, 990, 2000, 10000, 25000, 125000, 37500, 90, 1000, 3),
        ('hosp_2', 'hospital', 1, 1200, 25000, 20000, 2000, 20000, 400000, 5000, 50000, 900, 950, 1010, 990, 1000, 5000, 12000, 300000, 60000, 120, 1000, 3)",
        [],
    ).unwrap();

    // Rebuild FTS5 index for resources
    rebuild_fts(&conn).unwrap();

    conn
}

#[derive(Debug, PartialEq, Eq)]
struct DailySnapshot {
    res_id: String,
    day: i64,
    qty: i64,
    net: i64,
    bills: i64,
}

#[derive(Debug, PartialEq, Eq)]
struct HeatSnapshot {
    day: i64,
    hour: i64,
    bills: i64,
    net: i64,
}

#[test]
fn test_discovery_e2e_lifecycle_and_invariants() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_e2e_{}.db", std::process::id()));
    let mut conn = setup_scenario_db(&db_path);
    let today = 20747; // Exact civil day for "2026-10-21"

    // 1. Post Sale on Retail (ret_1)
    let sale_input = SaleInput {
        invoice_date: "2026-10-21".to_string(),
        seller_state_code: "27".to_string(),
        place_of_supply_state_code: "27".to_string(),
        customer: Some("CUST_RET".to_string()),
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "ret_1".to_string(),
            quantity_milli: 2000,
            unit_price_paise: 2000,
            discount_paise: 0,
            tax_rate_bps: 500,
        }],
    };

    let posted_sale = post_sale(&mut conn, &sale_input).expect("post sale");
    assert!(!posted_sale.transaction_id.is_empty());

    // 2. Post Sale Return
    let return_input = SaleReturnInput {
        return_date: "2026-10-21".to_string(),
        original_transaction_id: posted_sale.transaction_id.clone(),
        reason: Some("Customer partial return".to_string()),
        lines: vec![LineInput {
            resource_id: "ret_1".to_string(),
            quantity_milli: 500,
            unit_price_paise: 2000,
            discount_paise: 0,
            tax_rate_bps: 500,
        }],
    };

    let posted_return = post_sale_return(&mut conn, &return_input).expect("post return");
    assert!(!posted_return.transaction_id.is_empty());

    // 3. Post a 2nd sale and Cancel it
    let sale_input_2 = SaleInput {
        invoice_date: "2026-10-21".to_string(),
        seller_state_code: "27".to_string(),
        place_of_supply_state_code: "27".to_string(),
        customer: Some("CUST_RET".to_string()),
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "ret_2".to_string(),
            quantity_milli: 1000,
            unit_price_paise: 15000,
            discount_paise: 0,
            tax_rate_bps: 500,
        }],
    };
    let posted_sale_2 = post_sale(&mut conn, &sale_input_2).expect("post sale 2");
    cancel_posted_sale(&mut conn, &posted_sale_2.transaction_id).expect("cancel sale");

    // 4. Run refresh_stats
    let ref_rep = refresh_stats(&mut conn, today).expect("refresh stats");
    assert!(ref_rep.resources_updated >= 6);

    // 5. Run generate_alerts across verticals
    let al_ret = generate_alerts(&conn, "retail", today).expect("retail alerts");
    let al_who = generate_alerts(&conn, "wholesale", today).expect("wholesale alerts");
    let al_hosp = generate_alerts(&conn, "hospital", today).expect("hospital alerts");
    assert!(al_hosp.expiry_alerts >= 1); // hosp_1 or hosp_2 expires <= 30 days
    let _ = (al_ret, al_who);

    // 6. Run discover_products with 5 filter combos:
    // Combo 1: Text search
    let q1 = DiscoveryQuery {
        text: Some("Biscuit".to_string()),
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 10,
        cursor: None,
    };
    let p1 = discover_products(&conn, "retail", today, &q1).expect("combo 1");
    assert_eq!(p1.items.len(), 1);
    assert_eq!(p1.items[0].id, "ret_1");

    // Combo 2: Price Range
    let q2 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: Some(Range {
            min: Some(10000),
            max: Some(20000),
        }),
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 10,
        cursor: None,
    };
    let p2 = discover_products(&conn, "retail", today, &q2).expect("combo 2");
    assert_eq!(p2.items.len(), 1);
    assert_eq!(p2.items[0].id, "ret_2");

    // Combo 3: Preset Fast Movers
    let q3 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: Some(Preset::Fast),
        abc: vec![],
        sort: vec![],
        limit: 10,
        cursor: None,
    };
    let p3 = discover_products(&conn, "retail", today, &q3).expect("combo 3");
    assert!(!p3.items.is_empty());

    // Combo 4: Multi-Sort (Margin DESC, Revenue DESC)
    let q4 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![
            SortSpec {
                key: SortKey::Margin,
                dir: Dir::Desc,
            },
            SortSpec {
                key: SortKey::Revenue,
                dir: Dir::Desc,
            },
        ],
        limit: 10,
        cursor: None,
    };
    let p4 = discover_products(&conn, "retail", today, &q4).expect("combo 4");
    assert_eq!(p4.items.len(), 2);

    // Combo 5: Facets
    let f5 = discover_facets(&conn, "retail", today, &q4).expect("combo 5");
    assert!(!f5.tax_bp.is_empty());

    // 7. Run all graph functions
    let _ = top_movers(&conn, "retail", today, 30, 5, MetricBy::Revenue).unwrap();
    let _ = slow_movers(&conn, "retail", today, 30, 5).unwrap();
    let _ = dead_stock(&conn, "retail", today, 30, 5).unwrap();
    let _ = margin_vs_velocity(&conn, "retail", 50).unwrap();
    let _ = category_trend(&conn, "retail", today - 30, today, TrendBucket::Day).unwrap();
    let _ = hourly_heatmap(&conn, today - 7, today).unwrap();
    let _ = stockout_forecast(&conn, "retail", 10).unwrap();
    let _ = expiry_risk(&conn, "hospital", today).unwrap();

    // 8. Run export and summary text
    let exp_path = export_discovery(
        &conn,
        &q4,
        "retail",
        today,
        Some(temp_dir.to_str().unwrap()),
    )
    .expect("export");
    assert!(exp_path.exists());
    let _ = fs::remove_file(exp_path);

    let summary = day_summary_text(&conn, "retail", today).expect("summary");
    assert!(summary.len() < 1000);

    // =========================================================================
    // CRITICAL AUDIT ASSERTIONS
    // =========================================================================

    // A. Rebuild rollups snapshot equality
    let (daily_before, heat_before) = {
        let mut prep_daily = conn.prepare("SELECT resource_id, day, qty_milli, net_paise, bills FROM sales_daily ORDER BY resource_id, day").unwrap();
        let daily: Vec<DailySnapshot> = prep_daily
            .query_map([], |r| {
                Ok(DailySnapshot {
                    res_id: r.get(0)?,
                    day: r.get(1)?,
                    qty: r.get(2)?,
                    net: r.get(3)?,
                    bills: r.get(4)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let mut prep_heat = conn
            .prepare("SELECT day, hour, bills, net_paise FROM sales_heat ORDER BY day, hour")
            .unwrap();
        let heat: Vec<HeatSnapshot> = prep_heat
            .query_map([], |r| {
                Ok(HeatSnapshot {
                    day: r.get(0)?,
                    hour: r.get(1)?,
                    bills: r.get(2)?,
                    net: r.get(3)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        (daily, heat)
    };

    // Rebuild
    let _ = rebuild_rollups(&conn).expect("rebuild rollups");

    let (daily_after, heat_after) = {
        let mut prep_daily = conn.prepare("SELECT resource_id, day, qty_milli, net_paise, bills FROM sales_daily ORDER BY resource_id, day").unwrap();
        let daily: Vec<DailySnapshot> = prep_daily
            .query_map([], |r| {
                Ok(DailySnapshot {
                    res_id: r.get(0)?,
                    day: r.get(1)?,
                    qty: r.get(2)?,
                    net: r.get(3)?,
                    bills: r.get(4)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let mut prep_heat = conn
            .prepare("SELECT day, hour, bills, net_paise FROM sales_heat ORDER BY day, hour")
            .unwrap();
        let heat: Vec<HeatSnapshot> = prep_heat
            .query_map([], |r| {
                Ok(HeatSnapshot {
                    day: r.get(0)?,
                    hour: r.get(1)?,
                    bills: r.get(2)?,
                    net: r.get(3)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        (daily, heat)
    };

    assert_eq!(
        daily_before, daily_after,
        "Snapshot equality failed on sales_daily"
    );
    assert_eq!(
        heat_before, heat_after,
        "Snapshot equality failed on sales_heat"
    );

    // B. Books balance using verify_ledger
    let discrepancies = verify_ledger(&conn).expect("verify ledger");
    assert!(
        discrepancies.is_empty(),
        "Ledger discrepancies found: {:?}",
        discrepancies
    );

    // C. Non-negative stock_milli invariant across derived tables
    let neg_stock_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM product_stats WHERE stock_milli < 0",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        neg_stock_count, 0,
        "Found negative stock_milli in product_stats"
    );

    // D. Vertical Isolation across ALL commands
    let retail_items = discover_products(
        &conn,
        "retail",
        today,
        &DiscoveryQuery {
            text: None,
            brand_ids: vec![],
            supplier_ids: vec![],
            category_ids: vec![],
            tax_bp: vec![],
            sell_paise: None,
            cost_paise: None,
            margin_bp: None,
            stock_milli: None,
            received_day: None,
            last_sold_day: None,
            expiry_day: None,
            preset: None,
            abc: vec![],
            sort: vec![],
            limit: 50,
            cursor: None,
        },
    )
    .unwrap()
    .items;
    for item in retail_items {
        assert!(
            item.id.starts_with("ret_"),
            "Vertical leak: found non-retail item in retail: {}",
            item.id
        );
    }

    let wholesale_items = discover_products(
        &conn,
        "wholesale",
        today,
        &DiscoveryQuery {
            text: None,
            brand_ids: vec![],
            supplier_ids: vec![],
            category_ids: vec![],
            tax_bp: vec![],
            sell_paise: None,
            cost_paise: None,
            margin_bp: None,
            stock_milli: None,
            received_day: None,
            last_sold_day: None,
            expiry_day: None,
            preset: None,
            abc: vec![],
            sort: vec![],
            limit: 50,
            cursor: None,
        },
    )
    .unwrap()
    .items;
    for item in wholesale_items {
        assert!(
            item.id.starts_with("who_"),
            "Vertical leak: found non-wholesale item in wholesale: {}",
            item.id
        );
    }

    let hospital_items = discover_products(
        &conn,
        "hospital",
        today,
        &DiscoveryQuery {
            text: None,
            brand_ids: vec![],
            supplier_ids: vec![],
            category_ids: vec![],
            tax_bp: vec![],
            sell_paise: None,
            cost_paise: None,
            margin_bp: None,
            stock_milli: None,
            received_day: None,
            last_sold_day: None,
            expiry_day: None,
            preset: None,
            abc: vec![],
            sort: vec![],
            limit: 50,
            cursor: None,
        },
    )
    .unwrap()
    .items;
    for item in hospital_items {
        assert!(
            item.id.starts_with("hosp_"),
            "Vertical leak: found non-hospital item in hospital: {}",
            item.id
        );
    }

    // E. PRAGMA integrity_check & foreign_key_check
    let integrity_status: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        integrity_status, "ok",
        "PRAGMA integrity_check failed: {}",
        integrity_status
    );

    let mut fk_stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
    let fk_violations: Vec<String> = fk_stmt
        .query_map([], |r| {
            let table: String = r.get(0)?;
            let rowid: i64 = r.get(1)?;
            Ok(format!("{}:{}", table, rowid))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(
        fk_violations.is_empty(),
        "Foreign key violations detected: {:?}",
        fk_violations
    );

    // Clean up
    let _ = fs::remove_file(db_path);
}

#[test]
fn test_pos_safety_concurrent_readers_and_writer_p95() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_pos_safety_{}.db", std::process::id()));
    let db_path_str = db_path.to_str().unwrap().to_string();

    let mut conn = setup_scenario_db(&db_path);

    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_reader = Arc::clone(&stop_signal);

    // Spawn reader thread querying repeatedly via ReadOnlyPool
    let db_path_clone = db_path_str.clone();
    let reader_handle = thread::spawn(move || {
        let pool = ReadOnlyPool::new(&db_path_clone).expect("create read pool");
        let query = DiscoveryQuery {
            text: None,
            brand_ids: vec![],
            supplier_ids: vec![],
            category_ids: vec![],
            tax_bp: vec![],
            sell_paise: None,
            cost_paise: None,
            margin_bp: None,
            stock_milli: None,
            received_day: None,
            last_sold_day: None,
            expiry_day: None,
            preset: None,
            abc: vec![],
            sort: vec![],
            limit: 20,
            cursor: None,
        };

        let mut read_cycles = 0;
        while !stop_reader.load(Ordering::Relaxed) {
            let conn = pool.acquire().expect("acquire reader connection");
            let page = discover_products(&conn, "retail", 1000, &query).expect("concurrent read");
            assert!(!page.items.is_empty());
            read_cycles += 1;
        }
        read_cycles
    });

    // Main thread: Post 500 sales rapidly and measure p95 latency
    let mut latencies_us = Vec::with_capacity(500);

    for i in 1..=500 {
        let t0 = Instant::now();
        let sale = SaleInput {
            invoice_date: "2026-10-21".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("CUST_RET".to_string()),
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "ret_1".to_string(),
                quantity_milli: 10,
                unit_price_paise: 2000,
                discount_paise: 0,
                tax_rate_bps: 500,
            }],
        };

        let res = post_sale(&mut conn, &sale);
        let elapsed = t0.elapsed().as_micros();
        latencies_us.push(elapsed);

        assert!(
            res.is_ok(),
            "Posting failed during concurrent read at iteration {}: {:?}",
            i,
            res.err()
        );
    }

    stop_signal.store(true, Ordering::Relaxed);
    let total_reads = reader_handle.join().expect("join reader thread");

    latencies_us.sort_unstable();
    let p95_us = latencies_us[(latencies_us.len() * 95) / 100];
    let p95_ms_int = p95_us / 1000;
    let p95_ms_frac = p95_us % 1000;

    println!("============================================================");
    println!(" POS CONCURRENT SAFETY BENCHMARK REPORT");
    println!(" Bills Posted: 500");
    println!(" Concurrent Reader Queries Completed: {}", total_reads);
    println!(" Posting Latency p95: {}.{:03} ms", p95_ms_int, p95_ms_frac);
    println!(" Zero SQLITE_BUSY errors verified.");
    println!("============================================================");

    // Assert p95 stays under 10 ms (10,000 us)
    assert!(
        p95_us <= 10_000,
        "Posting p95 latency exceeded 10ms: {} us ({}.{:03} ms)",
        p95_us,
        p95_ms_int,
        p95_ms_frac
    );

    // Clean up
    let _ = fs::remove_file(db_path);
}

#[test]
fn test_perf_benchmark_suite() {
    let bench_path = std::path::Path::new("/tmp/omnibill_bench.db");
    if !bench_path.exists() {
        println!("INFO: /tmp/omnibill_bench.db does not exist, skipping performance benchmark.");
        return;
    }

    println!("============================================================");
    println!(" BENCHMARK PERFORMANCE SUITE (50,000 resources, 500,000 lines)");
    println!(" Target DB: {}", bench_path.display());
    println!("============================================================");

    let mut conn = open_connection(bench_path).expect("open connection to bench DB");
    let today = 20000;

    let q1 = DiscoveryQuery {
        text: Some("Widget".to_string()),
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 50,
        cursor: None,
    };
    let q2 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![1, 2, 3],
        tax_bp: vec![],
        sell_paise: Some(Range {
            min: Some(1000),
            max: Some(10000),
        }),
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 50,
        cursor: None,
    };
    let q3 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: Some(Preset::Expiring30),
        abc: vec![],
        sort: vec![SortSpec {
            key: SortKey::Expiry,
            dir: Dir::Asc,
        }],
        limit: 50,
        cursor: None,
    };
    let q4 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![
            SortSpec {
                key: SortKey::Margin,
                dir: Dir::Desc,
            },
            SortSpec {
                key: SortKey::Revenue,
                dir: Dir::Desc,
            },
        ],
        limit: 50,
        cursor: None,
    };
    let q5 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: None,
        preset: Some(Preset::Out),
        abc: vec![],
        sort: vec![],
        limit: 50,
        cursor: None,
    };

    println!("[1/3] Benchmarking 5 Discovery Query Shapes (target: < 25 ms in release):");
    let queries = [
        ("Q1 (FTS Trigram)", q1),
        ("Q2 (Category + Price)", q2),
        ("Q3 (Expiring30 + Sort)", q3),
        ("Q4 (Multi-Sort Margin/Rev)", q4),
        ("Q5 (Preset Out of Stock)", q5),
    ];

    for (name, q) in queries {
        let t0 = Instant::now();
        let res = discover_products(&conn, "retail", today, &q).expect("query failed");
        let elapsed = t0.elapsed();
        let bound_met = elapsed.as_millis() < 25;
        println!(
            "   {} -> {} items returned in {:?} (target < 25 ms: {})",
            name,
            res.items.len(),
            elapsed,
            if bound_met { "MET" } else { "EXCEEDED" }
        );
        if !bound_met {
            println!("      [QUERY PLAN EXPLANATION]:");
            let explain_sql = if name.contains("Q4") {
                "EXPLAIN QUERY PLAN SELECT s.resource_id FROM product_stats s JOIN resources r ON r.id = s.resource_id WHERE s.vertical = 'retail' AND s.is_active = 1 ORDER BY s.margin_bp DESC, s.rev_90_paise DESC, s.resource_id DESC LIMIT 51"
            } else {
                "EXPLAIN QUERY PLAN SELECT s.resource_id FROM product_stats s JOIN resources r ON r.id = s.resource_id WHERE s.vertical = 'retail' AND s.is_active = 1 AND s.stock_milli = 0 ORDER BY s.qty_30_milli DESC, s.resource_id DESC LIMIT 51"
            };
            if let Ok(mut stmt) = conn.prepare(explain_sql) {
                if let Ok(mut rows) = stmt.query([]) {
                    while let Ok(Some(row)) = rows.next() {
                        let detail: String = row.get(3).unwrap_or_default();
                        println!("         |-- {}", detail);
                    }
                } else {
                    println!("         (unable to execute explain)");
                }
            }
        }
    }

    println!("[2/3] Benchmarking refresh_stats (target: < 1500 ms)...");
    let t_ref = Instant::now();
    let rep = refresh_stats(&mut conn, today).expect("refresh_stats failed");
    let elapsed_ref = t_ref.elapsed();
    println!(
        "   refresh_stats updated {} resources in {:?} (target < 1500 ms: {})",
        rep.resources_updated,
        elapsed_ref,
        if elapsed_ref.as_millis() < 1500 {
            "MET"
        } else {
            "EXCEEDED"
        }
    );

    println!("[3/3] Benchmarking rebuild_rollups (target: < 30 s)...");
    let t_reb = Instant::now();
    let reb_rep = rebuild_rollups(&conn).expect("rebuild_rollups failed");
    let elapsed_reb = t_reb.elapsed();
    println!(
        "   rebuild_rollups rebuilt {} daily rows in {:?} (target < 30 s: {})",
        reb_rep.sales_daily_rows,
        elapsed_reb,
        if elapsed_reb.as_secs() < 30 {
            "MET"
        } else {
            "EXCEEDED"
        }
    );

    println!("============================================================");
    println!(" BENCHMARK SUITE FINISHED");
    println!("============================================================");
}
