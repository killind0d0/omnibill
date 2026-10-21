use omnibill_core::database::{
    migrations::{run_migrations, MIGRATIONS},
    open_connection,
};
use omnibill_core::discovery::cursor::CursorError;
use omnibill_core::discovery::facets::discover_facets;
use omnibill_core::discovery::fts::rebuild_fts;
use omnibill_core::discovery::query::{
    discover_products, Dir, DiscoveryQuery, Preset, QueryError, Range, SortKey, SortSpec,
};
use rusqlite::params;
use std::collections::HashSet;
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

#[allow(dead_code)]
struct TestItem {
    id: String,
    name: String,
    brand_id: i64,
    category_id: i64,
    tax_bp: i64,
    sell_paise: i64,
    cost_paise: i64,
    margin_bp: i64,
    stock_milli: i64,
    reorder_milli: i64,
    max_stock_milli: i64,
    supplier_id: i64,
    earliest_expiry_day: i64,
    last_sold_day: i64,
    last_received_day: i64,
    qty_30_milli: i64,
    abc_class: u8,
    vertical: String,
}

fn seed_test_catalog(conn: &mut rusqlite::Connection, count: usize) -> Vec<TestItem> {
    let tx = conn.transaction().unwrap();
    let mut items = Vec::with_capacity(count);

    // Seed 10 brands
    for b in 1..=10 {
        tx.execute(
            "INSERT INTO brands (id, name, manufacturer) VALUES (?1, ?2, ?3)",
            params![b, format!("Brand_{:02}", b), format!("Mfg_{:02}", b)],
        )
        .unwrap();
    }

    // Seed 8 suppliers
    for s in 1..=8 {
        tx.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES (?1, ?2, 'SUPPLIER', ?3, '07')",
            params![
                s.to_string(),
                format!("CODE_SUP_{}", s),
                format!("Supplier_{:02}", s)
            ],
        )
        .unwrap();
    }

    for i in 0..count {
        let is_hospital = i >= 450;
        let vertical = if is_hospital { "hospital" } else { "retail" };
        let res_id = format!("res_{:04}", i);
        let sku = format!("SKU_{:04}", i);
        let name = format!("Item {:04} Med_{}", i, (i % 5) + 1);
        let barcode = if i % 10 == 0 {
            Some(format!("89012345{:04}", i))
        } else {
            None
        };
        let brand_id = ((i % 10) + 1) as i64;
        let category_id = ((i % 5) + 1) as i64;
        let tax_bp = [500, 1200, 1800, 2800][i % 4];
        let sell_paise = ((i as i64 + 1) * 1000) % 200_000 + 5000;
        let cost_paise = (sell_paise * 70) / 100;
        let margin_bp = 3000;
        let stock_milli = (i as i64 % 20) * 1000;
        let reorder_milli = 2000;
        let max_stock_milli = 15000;
        let supplier_id = ((i % 8) + 1) as i64;
        let earliest_expiry_day = 20000 + (i as i64 % 100);
        let last_received_day = 100 - (i as i64 % 50);
        let last_sold_day = 100 - (i as i64 % 30);
        let qty_30_milli = (i as i64 % 15) * 1000;
        let abc_class = ((i % 3) as u8) + 1;

        tx.execute(
            "INSERT INTO resources (id, sku_or_code, name, barcode, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, brand_id)
             VALUES (?1, ?2, ?3, ?4, '3004', ?5, ?6, ?7, 1, 1, ?8)",
            params![res_id, sku, name, barcode, tax_bp, sell_paise, cost_paise, brand_id],
        ).unwrap();

        let stock_val = (stock_milli * cost_paise) / 1000;
        tx.execute(
            "INSERT INTO product_stats (
                resource_id, vertical, is_active, brand_id, category_id, tax_bp,
                sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
                max_stock_milli, stock_value_paise, first_received_day, last_received_day,
                last_supplier_id, earliest_expiry_day, last_sold_day, qty_7_milli,
                qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10,
                gmroi_bp, abc_class, stats_day
             ) VALUES (
                ?1, ?2, 1, ?3, ?4, ?5,
                ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?13,
                ?14, ?15, ?16, 0,
                ?17, ?17, 10000, 3000, 600,
                1500, ?18, 100
             )",
            params![
                res_id,
                vertical,
                brand_id,
                category_id,
                tax_bp,
                sell_paise,
                cost_paise,
                margin_bp,
                stock_milli,
                reorder_milli,
                max_stock_milli,
                stock_val,
                last_received_day,
                supplier_id.to_string(),
                earliest_expiry_day,
                last_sold_day,
                qty_30_milli,
                abc_class as i64
            ],
        )
        .unwrap();

        let lot_id = format!("lot_{:04}", i);
        let batch = format!("B_{:04}", i);
        tx.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, supplier_id, received_day)
             VALUES (?1, ?2, ?3, '2028-12-31', ?4, ?5, ?6)",
            params![lot_id, res_id, batch, sell_paise, supplier_id.to_string(), last_received_day],
        ).unwrap();

        items.push(TestItem {
            id: res_id,
            name,
            brand_id,
            category_id,
            tax_bp,
            sell_paise,
            cost_paise,
            margin_bp,
            stock_milli,
            reorder_milli,
            max_stock_milli,
            supplier_id,
            earliest_expiry_day,
            last_sold_day,
            last_received_day,
            qty_30_milli,
            abc_class,
            vertical: vertical.to_string(),
        });
    }

    tx.commit().unwrap();
    rebuild_fts(conn).unwrap();
    items
}

#[test]
fn test_discovery_query_filters_match_brute_force() {
    let (mut conn, path) = setup_temp_db("query_filters");
    let all_items = seed_test_catalog(&mut conn, 500);
    let today = 100;

    // 1. Brand filter alone (brands 2 and 4)
    let q_brand = DiscoveryQuery {
        text: None,
        brand_ids: vec![2, 4],
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
        limit: 200,
        cursor: None,
    };
    let page = discover_products(&conn, "retail", today, &q_brand).unwrap();
    let expected_brand: HashSet<String> = all_items
        .iter()
        .filter(|it| it.vertical == "retail" && (it.brand_id == 2 || it.brand_id == 4))
        .map(|it| it.id.clone())
        .collect();
    let actual_brand: HashSet<String> = page.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_brand, expected_brand);

    // 2. Category filter alone (category 3)
    let q_cat = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![3],
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
        limit: 200,
        cursor: None,
    };
    let page_cat = discover_products(&conn, "retail", today, &q_cat).unwrap();
    let expected_cat: HashSet<String> = all_items
        .iter()
        .filter(|it| it.vertical == "retail" && it.category_id == 3)
        .map(|it| it.id.clone())
        .collect();
    let actual_cat: HashSet<String> = page_cat.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_cat, expected_cat);

    // 3. Tax BPS filter alone (1800 bp)
    let q_tax = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![1800],
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
        limit: 200,
        cursor: None,
    };
    let page_tax = discover_products(&conn, "retail", today, &q_tax).unwrap();
    let expected_tax: HashSet<String> = all_items
        .iter()
        .filter(|it| it.vertical == "retail" && it.tax_bp == 1800)
        .map(|it| it.id.clone())
        .collect();
    let actual_tax: HashSet<String> = page_tax.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_tax, expected_tax);

    // 4. Supplier filter alone (supplier 5)
    let q_sup = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![5],
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
        limit: 200,
        cursor: None,
    };
    let page_sup = discover_products(&conn, "retail", today, &q_sup).unwrap();
    let expected_sup: HashSet<String> = all_items
        .iter()
        .filter(|it| it.vertical == "retail" && it.supplier_id == 5)
        .map(|it| it.id.clone())
        .collect();
    let actual_sup: HashSet<String> = page_sup.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_sup, expected_sup);

    // 5. Preset Out (stock == 0)
    let q_out = DiscoveryQuery {
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
        limit: 200,
        cursor: None,
    };
    let page_out = discover_products(&conn, "retail", today, &q_out).unwrap();
    let expected_out: HashSet<String> = all_items
        .iter()
        .filter(|it| it.vertical == "retail" && it.stock_milli == 0)
        .map(|it| it.id.clone())
        .collect();
    let actual_out: HashSet<String> = page_out.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_out, expected_out);

    // 6. Three combined filters: Brand 1 + Category 2 + Tax 1200
    let q_combo = DiscoveryQuery {
        text: None,
        brand_ids: vec![1],
        supplier_ids: vec![],
        category_ids: vec![2],
        tax_bp: vec![1200],
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
        limit: 200,
        cursor: None,
    };
    let page_combo = discover_products(&conn, "retail", today, &q_combo).unwrap();
    let expected_combo: HashSet<String> = all_items
        .iter()
        .filter(|it| {
            it.vertical == "retail" && it.brand_id == 1 && it.category_id == 2 && it.tax_bp == 1200
        })
        .map(|it| it.id.clone())
        .collect();
    let actual_combo: HashSet<String> = page_combo.items.into_iter().map(|it| it.id).collect();
    assert_eq!(actual_combo, expected_combo);

    cleanup_temp_db(&path);
}

#[test]
fn test_discovery_query_keyset_pagination_and_sort_specs() {
    let (mut conn, path) = setup_temp_db("query_pagination");
    let _all_items = seed_test_catalog(&mut conn, 500);
    let today = 100;

    let sort_scenarios = [
        // Scenario 1: Single key Desc
        vec![SortSpec {
            key: SortKey::Velocity,
            dir: Dir::Desc,
        }],
        // Scenario 2: Mixed directions (Velocity Desc, Margin Asc)
        vec![
            SortSpec {
                key: SortKey::Velocity,
                dir: Dir::Desc,
            },
            SortSpec {
                key: SortKey::Margin,
                dir: Dir::Asc,
            },
        ],
        // Scenario 3: Name text sort Asc
        vec![SortSpec {
            key: SortKey::Name,
            dir: Dir::Asc,
        }],
    ];

    for (scenario_idx, sort_spec) in sort_scenarios.into_iter().enumerate() {
        let big_query = DiscoveryQuery {
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
            sort: sort_spec.clone(),
            limit: 200,
            cursor: None,
        };
        let full_page = discover_products(&conn, "retail", today, &big_query).unwrap();
        let full_ids: Vec<String> = full_page.items.into_iter().map(|it| it.id).collect();

        let mut paginated_ids = Vec::new();
        let mut current_cursor = None;

        loop {
            let page_query = DiscoveryQuery {
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
                sort: sort_spec.clone(),
                limit: 37,
                cursor: current_cursor,
            };

            let page_res = discover_products(&conn, "retail", today, &page_query).unwrap();
            let count = page_res.items.len();
            for item in page_res.items {
                paginated_ids.push(item.id);
            }

            if page_res.next_cursor.is_none() || count == 0 {
                break;
            }
            current_cursor = page_res.next_cursor;
        }

        let expected_prefix = &full_ids[..paginated_ids.len().min(full_ids.len())];
        assert_eq!(&paginated_ids[..expected_prefix.len()], expected_prefix);

        let mut seen = HashSet::new();
        for id in &paginated_ids {
            assert!(
                seen.insert(id),
                "Scenario {}: duplicate ID {} found!",
                scenario_idx,
                id
            );
        }
    }

    cleanup_temp_db(&path);
}

#[test]
fn test_discovery_query_mid_pagination_insertion_and_cursor_mismatch() {
    let (mut conn, path) = setup_temp_db("query_mid_insert");
    let _all_items = seed_test_catalog(&mut conn, 100);
    let today = 100;

    let sort = vec![SortSpec {
        key: SortKey::Velocity,
        dir: Dir::Desc,
    }];

    // Page 1 with limit 20
    let q1 = DiscoveryQuery {
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
        sort: sort.clone(),
        limit: 20,
        cursor: None,
    };
    let page1 = discover_products(&conn, "retail", today, &q1).unwrap();
    let page1_ids: HashSet<String> = page1.items.iter().map(|it| it.id.clone()).collect();
    let cursor1 = page1.next_cursor.expect("should have next cursor");

    // Insert a new row with high velocity mid-pagination
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active)
         VALUES ('res_new_999', 'SKU_NEW', 'New Item', '3004', 1800, 50000, 30000, 1, 1)",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO product_stats (
            resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise,
            margin_bp, stock_milli, reorder_milli, max_stock_milli, stock_value_paise,
            qty_30_milli, runout_days_x10, stats_day
         ) VALUES (
            'res_new_999', 'retail', 1, 1800, 50000, 30000,
            4000, 10000, 2000, 15000, 300000,
            999999, 500, 100
         )",
        [],
    )
    .unwrap();

    // Page 2 with cursor from Page 1
    let q2 = DiscoveryQuery {
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
        sort: sort.clone(),
        limit: 20,
        cursor: Some(cursor1.clone()),
    };
    let page2 = discover_products(&conn, "retail", today, &q2).unwrap();

    for item in page2.items {
        assert!(
            !page1_ids.contains(&item.id),
            "Page 2 contained item {} from Page 1!",
            item.id
        );
    }

    // Cursor mismatch test: try passing cursor1 with a DIFFERENT sort spec
    let q_mismatch = DiscoveryQuery {
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
        sort: vec![SortSpec {
            key: SortKey::Margin,
            dir: Dir::Asc,
        }],
        limit: 20,
        cursor: Some(cursor1),
    };
    let err = discover_products(&conn, "retail", today, &q_mismatch).unwrap_err();
    assert!(matches!(
        err,
        QueryError::Cursor(CursorError::CursorMismatch)
    ));

    cleanup_temp_db(&path);
}

#[test]
fn test_discovery_query_injections_isolation_and_clamp() {
    let (mut conn, path) = setup_temp_db("query_injections");
    let _all_items = seed_test_catalog(&mut conn, 500);
    let today = 100;

    // 1. Injection attack: "; DROP TABLE resources; --"
    let q_drop = DiscoveryQuery {
        text: Some("\"; DROP TABLE resources; --".to_string()),
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
    let page_drop = discover_products(&conn, "retail", today, &q_drop).unwrap();
    assert_eq!(page_drop.items.len(), 0);

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM resources", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 500);

    // 2. Injection attack: foo" OR 1=1
    let q_or = DiscoveryQuery {
        text: Some("foo\" OR 1=1".to_string()),
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
    let page_or = discover_products(&conn, "retail", today, &q_or).unwrap();
    assert_eq!(page_or.items.len(), 0);

    // 3. Text with LIKE special chars % and _ (under 3 chars)
    let q_like = DiscoveryQuery {
        text: Some("%_".to_string()),
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
    let page_like = discover_products(&conn, "retail", today, &q_like).unwrap();
    assert_eq!(page_like.items.len(), 0);

    // 4. Vertical isolation: hospital query returns ONLY hospital resources
    let q_vert = DiscoveryQuery {
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
        limit: 100,
        cursor: None,
    };
    let page_hosp = discover_products(&conn, "hospital", today, &q_vert).unwrap();
    assert_eq!(page_hosp.items.len(), 50);
    for item in page_hosp.items {
        let idx: usize = item.id.trim_start_matches("res_").parse().unwrap();
        assert!(idx >= 450);
    }

    // 5. Limit clamp: limit = 100000 -> clamped to 200
    let q_clamp = DiscoveryQuery {
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
        limit: 100_000,
        cursor: None,
    };
    let page_clamp = discover_products(&conn, "retail", today, &q_clamp).unwrap();
    assert_eq!(page_clamp.items.len(), 200);

    // 6. Facets check
    let facets = discover_facets(&conn, "retail", today, &q_clamp).unwrap();
    assert!(!facets.brands.is_empty());
    assert!(!facets.suppliers.is_empty());
    assert!(!facets.categories.is_empty());
    assert!(!facets.tax_bp.is_empty());

    cleanup_temp_db(&path);
}

#[test]
fn test_query_time_benchmark_acceptance_a7() {
    let bench_db_path = std::path::Path::new("/tmp/omnibill_bench2.db");
    if !bench_db_path.exists() {
        println!("SKIPPING A7: /tmp/omnibill_bench2.db not found");
        return;
    }

    let conn = open_connection(bench_db_path).unwrap();
    let today = 20580;

    // Shape 1: No filter
    let q1 = DiscoveryQuery {
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
    };
    let start1 = std::time::Instant::now();
    let p1 = discover_products(&conn, "retail", today, &q1).unwrap();
    let elapsed1 = start1.elapsed();
    let ms1 = elapsed1.as_secs_f64() * 1000.0;
    let flag1 = if ms1 > 25.0 { " [FLAGGED > 25ms]" } else { "" };
    println!(
        "Shape 1 (No Filter): {} items in {:.3?} ({:.2} ms){}",
        p1.items.len(),
        elapsed1,
        ms1,
        flag1
    );

    // Shape 2: Brand filter
    let q2 = DiscoveryQuery {
        text: None,
        brand_ids: vec![1, 2],
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
    let start2 = std::time::Instant::now();
    let p2 = discover_products(&conn, "retail", today, &q2).unwrap();
    let elapsed2 = start2.elapsed();
    let ms2 = elapsed2.as_secs_f64() * 1000.0;
    let flag2 = if ms2 > 25.0 { " [FLAGGED > 25ms]" } else { "" };
    println!(
        "Shape 2 (Brand Filter): {} items in {:.3?} ({:.2} ms){}",
        p2.items.len(),
        elapsed2,
        ms2,
        flag2
    );

    // Shape 3: Brand + Expiry
    let q3 = DiscoveryQuery {
        text: None,
        brand_ids: vec![1, 2],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: None,
        last_sold_day: None,
        expiry_day: Some(Range {
            min: None,
            max: Some(20500),
        }),
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 50,
        cursor: None,
    };
    let start3 = std::time::Instant::now();
    let p3 = discover_products(&conn, "retail", today, &q3).unwrap();
    let elapsed3 = start3.elapsed();
    let ms3 = elapsed3.as_secs_f64() * 1000.0;
    let flag3 = if ms3 > 25.0 { " [FLAGGED > 25ms]" } else { "" };
    println!(
        "Shape 3 (Brand + Expiry): {} items in {:.3?} ({:.2} ms){}",
        p3.items.len(),
        elapsed3,
        ms3,
        flag3
    );

    // Shape 4: Text search 'nes'
    let q4 = DiscoveryQuery {
        text: Some("nes".to_string()),
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
    let start4 = std::time::Instant::now();
    let p4 = discover_products(&conn, "retail", today, &q4).unwrap();
    let elapsed4 = start4.elapsed();
    let ms4 = elapsed4.as_secs_f64() * 1000.0;
    let flag4 = if ms4 > 25.0 { " [FLAGGED > 25ms]" } else { "" };
    println!(
        "Shape 4 (Text 'nes'): {} items in {:.3?} ({:.2} ms){}",
        p4.items.len(),
        elapsed4,
        ms4,
        flag4
    );

    // Shape 5: Supplier + Received date range
    let q5 = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![1, 2],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: None,
        cost_paise: None,
        margin_bp: None,
        stock_milli: None,
        received_day: Some(Range {
            min: Some(20000),
            max: Some(20600),
        }),
        last_sold_day: None,
        expiry_day: None,
        preset: None,
        abc: vec![],
        sort: vec![],
        limit: 50,
        cursor: None,
    };
    let start5 = std::time::Instant::now();
    let p5 = discover_products(&conn, "retail", today, &q5).unwrap();
    let elapsed5 = start5.elapsed();
    let ms5 = elapsed5.as_secs_f64() * 1000.0;
    let flag5 = if ms5 > 25.0 { " [FLAGGED > 25ms]" } else { "" };
    println!(
        "Shape 5 (Supplier + Received Date Range): {} items in {:.3?} ({:.2} ms){}",
        p5.items.len(),
        elapsed5,
        ms5,
        flag5
    );
}
