use omnibill_core::database::{
    migrations::{run_migrations, MIGRATIONS},
    open_connection,
    queries::verify_ledger,
};
use omnibill_core::discovery::rollup::{rebuild_rollups, RebuildReport};
use omnibill_core::posting::{
    post_sale, post_sale_return, returns::cancel_posted_sale, LineInput, PriceMode, SaleInput,
    SaleReturnInput,
};
use rusqlite::params;
use std::time::Instant;

struct Lcg {
    state: u64,
}

impl Lcg {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self
            .state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.state
    }

    fn next_range(&mut self, min: i64, max: i64) -> i64 {
        if max <= min {
            return min;
        }
        let range = (max - min + 1) as u64;
        min + (self.next_u64() % range) as i64
    }
}

#[derive(Debug, PartialEq, Eq)]
struct SalesDailyRow {
    resource_id: String,
    day: i64,
    qty_milli: i64,
    net_paise: i64,
    cogs_paise: i64,
    bills: i64,
}

#[derive(Debug, PartialEq, Eq)]
struct SalesHeatRow {
    day: i64,
    hour: i64,
    bills: i64,
    net_paise: i64,
}

#[derive(Debug, PartialEq, Eq)]
struct ProductStatsPointRow {
    resource_id: String,
    stock_milli: i64,
    stock_value_paise: i64,
    last_sold_day: i64,
}

fn snapshot_rollups(
    conn: &rusqlite::Connection,
) -> (
    Vec<SalesDailyRow>,
    Vec<SalesHeatRow>,
    Vec<ProductStatsPointRow>,
) {
    let mut stmt_daily = conn
        .prepare(
            "SELECT resource_id, day, qty_milli, net_paise, cogs_paise, bills
             FROM sales_daily
             ORDER BY resource_id ASC, day ASC",
        )
        .expect("prep daily");
    let daily_rows = stmt_daily
        .query_map([], |r| {
            Ok(SalesDailyRow {
                resource_id: r.get(0)?,
                day: r.get(1)?,
                qty_milli: r.get(2)?,
                net_paise: r.get(3)?,
                cogs_paise: r.get(4)?,
                bills: r.get(5)?,
            })
        })
        .expect("query daily")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect daily");

    let mut stmt_heat = conn
        .prepare(
            "SELECT day, hour, bills, net_paise
             FROM sales_heat
             ORDER BY day ASC, hour ASC",
        )
        .expect("prep heat");
    let heat_rows = stmt_heat
        .query_map([], |r| {
            Ok(SalesHeatRow {
                day: r.get(0)?,
                hour: r.get(1)?,
                bills: r.get(2)?,
                net_paise: r.get(3)?,
            })
        })
        .expect("query heat")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect heat");

    let mut stmt_stats = conn
        .prepare(
            "SELECT resource_id, stock_milli, stock_value_paise, last_sold_day
             FROM product_stats
             ORDER BY resource_id ASC",
        )
        .expect("prep stats");
    let stats_rows = stmt_stats
        .query_map([], |r| {
            Ok(ProductStatsPointRow {
                resource_id: r.get(0)?,
                stock_milli: r.get(1)?,
                stock_value_paise: r.get(2)?,
                last_sold_day: r.get(3)?,
            })
        })
        .expect("query stats")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect stats");

    (daily_rows, heat_rows, stats_rows)
}

#[test]
fn test_rollup_reconcile_and_rebuild() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_reconcile_{}.db", std::process::id()));
    if db_path.exists() {
        let _ = std::fs::remove_file(&db_path);
    }

    let mut conn = open_connection(&db_path).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let mut lcg = Lcg::new(999);

    // 1. Setup seed user, supplier, and customer
    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role)
         VALUES ('usr_reconcile', 'admin', 'hash', 'Admin', 'ADMIN')",
        [],
    )
    .expect("user");

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
         VALUES ('SUP_REC_1', 'SUP_1', 'SUPPLIER', 'Supplier One', '27')",
        [],
    )
    .expect("supplier");

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
         VALUES ('CUST_REC_1', 'CUST_1', 'CUSTOMER', 'Customer One', '27')",
        [],
    )
    .expect("customer");

    // 2. Create 20 resources and 40 lots (2 lots each)
    let mut resource_ids = Vec::new();
    for r in 1..=20 {
        let res_id = format!("res_rec_{:02}", r);
        let sku = format!("SKU_REC_{:02}", r);
        let name = format!("Rec_Product_{:02}", r);
        let base_paise = lcg.next_range(5000, 20000);
        let cost_paise = lcg.next_range(2000, base_paise - 500);

        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active)
             VALUES (?1, ?2, ?3, '30049099', 1800, ?4, ?5, 1, 1)",
            params![res_id, sku, name, base_paise, cost_paise],
        )
        .expect("insert res");

        // Lot 1
        let lot1_id = format!("lot_rec_{:02}_a", r);
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day)
             VALUES (?1, ?2, 'BATCH_A', '2028-06-30', ?3, ?4, 'SUP_REC_1', 19800)",
            params![lot1_id, res_id, base_paise + 500, cost_paise],
        )
        .expect("insert lot 1");

        // Lot 2
        let lot2_id = format!("lot_rec_{:02}_b", r);
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day)
             VALUES (?1, ?2, 'BATCH_B', '2028-12-31', ?3, ?4, 'SUP_REC_1', 19850)",
            params![lot2_id, res_id, base_paise + 500, cost_paise],
        )
        .expect("insert lot 2");

        // Seed initial stock in stock_movements for each lot (50,000 milli = 50 units)
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES (?1, ?2, ?3, NULL, 'PURCHASE', 50000)",
            params![format!("sm_init_{}_a", r), res_id, lot1_id],
        )
        .expect("init stock a");

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES (?1, ?2, ?3, NULL, 'PURCHASE', 50000)",
            params![format!("sm_init_{}_b", r), res_id, lot2_id],
        )
        .expect("init stock b");

        resource_ids.push(res_id);
    }

    // 3. Post 300 random sales across two days
    let days = ["2026-04-10", "2026-04-11"];
    let mut posted_sales = Vec::new();

    for i in 1..=300 {
        let date = days[i % 2];
        let num_lines = lcg.next_range(1, 3) as usize;
        let mut lines = Vec::new();

        for j in 0..num_lines {
            let res_idx = (i + j) % resource_ids.len();
            let res_id = &resource_ids[res_idx];
            let qty = lcg.next_range(100, 500); // 0.1 to 0.5 units
            let unit_price = lcg.next_range(5000, 20000);
            let discount = lcg.next_range(0, 500);

            lines.push(LineInput {
                resource_id: res_id.clone(),
                quantity_milli: qty,
                unit_price_paise: unit_price,
                discount_paise: discount,
                tax_rate_bps: 1800,
            });
        }

        let sale_input = SaleInput {
            invoice_date: date.to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: Some("CUST_REC_1".to_string()),
            price_mode: PriceMode::Exclusive,
            lines,
        };

        let posted = post_sale(&mut conn, &sale_input).expect("post sale");
        posted_sales.push((posted, sale_input));
    }

    // 4. Cancel 30 of them
    for i in 0..30 {
        let (sale, _) = &posted_sales[i * 8]; // spread across the 300
        cancel_posted_sale(&mut conn, &sale.transaction_id).expect("cancel sale");
    }

    // 5. Process 15 partial returns on non-cancelled sales
    for i in 0..15 {
        let (sale, input) = &posted_sales[i * 8 + 1];
        let ret_lines = vec![LineInput {
            resource_id: input.lines[0].resource_id.clone(),
            quantity_milli: input.lines[0].quantity_milli / 2, // partial half quantity
            unit_price_paise: input.lines[0].unit_price_paise,
            discount_paise: 0,
            tax_rate_bps: input.lines[0].tax_rate_bps,
        }];

        let ret_input = SaleReturnInput {
            return_date: "2026-04-12".to_string(),
            original_transaction_id: sale.transaction_id.clone(),
            reason: Some("Partial Customer Return".to_string()),
            lines: ret_lines,
        };

        post_sale_return(&mut conn, &ret_input).expect("post return");
    }

    // 6. Snapshot rollups live state
    let (snap_daily, snap_heat, snap_stats) = snapshot_rollups(&conn);

    // 7. Run rebuild_rollups
    let report: RebuildReport = rebuild_rollups(&conn).expect("rebuild rollups");
    println!("Rebuild Report: {:?}", report);

    // 8. Snapshot rollups rebuilt state
    let (rebuilt_daily, rebuilt_heat, rebuilt_stats) = snapshot_rollups(&conn);

    // Assert snapshots are identical row for row
    assert_eq!(
        snap_daily, rebuilt_daily,
        "sales_daily snapshot must be identical row-for-row after rebuild"
    );
    assert_eq!(
        snap_heat, rebuilt_heat,
        "sales_heat snapshot must be identical row-for-row after rebuild"
    );
    assert_eq!(
        snap_stats, rebuilt_stats,
        "product_stats point fields snapshot must be identical row-for-row after rebuild"
    );

    // 9. Independent ledger verification:
    // Assert sum of sales_daily.net_paise equals net revenue posted to Sales Revenue account (acc_4000) minus returns (acc_4010)
    let rollup_net_sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(net_paise), 0) FROM sales_daily",
            [],
            |r| r.get(0),
        )
        .expect("sum rollup net");

    let ledger_net_sum: i64 = conn
        .query_row(
            "SELECT
                 COALESCE(SUM(le.credit_paise - le.debit_paise), 0)
             FROM ledger_entries le
             JOIN transactions t ON t.id = le.transaction_id
             WHERE le.account_id IN ('acc_4000', 'acc_4010') AND t.status = 'POSTED'",
            [],
            |r| r.get(0),
        )
        .expect("sum ledger net");

    println!(
        "Rollup Net Sum: {} paise | Ledger Net Sum: {} paise",
        rollup_net_sum, ledger_net_sum
    );
    assert_eq!(
        rollup_net_sum, ledger_net_sum,
        "sales_daily.net_paise sum must match independent double-entry ledger calculation"
    );

    // 10. Books balance verification using verify_ledger
    let discrepancies = verify_ledger(&conn).expect("verify ledger");
    assert!(
        discrepancies.is_empty(),
        "Double-entry ledger books must strictly balance: {:?}",
        discrepancies
    );

    drop(conn);
    let _ = std::fs::remove_file(db_path);
}

#[test]
fn test_rollup_reconcile_micro_benchmark_overhead() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_bench_overhead_{}.db", std::process::id()));
    if db_path.exists() {
        let _ = std::fs::remove_file(&db_path);
    }

    let mut conn = open_connection(&db_path).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role)
         VALUES ('usr_bench', 'admin', 'hash', 'Admin', 'ADMIN')",
        [],
    )
    .expect("user");

    conn.execute(
        "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
         VALUES ('SUP_BENCH', 'S1', 'SUPPLIER', 'Supplier', '27')",
        [],
    )
    .expect("sup");

    // Seed 10 resources with lots
    for i in 1..=10 {
        let rid = format!("res_b_{}", i);
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active)
             VALUES (?1, ?2, 'Bench Item', '30049099', 1800, 1000, 600, 1, 1)",
            params![rid, format!("SKU_B_{}", i)],
        )
        .expect("res");

        let lid = format!("lot_b_{}", i);
        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day)
             VALUES (?1, ?2, 'B1', '2028-12-31', 1200, 600, 'SUP_BENCH', 20000)",
            params![lid, rid],
        )
        .expect("lot");

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES (?1, ?2, ?3, NULL, 'PURCHASE', 5000000)",
            params![format!("sm_b_{}", i), rid, lid],
        )
        .expect("stock");
    }

    // Post 1,000 bills of 5 lines each
    let start_all = Instant::now();
    let num_bills = 1000;
    for b in 1..=num_bills {
        let lines: Vec<LineInput> = (1..=5)
            .map(|l| LineInput {
                resource_id: format!("res_b_{}", ((b + l) % 10) + 1),
                quantity_milli: 1000,
                unit_price_paise: 1000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            })
            .collect();

        let input = SaleInput {
            invoice_date: "2026-04-15".to_string(),
            seller_state_code: "27".to_string(),
            place_of_supply_state_code: "27".to_string(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines,
        };

        post_sale(&mut conn, &input).expect("post bill");
    }
    let elapsed = start_all.elapsed();
    let avg_us = elapsed.as_micros() / (num_bills as u128);
    println!(
        "Posted {} bills (5 lines each) in {:?}. Average per bill: {} µs",
        num_bills, elapsed, avg_us,
    );

    // Assert rollup overhead is well within limits (average posting time per bill well under generous debug bound of 30 ms)
    assert!(
        avg_us < 30_000,
        "Average bill posting time (including rollups) must be below 30ms: {} µs",
        avg_us
    );

    drop(conn);
    let _ = std::fs::remove_file(db_path);
}
