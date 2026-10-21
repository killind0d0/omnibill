use omnibill_core::database::{
    migrations::{run_migrations, LATEST_VERSION, MIGRATIONS},
    open_connection,
};
use rusqlite::params;
use std::collections::HashSet;

fn get_table_columns(conn: &rusqlite::Connection, table: &str) -> HashSet<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .expect("prepare PRAGMA table_info");
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query_map");
    let mut cols = HashSet::new();
    for col in rows {
        cols.insert(col.expect("column name"));
    }
    cols
}

#[test]
fn test_migration_discovery_fresh_db_all_migrations_and_schema_verification() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_d1a_fresh_{}.db", std::process::id()));
    if db_path.exists() {
        let _ = std::fs::remove_file(&db_path);
    }

    let mut conn = open_connection(&db_path).expect("open connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run all migrations");

    // 1. Assert user_version matches LATEST_VERSION (5)
    let user_version: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("query user_version");
    assert_eq!(user_version, 5);
    assert_eq!(LATEST_VERSION, 5);

    // 2. Assert brands table exists with expected columns
    let brands_cols = get_table_columns(&conn, "brands");
    assert!(brands_cols.contains("id"), "brands.id missing");
    assert!(brands_cols.contains("name"), "brands.name missing");
    assert!(
        brands_cols.contains("manufacturer"),
        "brands.manufacturer missing"
    );

    // 3. Assert resources new columns
    let res_cols = get_table_columns(&conn, "resources");
    assert!(res_cols.contains("brand_id"), "resources.brand_id missing");
    assert!(
        res_cols.contains("is_critical"),
        "resources.is_critical missing"
    );

    // 4. Assert resource_lots new columns
    let lot_cols = get_table_columns(&conn, "resource_lots");
    assert!(
        lot_cols.contains("supplier_id"),
        "resource_lots.supplier_id missing"
    );
    assert!(
        lot_cols.contains("received_day"),
        "resource_lots.received_day missing"
    );

    // 5. Assert transaction_items new columns
    let item_cols = get_table_columns(&conn, "transaction_items");
    assert!(
        item_cols.contains("lot_id"),
        "transaction_items.lot_id missing"
    );
    assert!(
        item_cols.contains("cogs_paise"),
        "transaction_items.cogs_paise missing"
    );
    assert!(
        item_cols.contains("business_day"),
        "transaction_items.business_day missing"
    );

    // 6. Assert sales_daily table exists with expected columns
    let sales_daily_cols = get_table_columns(&conn, "sales_daily");
    for col in &[
        "resource_id",
        "day",
        "qty_milli",
        "net_paise",
        "cogs_paise",
        "bills",
    ] {
        assert!(
            sales_daily_cols.contains(*col),
            "sales_daily.{} missing",
            col
        );
    }

    // 7. Assert sales_heat table exists with expected columns
    let sales_heat_cols = get_table_columns(&conn, "sales_heat");
    for col in &["day", "hour", "bills", "net_paise"] {
        assert!(sales_heat_cols.contains(*col), "sales_heat.{} missing", col);
    }

    // 8. Assert inventory_daily table exists with expected columns
    let inv_daily_cols = get_table_columns(&conn, "inventory_daily");
    for col in &["resource_id", "day", "stock_milli", "value_paise"] {
        assert!(
            inv_daily_cols.contains(*col),
            "inventory_daily.{} missing",
            col
        );
    }

    // 9. Assert product_stats table exists with expected columns
    let stats_cols = get_table_columns(&conn, "product_stats");
    let expected_stats_cols = [
        "resource_id",
        "vertical",
        "is_active",
        "brand_id",
        "category_id",
        "tax_bp",
        "sell_paise",
        "avg_cost_paise",
        "margin_bp",
        "stock_milli",
        "reorder_milli",
        "max_stock_milli",
        "stock_value_paise",
        "first_received_day",
        "last_received_day",
        "last_supplier_id",
        "earliest_expiry_day",
        "last_sold_day",
        "qty_7_milli",
        "qty_30_milli",
        "qty_90_milli",
        "rev_90_paise",
        "gp_90_paise",
        "runout_days_x10",
        "gmroi_bp",
        "abc_class",
        "stats_day",
    ];
    for col in &expected_stats_cols {
        assert!(stats_cols.contains(*col), "product_stats.{} missing", col);
    }

    // 10. Assert PRAGMA foreign_key_check returns no rows
    {
        let mut fk_stmt = conn
            .prepare("PRAGMA foreign_key_check")
            .expect("prepare fk check");
        let fk_rows = fk_stmt.query_map([], |_r| Ok(())).expect("query fk check");
        assert_eq!(
            fk_rows.count(),
            0,
            "foreign_key_check must return 0 violations"
        );
    }

    // 11. Assert PRAGMA integrity_check returns "ok"
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .expect("integrity_check");
    assert_eq!(integrity, "ok");

    drop(conn);
    let _ = std::fs::remove_file(db_path);
}

#[test]
fn test_migration_discovery_upgrade_from_v4_with_data_intact_and_defaults() {
    let temp_dir = std::env::temp_dir();
    let db_path = temp_dir.join(format!("omnibill_d1a_upgrade_{}.db", std::process::id()));
    if db_path.exists() {
        let _ = std::fs::remove_file(&db_path);
    }

    let mut conn = open_connection(&db_path).expect("open connection");

    // 1. Run migrations 1 through 4 (previous latest)
    let v4_migrations = &MIGRATIONS[..4];
    run_migrations(&mut conn, v4_migrations).expect("run v4 migrations");

    let v4_version: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("v4 user_version");
    assert_eq!(v4_version, 4);

    // 2. Insert one resource row and one lot row using only columns that exist in v4
    let res_id = "test-res-d1a-001";
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active)
         VALUES (?1, 'SKU-D1A', 'D1A Test Product', '30049099', 1800, 10000, 7000, 1, 1)",
        params![res_id],
    ).expect("insert test resource v4");

    let lot_id = "test-lot-d1a-001";
    conn.execute(
        "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise)
         VALUES (?1, ?2, 'BATCH-D1A', '2028-12-31', 12000, 6500)",
        params![lot_id, res_id],
    ).expect("insert test lot v4");

    // 3. Apply full migrations (migrating to v5)
    run_migrations(&mut conn, MIGRATIONS).expect("migrate from v4 to v5");

    let v5_version: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("v5 user_version");
    assert_eq!(v5_version, 5);

    // 4. Assert old rows are intact and new columns hold their defaults
    let (name, brand_id, is_critical): (String, Option<i64>, i64) = conn
        .query_row(
            "SELECT name, brand_id, is_critical FROM resources WHERE id = ?1",
            params![res_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("query resource after v5 migration");
    assert_eq!(name, "D1A Test Product");
    assert_eq!(brand_id, None, "brand_id default must be NULL");
    assert_eq!(is_critical, 0, "is_critical default must be 0");

    let (batch, supplier_id, received_day): (String, Option<String>, i64) = conn
        .query_row(
            "SELECT batch_number, supplier_id, received_day FROM resource_lots WHERE id = ?1",
            params![lot_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("query lot after v5 migration");
    assert_eq!(batch, "BATCH-D1A");
    assert_eq!(supplier_id, None, "supplier_id default must be NULL");
    assert_eq!(received_day, 0, "received_day default must be 0");

    // 5. Assert PRAGMA foreign_key_check and integrity_check
    {
        let mut fk_stmt = conn
            .prepare("PRAGMA foreign_key_check")
            .expect("prepare fk check");
        let fk_rows = fk_stmt.query_map([], |_r| Ok(())).expect("query fk check");
        assert_eq!(fk_rows.count(), 0);
    }

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .expect("integrity_check");
    assert_eq!(integrity, "ok");

    drop(conn);
    let _ = std::fs::remove_file(db_path);
}
