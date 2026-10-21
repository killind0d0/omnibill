use omnibill_core::commands::*;
use omnibill_core::database::migrations::{MIGRATIONS, get_user_version, run_migrations};
use omnibill_core::database::open_connection;
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;

fn default_db_path() -> String {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!("{}/omnibill.db", home)
}

fn print_help() {
    println!(
        r#"
================================================================================
   OmniBill ERP — Next-Gen Offline Accounting & POS Engine
================================================================================
Usage:
    omnibill [OPTIONS]

Options:
    --init [db_path]       Initialize database, apply schema migrations & seed accounts
    --audit [db_path]      Run point-in-time double-entry consistency audit (verify_ledger)
    --info [db_path]       Display database status, user_version, and ledger balance
    --serve [port] [path]  Start embedded zero-dependency HTTP bridge on 127.0.0.1 (default port: 4000)
    --help                 Display this manual
================================================================================
"#
    );
}

fn handle_init(db_path: &str) {
    println!("[OmniBill] Initializing database at: {}", db_path);
    match open_connection(db_path) {
        Ok(mut conn) => match run_migrations(&mut conn, MIGRATIONS) {
            Ok(_) => {
                let v = get_user_version(&conn).unwrap_or(0);
                println!(
                    "[OmniBill] SUCCESS: Database migrated to schema user_version: {}",
                    v
                );
            }
            Err(e) => eprintln!("[OmniBill] ERROR migrating database: {}", e),
        },
        Err(e) => eprintln!("[OmniBill] ERROR opening database connection: {}", e),
    }
}

fn handle_audit(db_path: &str) {
    println!("[OmniBill] Running ledger audit on: {}", db_path);
    match cmd_verify_ledger(db_path.to_string()) {
        Ok(discrepancies) => {
            if discrepancies.is_empty() {
                println!(
                    "[OmniBill] AUDIT PASSED: 100% Double-entry consistency verified. Zero discrepancies found."
                );
            } else {
                eprintln!(
                    "[OmniBill] AUDIT FAILED: {} discrepancies detected:",
                    discrepancies.len()
                );
                for d in discrepancies {
                    eprintln!("  - {}", d);
                }
            }
        }
        Err(e) => eprintln!("[OmniBill] ERROR: {}", e),
    }
}

fn handle_info(db_path: &str) {
    println!("[OmniBill] Checking database: {}", db_path);
    if !Path::new(db_path).exists() {
        println!("[OmniBill] File does not exist yet. Run `omnibill --init` to create it.");
        return;
    }

    match open_connection(db_path) {
        Ok(conn) => {
            let user_v: i32 = get_user_version(&conn).unwrap_or(-1);
            let account_count: i64 = conn
                .query_row("SELECT count(*) FROM accounts", [], |r| r.get(0))
                .unwrap_or(0);
            let entity_count: i64 = conn
                .query_row("SELECT count(*) FROM entities", [], |r| r.get(0))
                .unwrap_or(0);
            let resource_count: i64 = conn
                .query_row("SELECT count(*) FROM resources", [], |r| r.get(0))
                .unwrap_or(0);
            let tx_count: i64 = conn
                .query_row("SELECT count(*) FROM transactions", [], |r| r.get(0))
                .unwrap_or(0);

            println!("  Schema Version:      {}", user_v);
            println!("  Chart of Accounts:   {} accounts", account_count);
            println!("  Entities (Parties):  {} records", entity_count);
            println!("  Catalog Resources:   {} items", resource_count);
            println!("  Total Transactions:  {} invoices", tx_count);

            match cmd_get_trial_balance(db_path.to_string()) {
                Ok(tb) => {
                    println!(
                        "  Trial Balance:       Total Debits: ₹{:.2} | Total Credits: ₹{:.2}",
                        tb.total_debits_paise as f64 / 100.0,
                        tb.total_credits_paise as f64 / 100.0
                    );
                    println!(
                        "  Balanced Status:     {}",
                        if tb.is_balanced {
                            "BALANCED (Dr == Cr)"
                        } else {
                            "IMBALANCED"
                        }
                    );
                }
                Err(e) => eprintln!("  Trial Balance Error: {}", e),
            }
        }
        Err(e) => eprintln!("[OmniBill] Error connecting to database: {}", e),
    }
}

fn handle_client(mut stream: TcpStream, db_path: &str) {
    let mut buffer = [0u8; 65536];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(b) => b,
        Err(_) => return,
    };

    let req_str = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut lines = req_str.lines();
    let first_line = lines.next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();

    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let path = parts[1];

    // Handle CORS preflight
    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
                    Access-Control-Allow-Headers: Content-Type\r\n\
                    Connection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        return;
    }

    // Extract body
    let body = if let Some(pos) = req_str.find("\r\n\r\n") {
        &req_str[pos + 4..]
    } else {
        ""
    };

    let (status_code, json_body) = match (method, path) {
        ("GET", "/api/info") => (
            200,
            serde_json::json!({ "status": "ok", "app": "OmniBill ERP", "version": "0.1.0" })
                .to_string(),
        ),
        ("GET", "/api/resources") => match cmd_get_resources(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        ("GET", "/api/entities") => match cmd_get_entities(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        ("GET", "/api/trial_balance") => match cmd_get_trial_balance(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        ("GET", "/api/stock_summary") => match cmd_get_stock_summary(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        ("POST", "/api/post_sale") => {
            match serde_json::from_str::<omnibill_core::posting::SaleInput>(body) {
                Ok(input) => match cmd_post_sale(db_path.to_string(), input) {
                    Ok(sale) => (200, serde_json::to_string(&sale).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/post_sale_with_payments") => {
            match serde_json::from_str::<omnibill_core::posting::SaleWithPaymentsInput>(body) {
                Ok(input) => match cmd_post_sale_with_payments(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/post_purchase") => {
            match serde_json::from_str::<omnibill_core::posting::PurchaseInput>(body) {
                Ok(input) => match cmd_post_purchase(db_path.to_string(), input) {
                    Ok(pur) => (200, serde_json::to_string(&pur).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/post_payment") => {
            match serde_json::from_str::<omnibill_core::posting::PaymentInput>(body) {
                Ok(input) => match cmd_post_payment(db_path.to_string(), input) {
                    Ok(pay) => (200, serde_json::to_string(&pay).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/discovery/products") => {
            #[derive(serde::Deserialize)]
            struct Req {
                query: omnibill_core::discovery::query::DiscoveryQuery,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(r) => match cmd_discover_products(db_path, r.query, r.vertical) {
                    Ok(page) => (200, serde_json::to_string(&page).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/discovery/facets") => {
            #[derive(serde::Deserialize)]
            struct Req {
                query: omnibill_core::discovery::query::DiscoveryQuery,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(r) => match cmd_discover_facets(db_path, r.query, r.vertical) {
                    Ok(facets) => (200, serde_json::to_string(&facets).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/discovery/sell_graph") => {
            #[derive(serde::Deserialize)]
            struct Req {
                kind: GraphKind,
                params: GraphParams,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(r) => match cmd_sell_graph(db_path, r.kind, r.params, r.vertical) {
                    Ok(data) => (200, serde_json::to_string(&data).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        ("POST", "/api/discovery/refresh") => {
            #[derive(serde::Deserialize)]
            struct Req {
                today: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(body).unwrap_or(Req { today: None });
            match cmd_refresh_analytics(db_path, req.today) {
                Ok(rep) => (200, serde_json::to_string(&rep).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        ("POST", "/api/alerts/generate") => {
            #[derive(serde::Deserialize)]
            struct Req {
                vertical: Option<String>,
                today: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(body).unwrap_or(Req {
                vertical: None,
                today: None,
            });
            match cmd_generate_alerts(db_path, req.vertical, req.today) {
                Ok(rep) => (200, serde_json::to_string(&rep).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        ("POST", "/api/alerts/list") => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "includeAcknowledged", default)]
                include_acknowledged: bool,
            }
            let req = serde_json::from_str::<Req>(body).unwrap_or(Req {
                include_acknowledged: false,
            });
            match cmd_list_alerts(db_path, req.include_acknowledged) {
                Ok(alerts) => (200, serde_json::to_string(&alerts).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        ("POST", "/api/alerts/acknowledge") => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "alertId")]
                alert_id: i64,
                today: Option<i64>,
            }
            match serde_json::from_str::<Req>(body) {
                Ok(r) => match cmd_acknowledge_alert(db_path, r.alert_id, r.today) {
                    Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (
                    400,
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ),
            }
        }
        _ => (404, serde_json::json!({ "error": "Not Found" }).to_string()),
    };

    let response = format!(
        "HTTP/1.1 {} OK\r\n\
         Content-Type: application/json\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n{}",
        status_code,
        json_body.len(),
        json_body
    );

    let _ = stream.write_all(response.as_bytes());
}

fn handle_serve(port: u16, db_path: &str) {
    let addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[OmniBill] Failed to bind to {}: {}", addr, e);
            return;
        }
    };

    // Ensure database is initialized
    handle_init(db_path);

    println!("[OmniBill] API Server running on http://{}", addr);
    println!("[OmniBill] Connected SQLite Database: {}", db_path);
    println!("[OmniBill] Ready for UI interactions. Press Ctrl+C to stop.");

    for stream in listener.incoming().flatten() {
        handle_client(stream, db_path);
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let default_db = default_db_path();

    if args.len() < 2 {
        print_help();
        return;
    }

    match args[1].as_str() {
        "--init" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_init(db_path);
        }
        "--audit" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_audit(db_path);
        }
        "--info" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_info(db_path);
        }
        "--serve" => {
            let port = args
                .get(2)
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(4000);
            let db_path = args.get(3).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_serve(port, db_path);
        }
        "--help" | "-h" => {
            print_help();
        }
        other => {
            eprintln!("Unknown option: {}", other);
            print_help();
        }
    }
}
