use omnibill_core::database::{
    migrations::{MIGRATIONS, run_migrations},
    open_connection,
};
use omnibill_core::discovery::fts::rebuild_fts;
use omnibill_core::discovery::query::{
    Dir, DiscoveryQuery, Preset, Range, SortKey, SortSpec, discover_products,
};
use omnibill_core::discovery::refresh::refresh_stats;
use omnibill_core::discovery::rollup::rebuild_rollups;
use rusqlite::params;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Deterministic 64-bit Linear Congruential Generator (LCG).
/// Implements Knuth MMIX multiplier: a = 6364136223846793005, c = 1442695040888963407.
/// ZERO floating-point operations.
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

fn parse_args() -> (PathBuf, usize, bool) {
    let args: Vec<String> = env::args().collect();
    let mut out_path = PathBuf::from("/tmp/omnibill_bench.db");
    let mut lines = 500_000usize;
    let mut verify_only = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--out" if i + 1 < args.len() => {
                out_path = PathBuf::from(&args[i + 1]);
                i += 1;
            }
            "--lines" if i + 1 < args.len() => {
                lines = args[i + 1].parse().unwrap_or(500_000);
                i += 1;
            }
            "--verify-only" => {
                verify_only = true;
            }
            _ => {}
        }
        i += 1;
    }
    (out_path, lines, verify_only)
}

fn run_verification(db_path: &Path) {
    println!("============================================================");
    println!(" OmniBill Benchmark Verification (--verify-only)");
    println!(" Database: {}", db_path.display());
    println!("============================================================");

    let mut conn = open_connection(db_path).expect("open connection");

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

    println!("[1/3] Benchmarking 5 Discovery Query Shapes (target: < 25 ms in release)...");
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
        println!(
            "   {} -> {} items returned in {:?}",
            name,
            res.items.len(),
            elapsed
        );
    }

    println!("[2/3] Benchmarking refresh_stats (target: < 1500 ms)...");
    let t_ref = Instant::now();
    let rep = refresh_stats(&mut conn, today).expect("refresh_stats failed");
    let elapsed_ref = t_ref.elapsed();
    println!(
        "   refresh_stats updated {} resources in {:?}",
        rep.resources_updated, elapsed_ref
    );

    println!("[3/3] Benchmarking rebuild_rollups (target: < 30 s)...");
    let t_reb = Instant::now();
    let reb_rep = rebuild_rollups(&conn).expect("rebuild_rollups failed");
    let elapsed_reb = t_reb.elapsed();
    println!(
        "   rebuild_rollups rebuilt {} daily rows in {:?}",
        reb_rep.sales_daily_rows, elapsed_reb
    );

    println!("============================================================");
    println!(" BENCHMARK VERIFICATION COMPLETED SUCCESSFULLY");
    println!("============================================================");
}

fn main() {
    let (out_path, lines_target, verify_only) = parse_args();
    if verify_only {
        if !out_path.exists() {
            eprintln!(
                "Benchmark database {} does not exist. Run without --verify-only first to seed.",
                out_path.display()
            );
            std::process::exit(1);
        }
        run_verification(&out_path);
        return;
    }
    println!("============================================================");
    println!(" OmniBill Seed & Benchmark Tool");
    println!(" Database: {}", out_path.display());
    println!(" Target Transaction Lines: {}", lines_target);
    println!("============================================================");

    if out_path.exists() {
        let _ = std::fs::remove_file(&out_path);
    }

    let start_total = Instant::now();
    let mut conn = open_connection(&out_path).expect("open connection");

    // Optimize PRAGMAs for high-speed bulk seeding
    conn.execute_batch(
        "PRAGMA synchronous = OFF;
         PRAGMA journal_mode = MEMORY;
         PRAGMA cache_size = 100000;
         PRAGMA foreign_keys = OFF;",
    )
    .expect("set seeding pragmas");

    println!("[1/7] Running database migrations...");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let mut lcg = Lcg::new(42);

    println!("[2/7] Seeding seed users, 120 suppliers, and 800 brands...");
    let tx = conn.transaction().expect("begin tx metadata");
    {
        tx.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, is_active)
             VALUES ('usr_seed_admin', 'admin', 'hash_admin', 'Benchmark Admin', 'ADMIN', 1)",
            [],
        )
        .expect("insert admin user");

        let mut stmt_sup = tx
            .prepare(
                "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code, is_active)
                 VALUES (?1, ?2, 'SUPPLIER', ?3, '07', 1)",
            )
            .expect("prepare supplier insert");
        for s in 1..=120 {
            let id = format!("SUP_{:03}", s);
            let code = format!("CODE_SUP_{:03}", s);
            let name = format!("Supplier Corp {:03}", s);
            stmt_sup
                .execute(params![id, code, name])
                .expect("insert supplier");
        }

        let mut stmt_brand = tx
            .prepare("INSERT INTO brands (id, name, manufacturer) VALUES (?1, ?2, ?3)")
            .expect("prepare brand insert");
        for b in 1..=800 {
            let name = format!("Brand_{:04}", b);
            let mfg = format!("Manufacturer_{:03}", b % 50);
            stmt_brand
                .execute(params![b, name, mfg])
                .expect("insert brand");
        }
    }
    tx.commit().expect("commit metadata");

    println!("[3/7] Seeding 50,000 resources and product_stats across 3 verticals...");
    let start_res = Instant::now();
    let tx_res = conn.transaction().expect("begin tx resources");
    {
        let mut stmt_res = tx_res.prepare(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, brand_id, barcode)
             VALUES (?1, ?2, ?3, '30049099', ?4, ?5, ?6, 1, ?7, ?8, ?9)"
        ).expect("prepare resource insert");

        let mut stmt_stats = tx_res
            .prepare(
                "INSERT INTO product_stats (
                resource_id, vertical, is_active, brand_id, category_id, tax_bp,
                sell_paise, avg_cost_paise, margin_bp, stock_milli, reorder_milli,
                max_stock_milli, stock_value_paise, first_received_day, last_received_day,
                last_supplier_id, earliest_expiry_day, last_sold_day, qty_7_milli,
                qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise, runout_days_x10,
                gmroi_bp, abc_class, stats_day
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19,
                ?20, ?21, ?22, ?23, ?24,
                ?25, ?26, 20000
             )",
            )
            .expect("prepare stats insert");

        let verticals = ["retail", "wholesale", "hospital"];

        for i in 1..=50_000 {
            let res_id = format!("{}", i);
            let sku = format!("SKU_{:06}", i);
            let vert = verticals[(i % 3) as usize];
            let name = format!("Item_{}_{:06}", vert, i);
            let brand_id = lcg.next_range(1, 800);
            let barcode = format!("890{:010}", i);
            let is_active = if i % 25 == 0 { 0 } else { 1 };
            let tax_bp = 1800;
            let sell_paise = lcg.next_range(1000, 50000);
            let cost_paise = lcg.next_range(500, sell_paise);
            let margin_bp = if sell_paise > 0 {
                let diff = sell_paise - cost_paise;
                ((diff as i128 * 10000) / (sell_paise as i128)) as i64
            } else {
                0
            };

            stmt_res
                .execute(params![
                    res_id, sku, name, tax_bp, sell_paise, cost_paise, is_active, brand_id, barcode
                ])
                .expect("insert resource");

            let stock_milli = lcg.next_range(0, 100_000);
            let stock_val_paise = (stock_milli / 1000) * cost_paise;
            let cat_id = lcg.next_range(1, 40);
            let sup_id = format!("SUP_{:03}", lcg.next_range(1, 120));
            let earliest_exp = lcg.next_range(20050, 20800);
            let last_sold = lcg.next_range(19950, 20000);
            let qty_7 = lcg.next_range(0, 5000);
            let qty_30 = lcg.next_range(0, 25000);
            let qty_90 = lcg.next_range(0, 75000);
            let rev_90 = (qty_90 / 1000) * sell_paise;
            let gp_90 = (qty_90 / 1000) * (sell_paise - cost_paise);
            let runout = lcg.next_range(50, 3650);
            let gmroi = lcg.next_range(5000, 30000);
            let abc = lcg.next_range(1, 3);

            stmt_stats
                .execute(params![
                    res_id,
                    vert,
                    is_active,
                    brand_id,
                    cat_id,
                    tax_bp,
                    sell_paise,
                    cost_paise,
                    margin_bp,
                    stock_milli,
                    10_000,  // reorder_milli
                    100_000, // max_stock_milli
                    stock_val_paise,
                    19500, // first_received_day
                    19900, // last_received_day
                    sup_id,
                    earliest_exp,
                    last_sold,
                    qty_7,
                    qty_30,
                    qty_90,
                    rev_90,
                    gp_90,
                    runout,
                    gmroi,
                    abc
                ])
                .expect("insert stats");
        }
    }
    tx_res.commit().expect("commit resources");
    println!(
        "   50,000 resources & stats inserted in {:?}",
        start_res.elapsed()
    );

    println!("[4/7] Seeding 150,000 resource_lots...");
    let start_lots = Instant::now();
    let tx_lots = conn.transaction().expect("begin tx lots");
    {
        let mut stmt_lot = tx_lots.prepare(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise, cost_price_paise, supplier_id, received_day)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        ).expect("prepare lot insert");

        for lot_i in 1..=150_000 {
            let lot_id = format!("LOT_{:06}", lot_i);
            let res_idx = ((lot_i - 1) % 50_000) + 1;
            let res_id = format!("{}", res_idx);
            let batch = format!("B_{:06}", lot_i);
            let month = ((lot_i % 12) + 1) as u32;
            let day = ((lot_i % 28) + 1) as u32;
            let exp_date = format!("2027-{:02}-{:02}", month, day);
            let mrp = 15000;
            let cost = 7500;
            let sup_id = format!("SUP_{:03}", lcg.next_range(1, 120));
            let rec_day = lcg.next_range(19500, 20000);

            stmt_lot
                .execute(params![
                    lot_id, res_id, batch, exp_date, mrp, cost, sup_id, rec_day
                ])
                .expect("insert lot");
        }
    }
    tx_lots.commit().expect("commit lots");
    println!("   150,000 lots inserted in {:?}", start_lots.elapsed());

    println!(
        "[5/7] Seeding {} transaction_items in ONE transaction...",
        lines_target
    );
    let start_lines = Instant::now();
    let tx_lines = conn.transaction().expect("begin tx lines");
    {
        let lines_per_invoice = 10usize;
        let invoice_count = lines_target / lines_per_invoice;

        let mut stmt_tx = tx_lines
            .prepare(
                "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, total_amount_paise, notes,
                created_by_user_id, created_at, transaction_type, original_transaction_id,
                invoice_date, round_off_paise, price_mode
             ) VALUES (
                ?1, 'POSTED', '07', '07', 'REC',
                ?2, 'SUP_001', 50000, 0, 50000,
                4500, 4500, 0, 59000, 'Seeded invoice',
                'usr_seed_admin', '2026-01-01T00:00:00.000Z', 'SALE', NULL,
                '2026-01-01', 0, 'EXCLUSIVE'
             )",
            )
            .expect("prepare tx insert");

        let mut stmt_item = tx_lines
            .prepare(
                "INSERT INTO transaction_items (
                id, transaction_id, resource_id, lot_id, quantity_milli, unit_price_paise,
                discount_paise, taxable_paise, tax_rate_bps, cgst_paise, sgst_paise, igst_paise,
                line_total_paise, cogs_paise, business_day
             ) VALUES (
                ?1, ?2, ?3, ?4, 1000, 5000,
                0, 5000, 1800, 450, 450, 0,
                5900, 3000, 20000
             )",
            )
            .expect("prepare item insert");

        for inv_i in 1..=invoice_count {
            let tx_id = format!("TX_{:08}", inv_i);
            let inv_num = format!("INV_{:08}", inv_i);
            stmt_tx
                .execute(params![tx_id, inv_num])
                .expect("insert header transaction");

            for line_j in 1..=lines_per_invoice {
                let line_num = (inv_i - 1) * lines_per_invoice + line_j;
                let item_id = format!("ITEM_{:08}", line_num);
                let res_idx = ((line_num - 1) % 50_000) + 1;
                let res_id = format!("{}", res_idx);
                let lot_id = format!("LOT_{:06}", res_idx);

                stmt_item
                    .execute(params![item_id, tx_id, res_id, lot_id])
                    .expect("insert transaction item");
            }
        }
    }
    tx_lines.commit().expect("commit lines");
    println!(
        "   {} transaction_items inserted in {:?}",
        lines_target,
        start_lines.elapsed()
    );

    println!("[6/7] Populating trigram products_fts virtual table...");
    let start_fts = Instant::now();
    let fts_count = rebuild_fts(&conn).expect("rebuild fts");
    println!(
        "   {} FTS rows indexed in {:?}",
        fts_count,
        start_fts.elapsed()
    );

    println!("[7/7] Running SQLite ANALYZE and restoring production WAL pragmas...");
    let start_analyze = Instant::now();
    conn.execute("ANALYZE", []).expect("run analyze");
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;",
    )
    .expect("restore production pragmas");
    println!("   ANALYZE completed in {:?}", start_analyze.elapsed());

    println!("============================================================");
    println!(
        " Benchmark Seeding Complete! Total time: {:?}",
        start_total.elapsed()
    );
    println!("============================================================");
}
