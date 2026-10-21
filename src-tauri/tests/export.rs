use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use omnibill_core::discovery::export::{
    day_summary_text, export_discovery, UTF8_BOM,
};
use omnibill_core::discovery::query::{discover_products, DiscoveryQuery, Range};
use rusqlite::Connection;
use std::fs;

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    run_migrations(&mut conn, MIGRATIONS).unwrap();

    // Insert user
    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role) VALUES ('u1', 'admin', 'hash', 'Admin', 'ADMIN')",
        [],
    ).unwrap();

    conn
}

#[test]
fn test_csv_golden_bytes_and_injection_defense() {
    let conn = setup_test_db();

    // Insert 3 specific resources:
    // 1. Name with comma
    // 2. Name with quote
    // 3. Name starting with =SUM(1)
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical) VALUES
        ('r1', 'SKU-01', 'Widget, Deluxe Edition', '0001', 1800, 2500, 1500, 1, 1, 0),
        ('r2', 'SKU-02', 'Widget \"Super\" 100g', '0002', 1200, 1050, 750, 1, 1, 0),
        ('r3', 'SKU-03', '=SUM(1)', '0003', 500, 500, 300, 1, 1, 0)",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO product_stats (
            resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, margin_bp,
            stock_milli, stock_value_paise, reorder_milli, max_stock_milli,
            first_received_day, last_received_day, earliest_expiry_day, last_sold_day,
            qty_7_milli, qty_30_milli, qty_90_milli, rev_90_paise, gp_90_paise,
            runout_days_x10, stats_day, category_id
        ) VALUES
        ('r1', 'retail', 1, 1800, 2500, 1500, 4000, 10000, 15000, 2000, 20000, 900, 950, 99999999, 990, 500, 2000, 5000, 12500, 5000, 150, 1000, 1),
        ('r2', 'retail', 1, 1200, 1050, 750, 2857, 5000, 3750, 1000, 10000, 900, 950, 99999999, 995, 200, 1000, 3000, 3150, 900, 150, 1000, 1),
        ('r3', 'retail', 1, 500, 500, 300, 4000, 20000, 6000, 5000, 40000, 900, 950, 99999999, 998, 1000, 5000, 15000, 7500, 3000, 120, 1000, 1)",
        [],
    ).unwrap();

    let temp_dir = std::env::temp_dir().join(format!("omnibill_export_test_{}", std::process::id()));
    let _ = fs::create_dir_all(&temp_dir);

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
        limit: 50,
        cursor: None,
    };

    let export_path = export_discovery(&conn, &query, "retail", 1000, Some(temp_dir.to_str().unwrap())).unwrap();

    let bytes = fs::read(&export_path).unwrap();
    // 1. Verify UTF-8 BOM
    assert_eq!(&bytes[0..3], UTF8_BOM);

    // 2. Decode string content
    let text = String::from_utf8(bytes[3..].to_vec()).unwrap();
    let lines: Vec<&str> = text.lines().collect();

    // Line 0: Header
    assert_eq!(
        lines[0],
        "ID,SKU,Barcode,Name,Tax Rate (bps),Sell Price (INR),Cost Price (INR),Margin (bps),Stock (milli),Stock Value (INR),Reorder (milli),Max Stock (milli),Earliest Expiry Day,Last Received Day,Last Sold Day,Qty 7D (milli),Qty 30D (milli),Qty 90D (milli),Rev 90D (INR),GP 90D (INR),Runout (days x10),GMROI (bps),ABC Class,Is Critical"
    );

    // Assert 3 data lines
    assert_eq!(lines.len(), 4);

    // Check Row with =SUM(1) got prefixed with single quote:
    assert!(lines.iter().any(|l| l.contains("'=SUM(1)")));

    // Check Row with comma in name is quoted with double quotes:
    assert!(lines.iter().any(|l| l.contains("\"Widget, Deluxe Edition\"")));

    // Check Row with quote in name has doubled quotes:
    assert!(lines.iter().any(|l| l.contains("\"Widget \"\"Super\"\" 100g\"")));

    // Copy a sample for acceptance command A6 inspection
    let _ = fs::copy(&export_path, "/tmp/omnibill_sample.csv");

    // Clean up
    let _ = fs::remove_file(&export_path);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_row_count_equality_export_vs_discover_products() {
    let conn = setup_test_db();

    // Insert 20 products
    for i in 1..=20 {
        let id = format!("r_{:02}", i);
        let name = format!("Product {:02}", i);
        let sell_paise = (i as i64) * 1000;
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical)
             VALUES (?1, ?2, ?3, '0001', 1800, ?4, ?4 - 200, 1, 1, 0)",
            rusqlite::params![id, id, name, sell_paise],
        ).unwrap();

        conn.execute(
            "INSERT INTO product_stats (
                resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, margin_bp,
                stock_milli, stock_value_paise, stats_day
            ) VALUES (?1, 'retail', 1, 1800, ?2, ?2 - 200, 2000, 10000, 8000, 1000)",
            rusqlite::params![id, sell_paise],
        ).unwrap();
    }

    // Query filter: sell_paise between 5000 and 15000 (items 5..=15 = 11 items)
    let query = DiscoveryQuery {
        text: None,
        brand_ids: vec![],
        supplier_ids: vec![],
        category_ids: vec![],
        tax_bp: vec![],
        sell_paise: Some(Range {
            min: Some(5000),
            max: Some(15000),
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
        limit: 3, // small page limit to force multi-page cursor traversal
        cursor: None,
    };

    // 1. Traverse via discover_products pages
    let mut total_discovered = 0;
    let mut curr_query = query.clone();
    loop {
        let page = discover_products(&conn, "retail", 1000, &curr_query).unwrap();
        total_discovered += page.items.len();
        if let Some(next_c) = page.next_cursor {
            curr_query.cursor = Some(next_c);
        } else {
            break;
        }
    }
    assert_eq!(total_discovered, 11);

    // 2. Export via export_discovery
    let temp_dir = std::env::temp_dir().join(format!("omnibill_cnt_test_{}", std::process::id()));
    let _ = fs::create_dir_all(&temp_dir);

    let export_path = export_discovery(&conn, &query, "retail", 1000, Some(temp_dir.to_str().unwrap())).unwrap();
    let text = fs::read_to_string(&export_path).unwrap();
    let lines: Vec<&str> = text.lines().collect();

    // Data rows = total lines - 1 header line
    let csv_data_rows = lines.len() - 1;
    assert_eq!(csv_data_rows, total_discovered);

    // Copy a sample for acceptance command A6 inspection
    let _ = fs::copy(&export_path, "/tmp/omnibill_sample.csv");

    // Clean up
    let _ = fs::remove_file(&export_path);
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_day_summary_text_golden() {
    let conn = setup_test_db();
    let day = 1000;

    // Insert resources
    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked, is_active, is_critical) VALUES
        ('r1', 'SKU1', 'Basmati Rice 5kg', '1006', 500, 50000, 40000, 1, 1, 0),
        ('r2', 'SKU2', 'Sunflower Oil 1L', '1512', 500, 15000, 12000, 1, 1, 0)",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO product_stats (resource_id, vertical, is_active, tax_bp, sell_paise, avg_cost_paise, stock_milli, stock_value_paise, stats_day) VALUES
        ('r1', 'retail', 1, 500, 50000, 40000, 10000, 400000, 1000),
        ('r2', 'retail', 1, 500, 15000, 12000, 10000, 120000, 1000)",
        [],
    ).unwrap();

    // Sales daily for day 1000:
    // r1: 5 bills, 250000 net, 200000 cogs (gp = 50000)
    // r2: 3 bills, 45000 net, 36000 cogs (gp = 9000)
    // Total bills = 8, net = 295000 (₹2950.00), cogs = 236000, gp = 59000 (₹590.00)
    // Margin = 59000 * 10000 / 295000 = 2000 bp (20.00%)
    conn.execute(
        "INSERT INTO sales_daily (resource_id, day, qty_milli, net_paise, cogs_paise, bills) VALUES
        ('r1', 1000, 5000, 250000, 200000, 5),
        ('r2', 1000, 3000, 45000, 36000, 3)",
        [],
    ).unwrap();

    // Alerts for day 1000:
    conn.execute(
        "INSERT INTO alerts (day, kind, resource_id, severity, value_paise, detail) VALUES
        (1000, 'expiry', 'r1', 2, 40000, 'Expires in 14 days'),
        (1000, 'stockout', 'r2', 3, 12000, 'Stockout in 2 days')",
        [],
    ).unwrap();

    let summary = day_summary_text(&conn, "retail", day).unwrap();

    // Assert under 1,000 characters
    assert!(summary.len() < 1000);

    // Assert contains key metrics
    assert!(summary.contains("*OmniBill Daily Summary* (RETAIL, Day 1000)"));
    assert!(summary.contains("• Bills: 8"));
    assert!(summary.contains("• Net Sales: ₹2950.00"));
    assert!(summary.contains("• Gross Profit: ₹590.00"));
    assert!(summary.contains("• Margin: 20.00%"));
    assert!(summary.contains("1. Basmati Rice 5kg - ₹2500.00 (5 units)"));
    assert!(summary.contains("• Expiry: 1"));
    assert!(summary.contains("• Stockout: 1"));
}
