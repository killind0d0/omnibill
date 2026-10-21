use omnibill_core::access::guard::{AppAuthState, GuardError, authorize};
use omnibill_core::commands::*;
use omnibill_core::database::migrations::{MIGRATIONS, get_user_version, run_migrations};
use omnibill_core::database::open_connection;
use omnibill_core::database::queries::verify_ledger;
use omnibill_core::discovery::commands::*;
use omnibill_core::discovery::query::DiscoveryQuery;
use omnibill_core::reports::get_trial_balance;
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

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
    match open_connection(db_path) {
        Ok(conn) => match verify_ledger(&conn) {
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
        },
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

            match get_trial_balance(&conn) {
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

pub const MAX_BODY_SIZE: usize = 1_048_576; // 1 MB limit

pub fn is_allowed_origin(origin: &str, port: u16) -> bool {
    let port_str = port.to_string();
    origin == "http://localhost:1420"
        || origin == "http://127.0.0.1:1420"
        || origin == "http://localhost:4000"
        || origin == "http://127.0.0.1:4000"
        || origin == format!("http://localhost:{}", port_str)
        || origin == format!("http://127.0.0.1:{}", port_str)
        || origin == "tauri://localhost"
        || origin == "http://tauri.localhost"
        || origin == "https://tauri.localhost"
}

pub fn is_valid_host(host: &str, port: u16) -> bool {
    let expected_127 = format!("127.0.0.1:{}", port);
    let expected_localhost = format!("localhost:{}", port);
    host.eq_ignore_ascii_case(&expected_127) || host.eq_ignore_ascii_case(&expected_localhost)
}

pub struct ParsedRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
    pub content_length: Option<usize>,
    pub body: &'a str,
}

pub fn parse_http_request<'a>(req_str: &'a str) -> Option<ParsedRequest<'a>> {
    let (head, body) = match req_str.find("\r\n\r\n") {
        Some(pos) => (&req_str[..pos], &req_str[pos + 4..]),
        None => (req_str, ""),
    };

    let mut lines = head.lines();
    let first_line = lines.next()?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;

    let mut host = None;
    let mut origin = None;
    let mut authorization = None;
    let mut content_length = None;

    for line in lines {
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim();
            let val = line[colon_pos + 1..].trim();
            if key.eq_ignore_ascii_case("host") {
                host = Some(val);
            } else if key.eq_ignore_ascii_case("origin") {
                origin = Some(val);
            } else if key.eq_ignore_ascii_case("authorization") {
                authorization = Some(val);
            } else if key.eq_ignore_ascii_case("content-length") {
                content_length = val.parse::<usize>().ok();
            }
        }
    }

    Some(ParsedRequest {
        method,
        path,
        host,
        origin,
        authorization,
        content_length,
        body,
    })
}

pub fn process_http_request(
    req_str: &str,
    port: u16,
    db_path: &str,
) -> (u16, String, Option<String>) {
    let req = match parse_http_request(req_str) {
        Some(r) => r,
        None => {
            return (
                400,
                serde_json::json!({ "error": "Bad request" }).to_string(),
                None,
            );
        }
    };

    // 1. Require Host header to be exactly 127.0.0.1:<port> or localhost:<port>
    let host = match req.host {
        Some(h) => h,
        None => {
            return (
                403,
                serde_json::json!({ "error": "Forbidden: missing Host header" }).to_string(),
                None,
            );
        }
    };
    if !is_valid_host(host, port) {
        return (
            403,
            serde_json::json!({ "error": "Forbidden: invalid Host header" }).to_string(),
            None,
        );
    }

    // 2. Reject foreign Origin header if present
    if let Some(origin) = req.origin
        && !is_allowed_origin(origin, port)
    {
        return (
            403,
            serde_json::json!({ "error": "Forbidden: foreign Origin not allowed" }).to_string(),
            None,
        );
    }

    // 3. Limit request body to 1 MB
    if req.body.len() > MAX_BODY_SIZE || req.content_length.unwrap_or(0) > MAX_BODY_SIZE {
        return (
            413,
            serde_json::json!({ "error": "Payload Too Large: body exceeds 1 MB limit" })
                .to_string(),
            req.origin.map(String::from),
        );
    }

    // Handle OPTIONS preflight
    if req.method == "OPTIONS" {
        return (204, String::new(), req.origin.map(String::from));
    }

    // Dispatch routes
    if req.path == "/api/info" {
        return (
            200,
            serde_json::json!({ "status": "ok", "app": "OmniBill ERP", "version": "0.1.0" })
                .to_string(),
            req.origin.map(String::from),
        );
    }

    let auth_state = AppAuthState::new("retail");
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let bearer = req
        .authorization
        .and_then(|a| a.trim().strip_prefix("Bearer ").map(|t| t.trim()));

    let (status, body) = guarded_dispatch(&auth_state, bearer, req.path, req.body, now_ms, db_path);
    (status, body, req.origin.map(String::from))
}

fn handle_client(mut stream: TcpStream, db_path: &str, port: u16) {
    let mut buffer = [0u8; 65536];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(b) if b > 0 => b,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buffer[..bytes_read]);
    let (status_code, json_body, allowed_origin) = process_http_request(&req_str, port, db_path);

    let cors_header = match allowed_origin {
        Some(ref origin) => format!("Access-Control-Allow-Origin: {}\r\n", origin),
        None => String::new(),
    };

    let status_text = match status_code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    };

    let response = if status_code == 204 {
        format!(
            "HTTP/1.1 204 No Content\r\n\
             {}\
             Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type, Authorization\r\n\
             Cache-Control: no-store\r\n\
             Connection: close\r\n\r\n",
            cors_header
        )
    } else {
        format!(
            "HTTP/1.1 {} {}\r\n\
             Content-Type: application/json\r\n\
             {}\
             Cache-Control: no-store\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\r\n\
             {}",
            status_code,
            status_text,
            cors_header,
            json_body.len(),
            json_body
        )
    };

    let _ = stream.write_all(response.as_bytes());
}

pub const ROUTES: &[(&str, &str)] = omnibill_core::access::routes::ROUTES;

/// The central guarded HTTP dispatcher.
///
/// NOTE: Direct calls to `cmd_*` from Rust code and tests are the internal API
/// and bypass the guard by design. Only the HTTP boundary is guarded.
pub fn guarded_dispatch(
    auth_state: &AppAuthState,
    bearer: Option<&str>,
    route: &str,
    args: &str,
    now_ms: i64,
    db_path: &str,
) -> (u16, String) {
    // 1. Look up the route in ROUTES (unknown -> 404 fail-closed)
    let cmd_name = match ROUTES.iter().find(|(r, _)| *r == route) {
        Some((_, cmd)) => *cmd,
        None => {
            return (404, serde_json::json!({ "error": "Not Found" }).to_string());
        }
    };

    // 2. Authorize using the policy name for that cmd_*
    let _auth = match authorize(&auth_state.as_guard_context(), bearer, cmd_name, now_ms) {
        Ok(user) => user,
        Err(guard_err) => {
            return match guard_err {
                GuardError::MissingSessionToken => (
                    401,
                    serde_json::json!({ "error": "Unauthorized: missing bearer token" }).to_string(),
                ),
                GuardError::SessionInvalid => (
                    401,
                    serde_json::json!({ "error": "Unauthorized: invalid session token" }).to_string(),
                ),
                GuardError::SessionExpired(_) => (
                    401,
                    serde_json::json!({ "error": "Unauthorized: session expired" }).to_string(),
                ),
                GuardError::UserInactive => (
                    403,
                    serde_json::json!({ "error": "Forbidden: user account is deactivated" }).to_string(),
                ),
                GuardError::MustChangePassword => (
                    403,
                    serde_json::json!({ "error": "Forbidden: password change required" }).to_string(),
                ),
                GuardError::PermissionDenied(perm) => (
                    403,
                    serde_json::json!({ "error": format!("Forbidden: missing permission {:?}", perm) }).to_string(),
                ),
                GuardError::ModeRestricted(msg) => (
                    403,
                    serde_json::json!({ "error": format!("Forbidden: {}", msg) }).to_string(),
                ),
                GuardError::UnknownCommand(_) => (
                    404,
                    serde_json::json!({ "error": "Not Found" }).to_string(),
                ),
                GuardError::FeatureNotLicensed(feat) => (
                    403,
                    serde_json::json!({ "error": format!("Forbidden: feature {:?} not licensed", feat) }).to_string(),
                ),
                GuardError::LockError => (
                    500,
                    serde_json::json!({ "error": "Internal state error" }).to_string(),
                ),
            };
        }
    };

    // 3. Dispatch to the command
    match cmd_name {
        "login" => {
            #[derive(serde::Deserialize)]
            struct Req {
                username: String,
                password: String,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match open_connection(db_path) {
                    Ok(conn) => match omnibill_core::access::commands::login(auth_state, &conn, &r.username, &r.password, now_ms) {
                        Ok(resp) => (200, serde_json::to_string(&resp).unwrap_or_default()),
                        Err(e) => (401, serde_json::json!({ "error": e }).to_string()),
                    },
                    Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "get_boot_state" => {
            match open_connection(db_path) {
                Ok(conn) => match omnibill_core::access::commands::get_boot_state(auth_state, &conn) {
                    Ok(resp) => (200, serde_json::to_string(&resp).unwrap_or_default()),
                    Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "import_database_key" => {
            #[derive(serde::Deserialize)]
            struct Req {
                hex_key: String,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => {
                    let db_path_obj = std::path::Path::new(db_path);
                    let store = omnibill_core::access::dbkey::default_keystore();
                    match omnibill_core::access::dbopen::import_database_key_impl(
                        db_path_obj,
                        &r.hex_key,
                        store.as_ref(),
                        now_ms,
                    ) {
                        Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                        Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                    }
                }
                Err(e) => (400, serde_json::json!({ "error": format!("Invalid JSON: {}", e) }).to_string()),
            }
        }
        "logout" => {
            match omnibill_core::access::commands::logout(auth_state, bearer, now_ms) {
                Ok(()) => (200, serde_json::json!({ "status": "logged_out" }).to_string()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "change_password" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "oldPassword")]
                old_password: String,
                #[serde(rename = "newPassword")]
                new_password: String,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match open_connection(db_path) {
                    Ok(mut conn) => match omnibill_core::access::commands::change_password(auth_state, &mut conn, bearer, &r.old_password, &r.new_password, now_ms) {
                        Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                        Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                    },
                    Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "get_access_status" => {
            match omnibill_core::access::commands::get_access_status(auth_state, bearer, now_ms) {
                Ok(status) => (200, serde_json::to_string(&status).unwrap_or_default()),
                Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "get_role_permissions" => {
            #[derive(serde::Deserialize)]
            struct Req {
                role: String,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match open_connection(db_path) {
                    Ok(conn) => match omnibill_core::access::commands_roles::get_role_permissions(auth_state, &conn, bearer, &r.role, now_ms) {
                        Ok(perms) => (200, serde_json::to_string(&perms).unwrap_or_default()),
                        Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                    },
                    Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "set_role_permission" => {
            #[derive(serde::Deserialize)]
            struct Req {
                role: String,
                permission: String,
                granted: bool,
                #[allow(dead_code)]
                #[serde(default)]
                confirm: bool,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match open_connection(db_path) {
                    Ok(conn) => match omnibill_core::access::commands_roles::set_role_permission(auth_state, &conn, bearer, &r.role, &r.permission, r.granted, r.confirm, now_ms) {
                        Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                        Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                    },
                    Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "reset_role_permissions" => {
            #[derive(serde::Deserialize)]
            struct Req {
                role: String,
                #[allow(dead_code)]
                #[serde(default)]
                confirm: bool,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match open_connection(db_path) {
                    Ok(conn) => match omnibill_core::access::commands_roles::reset_role_permissions(auth_state, &conn, bearer, &r.role, now_ms) {
                        Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                        Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                    },
                    Err(e) => (500, serde_json::json!({ "error": e.to_string() }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_run_migrations" => match cmd_init_database(db_path.to_string()) {
            Ok(v) => (200, serde_json::json!({ "version": v }).to_string()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_get_schema_version" => match cmd_get_schema_version_guarded(auth_state, bearer, db_path.to_string(), now_ms) {
            Ok(v) => (200, serde_json::json!({ "version": v }).to_string()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_verify_ledger" => match cmd_verify_ledger(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_record_entity" => {
            match serde_json::from_str::<CreateEntityInput>(args) {
                Ok(input) => match cmd_create_entity(db_path.to_string(), input) {
                    Ok(ent) => (200, serde_json::to_string(&ent).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_list_entities" => match cmd_get_entities(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_record_resource" => {
            match serde_json::from_str::<CreateResourceInput>(args) {
                Ok(input) => match cmd_create_resource(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_list_resources" => match cmd_get_resources(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_post_sale" => {
            match serde_json::from_str::<omnibill_core::posting::SaleInput>(args) {
                Ok(input) => match cmd_post_sale(db_path.to_string(), input) {
                    Ok(sale) => (200, serde_json::to_string(&sale).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_post_sale_with_payments" => {
            match serde_json::from_str::<omnibill_core::posting::SaleWithPaymentsInput>(args) {
                Ok(input) => match cmd_post_sale_with_payments(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_collect_customer_payment" => {
            match serde_json::from_str::<omnibill_core::posting::PaymentInput>(args) {
                Ok(input) => match cmd_post_payment(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_post_payment" => {
            match serde_json::from_str::<omnibill_core::posting::PaymentInput>(args) {
                Ok(input) => match cmd_post_payment(db_path.to_string(), input) {
                    Ok(pay) => (200, serde_json::to_string(&pay).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_post_purchase" => {
            match serde_json::from_str::<omnibill_core::posting::PurchaseInput>(args) {
                Ok(input) => match cmd_post_purchase(db_path.to_string(), input) {
                    Ok(pur) => (200, serde_json::to_string(&pur).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_disburse_supplier_payout" => {
            match serde_json::from_str::<omnibill_core::posting::PaymentInput>(args) {
                Ok(input) => match cmd_post_payment(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_post_sale_return" => {
            match serde_json::from_str::<omnibill_core::posting::SaleReturnInput>(args) {
                Ok(input) => match cmd_post_sale_return(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_post_purchase_return" => {
            match serde_json::from_str::<omnibill_core::posting::PurchaseReturnInput>(args) {
                Ok(input) => match cmd_post_purchase_return(db_path.to_string(), input) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_get_day_book" => {
            #[derive(serde::Deserialize)]
            struct Req {
                date: String,
            }
            let date = serde_json::from_str::<Req>(args)
                .map(|r| r.date)
                .unwrap_or_else(|_| args.trim_matches('"').to_string());
            match cmd_get_day_book(db_path.to_string(), date) {
                Ok(db) => (200, serde_json::to_string(&db).unwrap_or_default()),
                Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_get_trial_balance" => match cmd_get_trial_balance(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_get_stock_summary" => match cmd_get_stock_summary(db_path.to_string()) {
            Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_get_gstr1" => {
            #[derive(serde::Deserialize)]
            struct Req {
                fy: String,
                month: Option<u32>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_get_gstr1_summary(db_path.to_string(), r.fy, r.month) {
                    Ok(rep) => (200, serde_json::to_string(&rep).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_discover_products" => {
            #[derive(serde::Deserialize)]
            struct Req {
                query: DiscoveryQuery,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_discover_products(db_path, r.query, r.vertical) {
                    Ok(page) => (200, serde_json::to_string(&page).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_discover_facets" => {
            #[derive(serde::Deserialize)]
            struct Req {
                query: DiscoveryQuery,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_discover_facets(db_path, r.query, r.vertical) {
                    Ok(facets) => (200, serde_json::to_string(&facets).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_get_filter_facets" => {
            #[derive(serde::Deserialize)]
            struct Req {
                vertical: Option<String>,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { vertical: None });
            match cmd_discover_facets(db_path, DiscoveryQuery::default(), req.vertical) {
                Ok(facets) => (200, serde_json::to_string(&facets).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_sell_graph" => {
            #[derive(serde::Deserialize)]
            struct Req {
                kind: omnibill_core::discovery::commands::GraphKind,
                params: omnibill_core::discovery::commands::GraphParams,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_sell_graph(db_path, r.kind, r.params, r.vertical) {
                    Ok(data) => (200, serde_json::to_string(&data).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_get_sell_graph_data" => {
            #[derive(serde::Deserialize)]
            struct Req {
                params: omnibill_core::discovery::commands::GraphParams,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_sell_graph(db_path, omnibill_core::discovery::commands::GraphKind::TopMovers, r.params, None) {
                    Ok(data) => (200, serde_json::to_string(&data).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_get_product_detail" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "resourceId")]
                resource_id: String,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_get_product_detail_guarded(auth_state, bearer, db_path, &r.resource_id, r.vertical, now_ms) {
                    Ok(detail) => (200, serde_json::to_string(&detail).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_record_purchase_stock_expense" => {
            match serde_json::from_str::<omnibill_core::posting::PurchaseInput>(args) {
                Ok(input) => match cmd_record_purchase_stock_expense_guarded(auth_state, bearer, db_path.to_string(), input, now_ms) {
                    Ok(res) => (200, serde_json::to_string(&res).unwrap_or_default()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_refresh_analytics" => {
            #[derive(serde::Deserialize)]
            struct Req {
                today: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { today: None });
            match cmd_refresh_analytics(db_path, req.today) {
                Ok(rep) => (200, serde_json::to_string(&rep).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_rebuild_analytics" => match cmd_rebuild_analytics_guarded(auth_state, bearer, db_path, now_ms) {
            Ok(rep) => (200, serde_json::json!({
                "sales_daily_rows": rep.sales_daily_rows,
                "sales_heat_rows": rep.sales_heat_rows,
                "product_stats_updated": rep.product_stats_updated,
            }).to_string()),
            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
        },
        "cmd_generate_alerts" => {
            #[derive(serde::Deserialize)]
            struct Req {
                vertical: Option<String>,
                today: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { vertical: None, today: None });
            match cmd_generate_alerts(db_path, req.vertical, req.today) {
                Ok(rep) => (200, serde_json::to_string(&rep).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_list_alerts" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "includeAcknowledged", default)]
                include_acknowledged: bool,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { include_acknowledged: false });
            match cmd_list_alerts(db_path, req.include_acknowledged) {
                Ok(alerts) => (200, serde_json::to_string(&alerts).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_get_discovery_alerts" => {
            #[derive(serde::Deserialize)]
            struct Req {
                vertical: Option<String>,
                today: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { vertical: None, today: None });
            match cmd_generate_alerts(db_path, req.vertical, req.today) {
                Ok(alerts) => (200, serde_json::to_string(&alerts).unwrap_or_default()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_acknowledge_alert" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "alertId")]
                alert_id: i64,
                today: Option<i64>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_acknowledge_alert(db_path, r.alert_id, r.today) {
                    Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_acknowledge_discovery_alert" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "alertId")]
                alert_id: i64,
                today: Option<i64>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_acknowledge_alert(db_path, r.alert_id, r.today) {
                    Ok(()) => (200, serde_json::json!({ "success": true }).to_string()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_export_discovery" => {
            #[derive(serde::Deserialize)]
            struct Req {
                query: DiscoveryQuery,
                vertical: Option<String>,
                today: Option<i64>,
                #[serde(rename = "outDir")]
                out_dir: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_export_discovery(db_path, r.query, r.vertical, r.today, r.out_dir) {
                    Ok(path) => (200, serde_json::json!({ "path": path }).to_string()),
                    Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_day_summary_text" => {
            #[derive(serde::Deserialize)]
            struct Req {
                vertical: Option<String>,
                day: Option<i64>,
            }
            let req = serde_json::from_str::<Req>(args).unwrap_or(Req { vertical: None, day: None });
            match cmd_day_summary_text(db_path, req.vertical, req.day) {
                Ok(text) => (200, serde_json::json!({ "summary": text }).to_string()),
                Err(e) => (400, serde_json::json!({ "error": e }).to_string()),
            }
        }
        "cmd_backup_create" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "outPath")]
                out_path: String,
                passphrase: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_backup_create_guarded(auth_state, bearer, db_path.to_string(), r.out_path, r.passphrase, now_ms) {
                    Ok(meta) => (200, serde_json::to_string(&meta).unwrap_or_default()),
                    Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_backup_restore" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "backupPath")]
                backup_path: String,
                passphrase: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => match cmd_backup_restore_guarded(auth_state, bearer, r.backup_path, db_path.to_string(), r.passphrase, now_ms) {
                    Ok(_summary) => (200, serde_json::json!({ "success": true }).to_string()),
                    Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
                },
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_print_receipt" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "invoiceNumber")]
                invoice_number: Option<String>,
            }
            let req = serde_json::from_str::<Req>(args).ok();
            let dummy_data = omnibill_core::hardware::printer::ReceiptData {
                store_name: "OmniBill Store".into(),
                address: None,
                gstin: None,
                phone: None,
                trade_name: None,
                invoice_number: req
                    .and_then(|r| r.invoice_number)
                    .unwrap_or_else(|| "INV-001".into()),
                invoice_date: "2026-10-21".into(),
                customer_name: None,
                customer_gstin: None,
                items: Vec::new(),
                tax_summary: omnibill_core::hardware::printer::ReceiptTaxSummary {
                    subtotal_paise: 0,
                    discount_paise: 0,
                    taxable_paise: 0,
                    cgst_paise: 0,
                    sgst_paise: 0,
                    igst_paise: 0,
                    round_off_paise: 0,
                    total_amount_paise: 0,
                },
                upi_qr_string: None,
                footer_note: None,
            };
            match cmd_print_receipt_guarded(
                auth_state,
                bearer,
                dummy_data,
                omnibill_core::hardware::printer::PaperWidth::Width80mm,
                now_ms,
            ) {
                Ok(bytes) => (
                    200,
                    serde_json::json!({ "bytes_len": bytes.len() }).to_string(),
                ),
                Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
            }
        }
        _ => (404, serde_json::json!({ "error": "Not Found" }).to_string()),
    }
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
        handle_client(stream, db_path, port);
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
        "--encrypt-existing-db" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            let path_obj = Path::new(db_path);
            let app_dir = path_obj.parent().unwrap_or(Path::new("."));
            let store = omnibill_core::access::dbkey::default_keystore();
            match omnibill_core::access::dbopen::encrypt_existing_database(app_dir, store.as_ref()) {
                Ok(()) => {
                    println!("Database successfully encrypted at rest.");
                }
                Err(e) => {
                    eprintln!("Encryption migration failed: {}", e);
                    std::process::exit(1);
                }
            }
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

#[cfg(test)]
mod server_hygiene_tests {
    use super::*;

    #[test]
    fn test_wrong_host_rejected_with_403() {
        let req = "GET /api/info HTTP/1.1\r\nHost: evil.attacker.com\r\n\r\n";
        let (status, body, _) = process_http_request(req, 4000, "test.db");
        assert_eq!(status, 403);
        assert!(body.contains("Host"));
    }

    #[test]
    fn test_valid_host_accepted() {
        let req1 = "GET /api/info HTTP/1.1\r\nHost: 127.0.0.1:4000\r\n\r\n";
        let (status1, body1, _) = process_http_request(req1, 4000, "test.db");
        assert_eq!(status1, 200);
        assert!(body1.contains("OmniBill"));

        let req2 = "GET /api/info HTTP/1.1\r\nHost: localhost:4000\r\n\r\n";
        let (status2, body2, _) = process_http_request(req2, 4000, "test.db");
        assert_eq!(status2, 200);
        assert!(body2.contains("OmniBill"));
    }

    #[test]
    fn test_foreign_origin_rejected_with_403() {
        let req = "GET /api/info HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nOrigin: https://evil-site.com\r\n\r\n";
        let (status, body, _) = process_http_request(req, 4000, "test.db");
        assert_eq!(status, 403);
        assert!(body.contains("Origin"));
    }

    #[test]
    fn test_allowed_origin_accepted_without_wildcard() {
        let req = "GET /api/info HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nOrigin: http://localhost:1420\r\n\r\n";
        let (status, _, origin) = process_http_request(req, 4000, "test.db");
        assert_eq!(status, 200);
        assert_eq!(origin.as_deref(), Some("http://localhost:1420"));
    }

    #[test]
    fn test_oversize_body_rejected_with_413() {
        let big_body = "x".repeat(MAX_BODY_SIZE + 10);
        let req = format!(
            "POST /api/info HTTP/1.1\r\nHost: 127.0.0.1:4000\r\nContent-Length: {}\r\n\r\n{}",
            big_body.len(),
            big_body
        );
        let (status, body, _) = process_http_request(&req, 4000, "test.db");
        assert_eq!(status, 413);
        assert!(body.contains("Payload Too Large"));
    }
}
