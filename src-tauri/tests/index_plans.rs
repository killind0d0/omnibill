use omnibill_core::database::{
    migrations::{run_migrations, MIGRATIONS},
    open_connection,
};
use omnibill_core::discovery::fts::rebuild_fts;
use rusqlite::params;

fn explain_query_plan(conn: &rusqlite::Connection, sql: &str) -> String {
    let mut stmt = conn
        .prepare(&format!("EXPLAIN QUERY PLAN {}", sql))
        .expect("prepare explain query plan");
    let rows = stmt
        .query_map([], |row| {
            // detail is in column 3
            let detail: String = row.get(3)?;
            Ok(detail)
        })
        .expect("query map explain");

    let mut plan = String::new();
    for r in rows {
        let detail = r.expect("read detail");
        plan.push_str(&detail);
        plan.push('\n');
    }
    plan
}

#[test]
fn test_index_plans_verify_query_optimization() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_index_plans_{}.db", std::process::id()));
    if db_path.exists() {
        let _ = std::fs::remove_file(&db_path);
    }

    let mut conn = open_connection(&db_path).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    // Seed small database with 2,000 resources and product_stats
    conn.execute_batch(
        "PRAGMA synchronous = OFF;
         PRAGMA journal_mode = MEMORY;",
    )
    .expect("pragmas");

    let tx = conn.transaction().expect("begin tx");
    {
        // 1. Insert brands and suppliers
        for b in 1..=50 {
            tx.execute(
                "INSERT INTO brands (id, name, manufacturer) VALUES (?1, ?2, ?3)",
                params![b, format!("Brand_{}", b), format!("Mfg_{}", b)],
            )
            .expect("insert brand");
        }

        for s in 1..=20 {
            tx.execute(
                "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
                 VALUES (?1, ?2, 'SUPPLIER', ?3, '07')",
                params![
                    format!("SUP_{:03}", s),
                    format!("CODE_SUP_{:03}", s),
                    format!("Supplier_{:03}", s)
                ],
            )
            .expect("insert supplier");
        }

        // 2. Insert resources, product_stats, resource_lots
        let mut stmt_res = tx
            .prepare(
                "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, brand_id, barcode)
                 VALUES (?1, ?2, ?3, '30049099', 1800, 1000, 600, 1, 1, ?4, ?5)",
            )
            .expect("prepare res");

        let mut stmt_stats = tx
            .prepare(
                "INSERT INTO product_stats (
                    resource_id, vertical, is_active, brand_id, category_id, tax_bp,
                    sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
                    max_stock_milli, stock_value_paise, earliest_expiry_day, last_sold_day, stats_day
                 ) VALUES (
                    ?1, ?2, 1, ?3, ?4, 1800,
                    1000, 600, ?5, ?6, 5000,
                    50000, 60000, ?7, ?8, 20000
                 )",
            )
            .expect("prepare stats");

        let mut stmt_lot = tx
            .prepare(
                "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day)
                 VALUES (?1, ?2, ?3, '2028-12-31', 1200, 600, ?4, 19800)",
            )
            .expect("prepare lot");

        let verticals = ["retail", "wholesale", "hospital"];

        for i in 1..=2000 {
            let res_id = format!("{}", i);
            let sku = format!("SKU_{:05}", i);
            let name = format!("Product_{:05}", i);
            let brand_id = (i % 50) + 1;
            let barcode = format!("BC_{:06}", i);
            let vert = verticals[i % 3];
            let margin = 4000 - (i as i64);
            let stock = if i % 10 == 0 { 0 } else { 10_000 };
            let expiry_day = 20100 + (i as i64);
            let last_sold = 19990 + ((i % 10) as i64);

            stmt_res
                .execute(params![res_id, sku, name, brand_id, barcode])
                .expect("insert res");

            stmt_stats
                .execute(params![
                    res_id,
                    vert,
                    brand_id,
                    (i % 10) + 1,
                    margin,
                    stock,
                    expiry_day,
                    last_sold
                ])
                .expect("insert stats");

            let lot_id = format!("LOT_{:05}", i);
            let sup_id = format!("SUP_{:03}", (i % 20) + 1);
            stmt_lot
                .execute(params![lot_id, res_id, format!("B_{}", i), sup_id])
                .expect("insert lot");
        }
    }
    tx.commit().expect("commit");

    rebuild_fts(&conn).expect("rebuild fts");
    conn.execute("ANALYZE", []).expect("analyze");

    // 1. Query 1: Brand filter
    let q1 = "SELECT resource_id FROM product_stats WHERE vertical='retail' AND is_active=1 AND brand_id IN (1, 2)";
    let p1 = explain_query_plan(&conn, q1);
    println!("--- Plan 1 (Brand Filter) ---\n{}", p1);
    assert!(
        !p1.contains("SCAN product_stats\n"),
        "Must not do unindexed SCAN product_stats"
    );
    assert!(
        p1.contains("ps_vert_brand"),
        "Plan must use ps_vert_brand index"
    );

    // 2. Query 2: Expiry filter
    let q2 = "SELECT resource_id FROM product_stats WHERE vertical='retail' AND is_active=1 AND earliest_expiry_day <= 20500 AND stock_milli>0";
    let p2 = explain_query_plan(&conn, q2);
    println!("--- Plan 2 (Expiry Filter) ---\n{}", p2);
    assert!(
        !p2.contains("SCAN product_stats\n"),
        "Must not do unindexed SCAN product_stats"
    );
    assert!(
        p2.contains("ps_vert_expiry"),
        "Plan must use ps_vert_expiry index"
    );

    // 3. Query 3: Margin order
    let q3 = "SELECT resource_id FROM product_stats WHERE vertical='retail' AND is_active=1 ORDER BY margin_bp DESC, resource_id DESC LIMIT 50";
    let p3 = explain_query_plan(&conn, q3);
    println!("--- Plan 3 (Margin Order) ---\n{}", p3);
    assert!(
        !p3.contains("SCAN product_stats\n"),
        "Must not do unindexed SCAN product_stats"
    );
    assert!(
        p3.contains("ps_vert_margin"),
        "Plan must use ps_vert_margin index"
    );

    // 4. Query 4: FTS5 MATCH
    let q4 = "SELECT rowid FROM products_fts WHERE products_fts MATCH 'Product'";
    let p4 = explain_query_plan(&conn, q4);
    println!("--- Plan 4 (FTS5 Match) ---\n{}", p4);
    assert!(
        p4.contains("products_fts"),
        "Plan must use products_fts virtual table"
    );

    // 5. Query 5: Lots supplier index
    let q5 = "SELECT 1 FROM resource_lots WHERE supplier_id='SUP_001' AND resource_id='1'";
    let p5 = explain_query_plan(&conn, q5);
    println!("--- Plan 5 (Lots Supplier) ---\n{}", p5);
    assert!(
        p5.contains("lots_supplier"),
        "Plan must use lots_supplier index"
    );

    // 6. Query 6: Barcode lookup
    let q6 = "SELECT id FROM resources WHERE barcode='BC_000001'";
    let p6 = explain_query_plan(&conn, q6);
    println!("--- Plan 6 (Barcode Index) ---\n{}", p6);
    assert!(
        p6.contains("res_barcode"),
        "Plan must use res_barcode index"
    );

    drop(conn);
    let _ = std::fs::remove_file(db_path);
}
