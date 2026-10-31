use omnibill_core::access::guard::{AppAuthState, GuardError, authorize};
use omnibill_core::commands::*;
use omnibill_core::database::migrations::{MIGRATIONS, get_user_version, run_migrations};
use omnibill_core::database::open_connection;
use omnibill_core::database::queries::verify_ledger;
use omnibill_core::discovery::commands::*;
use omnibill_core::discovery::query::DiscoveryQuery;
use omnibill_core::reports::get_trial_balance;
use std::collections::HashMap;
use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use uuid::Uuid;

static VERTICAL_AUTH_STATES: LazyLock<Mutex<HashMap<String, Arc<AppAuthState>>>> = LazyLock::new(|| {
    let mut map = HashMap::new();
    map.insert("retail".to_string(), Arc::new(AppAuthState::new("retail")));
    map.insert("wholesale".to_string(), Arc::new(AppAuthState::new("wholesale")));
    map.insert("school".to_string(), Arc::new(AppAuthState::new("school")));
    map.insert("hospital".to_string(), Arc::new(AppAuthState::new("hospital")));
    Mutex::new(map)
});

pub fn get_vertical_auth_state(vertical: &str) -> Arc<AppAuthState> {
    let vert = match vertical.trim().to_lowercase().as_str() {
        "wholesale" => "wholesale",
        "school" => "school",
        "hospital" => "hospital",
        _ => "retail",
    };
    let mut map = VERTICAL_AUTH_STATES.lock().unwrap();
    map.entry(vert.to_string())
        .or_insert_with(|| Arc::new(AppAuthState::new(vert)))
        .clone()
}

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
    --init [db_path]                       Initialize database, apply schema migrations & seed accounts
    --create-owner [user] [pass] [db]      Seed/create primary Owner (Super Admin) account
    --audit [db_path]                      Run point-in-time double-entry consistency audit (verify_ledger)
    --info [db_path]                       Display database status, user_version, and ledger balance
    --backup [target_bak] [source_db]      Create verified online encrypted backup archive
    --restore-preview [backup_path]        Inspect backup archive contents, checksum, and transactions
    --restore [backup_path] [target_db]    Safely restore database from backup with pre-restore safety snapshot
    --serve [port] [path]                  Start embedded zero-dependency HTTP bridge on 127.0.0.1 (default port: 4000)
    --help                                 Display this manual
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
                ensure_default_staff_accounts(&conn);
            }
            Err(e) => eprintln!("[OmniBill] ERROR migrating database: {}", e),
        },
        Err(e) => eprintln!("[OmniBill] ERROR opening database connection: {}", e),
    }
}

pub fn ensure_default_staff_accounts(conn: &rusqlite::Connection) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    // 1. Primary Owner (admin / Admin@OmniBill2026!)
    let owner_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE is_primary_owner = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let owner_id = if owner_count == 0 {
        match omnibill_core::access::users::create_primary_owner(
            conn,
            "admin",
            "Store Owner",
            "Admin@OmniBill2026!",
            now_ms,
        ) {
            Ok(id) => {
                println!("[OmniBill] SUCCESS: Primary Owner 'admin' created (ID: {})", id);
                id
            }
            Err(e) => {
                eprintln!("[OmniBill] Notice creating owner: {}", e);
                1
            }
        }
    } else {
        conn.query_row("SELECT id FROM app_users WHERE is_primary_owner = 1", [], |r| r.get(0)).unwrap_or(1)
    };

    // 2. Store Manager (manager / Manager@OmniBill2026!)
    let manager_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE username = 'manager'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if manager_count == 0 {
        let input = omnibill_core::access::users::CreateUserInput {
            username: "manager".to_string(),
            display_name: "Store Manager".to_string(),
            password: "Manager@OmniBill2026!".to_string(),
            role: "manager".to_string(),
        };
        let _ = omnibill_core::access::users::create_user(conn, owner_id, input, "retail", now_ms);
        println!("[OmniBill] SUCCESS: Staff user 'manager' created.");
    }

    // 3. Cashier (cashier1 / Cashier@OmniBill2026!)
    let cashier_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE username = 'cashier1'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if cashier_count == 0 {
        let input = omnibill_core::access::users::CreateUserInput {
            username: "cashier1".to_string(),
            display_name: "Counter Cashier".to_string(),
            password: "Cashier@OmniBill2026!".to_string(),
            role: "cashier".to_string(),
        };
        let _ = omnibill_core::access::users::create_user(conn, owner_id, input, "retail", now_ms);
        println!("[OmniBill] SUCCESS: Staff user 'cashier1' created.");
    }

    // Also sync to legacy users table
    for (u, p, name, role) in &[
        ("admin", "Admin@OmniBill2026!", "Store Owner", "OWNER"),
        ("manager", "Manager@OmniBill2026!", "Store Manager", "MANAGER"),
        ("cashier1", "Cashier@OmniBill2026!", "Counter Cashier", "CASHIER"),
    ] {
        let exists: i64 = conn.query_row(
            "SELECT count(*) FROM users WHERE username = ?1",
            rusqlite::params![u],
            |r| r.get(0),
        ).unwrap_or(0);
        if exists == 0 {
            let hash = omnibill_core::access::password::hash_password(p).unwrap_or_else(|_| "hash".to_string());
            let _ = conn.execute(
                "INSERT INTO users (id, username, password_hash, full_name, role, is_active)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                rusqlite::params![format!("usr_{}", u), u, hash, name, role],
            );
        }
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

fn handle_create_owner(username: &str, password: &str, db_path: &str) {
    println!("[OmniBill] Configuring Super Admin '{}' in: {}", username, db_path);
    let conn = match open_connection(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[OmniBill] Error opening database connection: {}", e);
            return;
        }
    };

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    // Check if primary owner already exists in app_users
    let owner_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE is_primary_owner = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if owner_count > 0 {
        println!("[OmniBill] INFO: A Primary Owner account already exists in app_users.");
    } else {
        match omnibill_core::access::users::create_primary_owner(
            &conn,
            username,
            "Super Administrator",
            password,
            now_ms,
        ) {
            Ok(id) => println!("[OmniBill] SUCCESS: Primary Owner created in app_users with ID #{}", id),
            Err(e) => eprintln!("[OmniBill] Notice from auth policy: {}", e),
        }
    }

    // Also populate legacy users table for complete compatibility
    let legacy_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM users WHERE username = ?1",
            rusqlite::params![username],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if legacy_exists == 0 {
        let hash = omnibill_core::access::password::hash_password(password).unwrap_or_else(|_| "hash_admin".to_string());
        let _ = conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role, is_active)
             VALUES ('usr_admin', ?1, ?2, 'Super Administrator', 'ADMIN', 1)",
            rusqlite::params![username, hash],
        );
        println!("[OmniBill] SUCCESS: Super Admin registered in users table.");
    }

    println!("================================================================================");
    println!(" OmniBill Super User Credentials:");
    println!("   Username : {}", username);
    println!("   Password : {}", password);
    println!("   Role     : Super Administrator (owner / ADMIN)");
    println!("================================================================================");
}

fn handle_backup(target_bak: &str, source_db: &str) {
    println!("[OmniBill] Creating online encrypted backup: {} -> {}", source_db, target_bak);
    let conn = match open_connection(source_db) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[OmniBill] ERROR opening database {}: {}", source_db, e);
            std::process::exit(1);
        }
    };
    match omnibill_core::hardware::backup::create_backup(&conn, target_bak, None) {
        Ok(summary) => {
            println!("[OmniBill] BACKUP SUCCESSFUL:");
            println!("  Backup ID:       {}", summary.backup_id);
            println!("  Created At:      {}", summary.created_at);
            println!("  Schema Version:  {}", summary.schema_version);
            println!("  SHA-256:         {}", summary.sha256_checksum);
            println!("  Total Bytes:     {} bytes", summary.total_bytes);
            println!("  Path:            {}", target_bak);
        }
        Err(e) => {
            eprintln!("[OmniBill] BACKUP ERROR: {:?}", e);
            std::process::exit(1);
        }
    }
}

fn handle_restore_preview(backup_path: &str) {
    println!("[OmniBill] Inspecting backup archive for preview: {}", backup_path);
    match omnibill_core::hardware::backup::preview_backup(backup_path, None) {
        Ok(preview) => {
            println!("[OmniBill] RESTORE PREVIEW METADATA:");
            println!("  Backup ID:             {}", preview.backup_id);
            println!("  Created At:            {}", preview.created_at);
            println!("  Schema Version:        {}", preview.schema_version);
            println!("  SHA-256 Checksum:      {}", preview.sha256_checksum);
            println!("  Total Bytes:           {} bytes", preview.total_bytes);
            println!("  Is Encrypted:          {}", preview.is_encrypted);
            println!("  Transaction Count:     {}", preview.transaction_count);
            println!("  Last Invoice Number:   {}", preview.last_invoice_number.as_deref().unwrap_or("None"));
            println!("  Account Count:         {}", preview.account_count);
        }
        Err(e) => {
            eprintln!("[OmniBill] PREVIEW ERROR: {:?}", e);
            std::process::exit(1);
        }
    }
}

fn handle_restore(backup_path: &str, target_db: &str) {
    println!("[OmniBill] Restoring backup to database: {} -> {}", backup_path, target_db);
    match omnibill_core::hardware::backup::restore_backup(backup_path, target_db, None) {
        Ok(summary) => {
            println!("[OmniBill] RESTORE SUCCESSFUL:");
            println!("  Backup ID:       {}", summary.backup_id);
            println!("  Created At:      {}", summary.created_at);
            println!("  Restored Ver:    {}", summary.schema_version);
            println!("  SHA-256:         {}", summary.sha256_checksum);
            println!("  Target File:     {}", target_db);
        }
        Err(e) => {
            eprintln!("[OmniBill] RESTORE ERROR: {:?}", e);
            std::process::exit(1);
        }
    }
}

pub const MAX_BODY_SIZE: usize = 10_485_760; // 10 MB limit

pub fn is_allowed_origin(origin: &str, port: u16) -> bool {
    let port_str = port.to_string();
    origin == "http://localhost:1420"
        || origin == "http://127.0.0.1:1420"
        || origin == "http://localhost:5173"
        || origin == "http://127.0.0.1:5173"
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
    pub vertical: Option<&'a str>,
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
    let mut vertical = None;

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
            } else if key.eq_ignore_ascii_case("x-vertical") || key.eq_ignore_ascii_case("x-business-type") {
                vertical = Some(val);
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
        vertical,
        body,
    })
}

pub fn resolve_vertical_db_path(base_db_path: &str, vertical: Option<&str>) -> String {
    let vert = match vertical {
        Some(v) => match v.trim().to_lowercase().as_str() {
            "wholesale" => "wholesale",
            "school" => "school",
            "hospital" => "hospital",
            _ => "retail",
        },
        None => "retail",
    };

    let p = Path::new(base_db_path);
    let parent = p.parent().unwrap_or(Path::new("."));
    parent.join(format!("omnibill_{}.db", vert)).to_string_lossy().to_string()
}

pub fn get_or_init_vertical_db(path: &str) -> Result<rusqlite::Connection, rusqlite::Error> {
    let mut conn = open_connection(path)?;
    let v = get_user_version(&conn).unwrap_or(0);
    let target_v = MIGRATIONS.len() as i32;
    if v < target_v {
        if let Err(e) = run_migrations(&mut conn, MIGRATIONS) {
            eprintln!("[OmniBill] Error auto-migrating vertical DB {}: {}", path, e);
        } else {
            println!("[OmniBill] Successfully initialized isolated vertical DB {} (schema v{})", path, target_v);
        }
    }
    ensure_default_staff_accounts(&conn);
    Ok(conn)
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

    let vert = match req.vertical {
        Some(v) => match v.trim().to_lowercase().as_str() {
            "wholesale" => "wholesale",
            "school" => "school",
            "hospital" => "hospital",
            _ => "retail",
        },
        None => "retail",
    };

    let active_db_path = resolve_vertical_db_path(db_path, req.vertical);
    let _ = get_or_init_vertical_db(&active_db_path);

    if req.path == "/api/sync/all" {
        let kv_map = match open_connection(&active_db_path) {
            Ok(conn) => {
                let _ = conn.execute(
                    "CREATE TABLE IF NOT EXISTS app_shared_kv (key TEXT PRIMARY KEY, val TEXT, updated_at INTEGER)",
                    [],
                );
                let mut map = serde_json::Map::new();
                if let Ok(mut stmt) = conn.prepare("SELECT key, val FROM app_shared_kv") {
                    if let Ok(rows) = stmt.query_map([], |row| {
                        let k: String = row.get(0)?;
                        let v: String = row.get(1)?;
                        Ok((k, v))
                    }) {
                        for item in rows.flatten() {
                            map.insert(item.0, serde_json::Value::String(item.1));
                        }
                    }
                }
                serde_json::Value::Object(map)
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }),
        };
        return (200, kv_map.to_string(), req.origin.map(String::from));
    }

    if req.path == "/api/sync/set" {
        let res = match open_connection(&active_db_path) {
            Ok(conn) => {
                let _ = conn.execute(
                    "CREATE TABLE IF NOT EXISTS app_shared_kv (key TEXT PRIMARY KEY, val TEXT, updated_at INTEGER)",
                    [],
                );
                if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&req.body) {
                    if let (Some(k), Some(v)) = (payload.get("key").and_then(|k| k.as_str()), payload.get("val")) {
                        let val_str = if let Some(s) = v.as_str() {
                            s.to_string()
                        } else {
                            v.to_string()
                        };
                        let now_ms = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64;
                        let _ = conn.execute(
                            "INSERT OR REPLACE INTO app_shared_kv (key, val, updated_at) VALUES (?1, ?2, ?3)",
                            rusqlite::params![k, val_str, now_ms],
                        );
                        serde_json::json!({ "success": true })
                    } else {
                        serde_json::json!({ "error": "Missing key or val" })
                    }
                } else {
                    serde_json::json!({ "error": "Invalid JSON body" })
                }
            }
            Err(e) => serde_json::json!({ "error": e.to_string() }),
        };
        return (200, res.to_string(), req.origin.map(String::from));
    }

    let auth_state = get_vertical_auth_state(vert);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let bearer = req
        .authorization
        .and_then(|a| a.trim().strip_prefix("Bearer ").map(|t| t.trim()));

    let (status, body) = guarded_dispatch(&auth_state, bearer, req.path, req.body, now_ms, &active_db_path);
    (status, body, req.origin.map(String::from))
}

fn handle_client(mut stream: TcpStream, db_path: &str, port: u16) {
    let mut req_bytes = Vec::new();
    let mut buf = [0u8; 16384];
    let mut content_length: Option<usize> = None;
    let mut header_len: Option<usize> = None;

    loop {
        let bytes_read = match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(b) => b,
            Err(_) => break,
        };
        req_bytes.extend_from_slice(&buf[..bytes_read]);

        if header_len.is_none() {
            if let Some(pos) = req_bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                header_len = Some(pos + 4);
                let head_str = String::from_utf8_lossy(&req_bytes[..pos]);
                for line in head_str.lines() {
                    if let Some(colon) = line.find(':') {
                        let k = line[..colon].trim();
                        let v = line[colon + 1..].trim();
                        if k.eq_ignore_ascii_case("content-length") {
                            content_length = v.parse::<usize>().ok();
                        }
                    }
                }
            }
        }

        if let (Some(hlen), Some(clen)) = (header_len, content_length) {
            if req_bytes.len() >= hlen + clen {
                break;
            }
        } else if header_len.is_some() && content_length.is_none() {
            break;
        }

        if req_bytes.len() > MAX_BODY_SIZE + 65536 {
            break;
        }
    }

    if req_bytes.is_empty() {
        return;
    }

    let req_str = String::from_utf8_lossy(&req_bytes);
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
             Access-Control-Allow-Headers: Content-Type, Authorization, X-Vertical, X-Business-Type\r\n\
             Cache-Control: no-store\r\n\
             Connection: close\r\n\r\n",
            cors_header
        )
    } else {
        format!(
            "HTTP/1.1 {} {}\r\n\
             Content-Type: application/json\r\n\
             {}\
             Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
             Access-Control-Allow-Headers: Content-Type, Authorization, X-Vertical, X-Business-Type\r\n\
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
        "activate_licence" => {
            let res = omnibill_core::access::activation::cmd_activate_licence(std::path::Path::new(db_path), args);
            (200, res)
        }
        "owner_reset_with_code" => {
            let res = omnibill_core::access::owner_reset::cmd_owner_reset_with_code(std::path::Path::new(db_path), args);
            (200, res)
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
                out_path: Option<String>,
                passphrase: Option<String>,
                vertical: Option<String>,
                #[serde(rename = "includeAll")]
                include_all: Option<bool>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => {
                    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    let backups_dir = format!("{}/omnibill_backups", home);
                    let _ = std::fs::create_dir_all(&backups_dir);

                    let ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();

                    if r.include_all == Some(true) {
                        let verticals = ["retail", "wholesale", "school", "hospital"];
                        let mut results = Vec::new();

                        for v in verticals {
                            let v_db = resolve_vertical_db_path(db_path, Some(v));
                            if Path::new(&v_db).exists() {
                                let v_out = format!("{}/omnibill_backup_{}_{}.omnibackup", backups_dir, v, ts);
                                if let Ok(conn) = open_connection(&v_db) {
                                    if let Ok(meta) = omnibill_core::hardware::backup::create_backup(&conn, &v_out, r.passphrase.as_deref()) {
                                        results.push(serde_json::json!({
                                            "vertical": v,
                                            "out_path": v_out,
                                            "filename": format!("omnibill_backup_{}_{}.omnibackup", v, ts),
                                            "metadata": meta
                                        }));
                                    }
                                }
                            }
                        }

                        (200, serde_json::json!({
                            "scope": "ALL",
                            "created_at_epoch": ts,
                            "backups": results
                        }).to_string())
                    } else {
                        let vert = r.vertical.as_deref().unwrap_or("retail");
                        let active_target_db = resolve_vertical_db_path(db_path, Some(vert));
                        let out_file = r.out_path.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
                            format!("{}/omnibill_backup_{}_{}.omnibackup", backups_dir, vert, ts)
                        });

                        match cmd_backup_create_guarded(auth_state, bearer, active_target_db, out_file.clone(), r.passphrase, now_ms) {
                            Ok(meta) => {
                                let b64 = match std::fs::read(&out_file) {
                                    Ok(bytes) => Some(BASE64.encode(&bytes)),
                                    Err(_) => None,
                                };
                                let filename = Path::new(&out_file)
                                    .file_name()
                                    .and_then(|f| f.to_str())
                                    .unwrap_or("backup.omnibackup")
                                    .to_string();

                                (200, serde_json::json!({
                                    "backup_id": meta.backup_id,
                                    "created_at": meta.created_at,
                                    "schema_version": meta.schema_version,
                                    "sha256_checksum": meta.sha256_checksum,
                                    "total_bytes": meta.total_bytes,
                                    "out_path": out_file,
                                    "filename": filename,
                                    "vertical": vert,
                                    "base64_data": b64
                                }).to_string())
                            }
                            Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
                        }
                    }
                }
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_backup_restore" => {
            #[derive(serde::Deserialize)]
            struct Req {
                #[serde(rename = "backupPath")]
                backup_path: Option<String>,
                #[serde(rename = "backupData")]
                backup_data_base64: Option<String>,
                passphrase: Option<String>,
                vertical: Option<String>,
            }
            match serde_json::from_str::<Req>(args) {
                Ok(r) => {
                    let vert = r.vertical.as_deref().unwrap_or("retail");
                    let active_target_db = resolve_vertical_db_path(db_path, Some(vert));

                    // If file uploaded as base64, save to a temp file
                    let file_to_restore = if let Some(ref b64) = r.backup_data_base64 {
                        match BASE64.decode(b64.trim()) {
                            Ok(bytes) => {
                                let tmp_path = std::env::temp_dir().join(format!("omnibill_restore_{}.omnibackup", Uuid::new_v4()));
                                if let Err(e) = std::fs::write(&tmp_path, bytes) {
                                    return (500, serde_json::json!({ "error": format!("Failed to write restore temp file: {}", e) }).to_string());
                                }
                                tmp_path.to_string_lossy().to_string()
                            }
                            Err(e) => {
                                return (400, serde_json::json!({ "error": format!("Invalid base64 backup data: {}", e) }).to_string());
                            }
                        }
                    } else if let Some(ref p) = r.backup_path {
                        p.clone()
                    } else {
                        return (400, serde_json::json!({ "error": "Either backupPath or backupData must be provided" }).to_string());
                    };

                    // Automatic Safety Pre-Restore Snapshot of active DB before overwriting!
                    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
                    let backups_dir = format!("{}/omnibill_backups", home);
                    let _ = std::fs::create_dir_all(&backups_dir);
                    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
                    let safety_snapshot_path = format!("{}/safety_pre_restore_{}_{}.omnibackup", backups_dir, vert, ts);

                    if Path::new(&active_target_db).exists() {
                        let _ = cmd_backup_create_guarded(auth_state, bearer, active_target_db.clone(), safety_snapshot_path.clone(), None, now_ms);
                    }

                    match cmd_backup_restore_guarded(auth_state, bearer, file_to_restore, active_target_db.clone(), r.passphrase, now_ms) {
                        Ok(summary) => (200, serde_json::json!({
                            "success": true,
                            "restored_db": active_target_db,
                            "safety_backup_path": safety_snapshot_path,
                            "summary": summary
                        }).to_string()),
                        Err(e) => (500, serde_json::json!({ "error": e }).to_string()),
                    }
                }
                Err(e) => (400, serde_json::json!({ "error": e.to_string() }).to_string()),
            }
        }
        "cmd_backup_list" => {
            let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let backups_dir = format!("{}/omnibill_backups", home);
            let _ = std::fs::create_dir_all(&backups_dir);

            let mut list = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&backups_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map(|e| e == "omnibackup").unwrap_or(false) {
                        let filename = path.file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();
                        let metadata = match entry.metadata() {
                            Ok(m) => m,
                            Err(_) => continue,
                        };
                        let size_bytes = metadata.len();
                        let modified_ms = metadata.modified()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)))
                            .unwrap_or(0);

                        // Read header snippet (first 1024 bytes)
                        let mut header_info = serde_json::json!({
                            "backup_id": null,
                            "created_at": null,
                            "schema_version": null,
                            "encrypted": false,
                            "checksum": null,
                        });

                        if let Ok(file_bytes) = std::fs::read(&path) {
                            if file_bytes.starts_with(omnibill_core::hardware::backup::MAGIC_HEADER.as_bytes()) {
                                if let Some(pos) = file_bytes.windows(2).position(|w| w == b"\n\n") {
                                    if let Ok(header_text) = std::str::from_utf8(&file_bytes[..pos]) {
                                        for line in header_text.lines() {
                                            if let Some(val) = line.strip_prefix("BACKUP_ID: ") {
                                                header_info["backup_id"] = serde_json::json!(val.trim());
                                            } else if let Some(val) = line.strip_prefix("CREATED_AT: ") {
                                                header_info["created_at"] = serde_json::json!(val.trim());
                                            } else if let Some(val) = line.strip_prefix("SCHEMA_VERSION: ") {
                                                if let Ok(v) = val.trim().parse::<i32>() {
                                                    header_info["schema_version"] = serde_json::json!(v);
                                                }
                                            } else if let Some(val) = line.strip_prefix("ENCRYPTED: ") {
                                                header_info["encrypted"] = serde_json::json!(val.trim() == "1");
                                            } else if let Some(val) = line.strip_prefix("CHECKSUM: ") {
                                                header_info["checksum"] = serde_json::json!(val.trim());
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        let vertical = if filename.contains("retail") {
                            "RETAIL"
                        } else if filename.contains("wholesale") {
                            "WHOLESALE"
                        } else if filename.contains("school") {
                            "SCHOOL"
                        } else if filename.contains("hospital") {
                            "HOSPITAL"
                        } else {
                            "ALL"
                        };

                        list.push(serde_json::json!({
                            "filename": filename,
                            "path": path.to_string_lossy().to_string(),
                            "size_bytes": size_bytes,
                            "modified_ms": modified_ms,
                            "vertical": vertical,
                            "details": header_info,
                        }));
                    }
                }
            }

            list.sort_by(|a, b| {
                let ta = a["modified_ms"].as_i64().unwrap_or(0);
                let tb = b["modified_ms"].as_i64().unwrap_or(0);
                tb.cmp(&ta)
            });

            (200, serde_json::json!({ "backups": list }).to_string())
        }
        "cmd_backup_health" => {
            let verticals = ["retail", "wholesale", "school", "hospital"];
            let mut health_list = Vec::new();

            for v in verticals {
                let v_path = resolve_vertical_db_path(db_path, Some(v));
                let exists = Path::new(&v_path).exists();

                if exists {
                    let size = std::fs::metadata(&v_path).map(|m| m.len()).unwrap_or(0);
                    let (version, integrity, entities_count, resources_count, sales_count) = match open_connection(&v_path) {
                        Ok(conn) => {
                            let ver: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0);
                            let integ: String = conn.query_row("PRAGMA integrity_check(1)", [], |r| r.get(0)).unwrap_or_else(|e| format!("Error: {}", e));
                            let ent: i64 = conn.query_row("SELECT count(*) FROM entities", [], |r| r.get(0)).unwrap_or(0);
                            let res: i64 = conn.query_row("SELECT count(*) FROM resources", [], |r| r.get(0)).unwrap_or(0);
                            let sls: i64 = conn.query_row("SELECT count(*) FROM sales", [], |r| r.get(0)).unwrap_or(0);
                            (ver, integ, ent, res, sls)
                        }
                        Err(e) => (0, format!("Failed to connect: {}", e), 0, 0, 0),
                    };

                    health_list.push(serde_json::json!({
                        "vertical": v.to_uppercase(),
                        "path": v_path,
                        "exists": true,
                        "size_bytes": size,
                        "schema_version": version,
                        "integrity": integrity,
                        "is_healthy": integrity == "ok",
                        "records": {
                            "entities": entities_count,
                            "resources": resources_count,
                            "sales": sales_count
                        }
                    }));
                } else {
                    health_list.push(serde_json::json!({
                        "vertical": v.to_uppercase(),
                        "path": v_path,
                        "exists": false,
                        "size_bytes": 0,
                        "schema_version": 0,
                        "integrity": "not_created",
                        "is_healthy": false,
                        "records": { "entities": 0, "resources": 0, "sales": 0 }
                    }));
                }
            }

            (200, serde_json::json!({
                "databases": health_list,
                "checked_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
            }).to_string())
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
        "--create-owner" => {
            let username = args.get(2).map(|s| s.as_str()).unwrap_or("admin");
            let password = args.get(3).map(|s| s.as_str()).unwrap_or("Admin@OmniBill2026!");
            let db_path = args.get(4).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_create_owner(username, password, db_path);
        }
        "--audit" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_audit(db_path);
        }
        "--info" => {
            let db_path = args.get(2).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_info(db_path);
        }
        "--backup" => {
            let target_bak = args.get(2).map(|s| s.as_str()).expect("Usage: omnibill --backup <target_bak> [source_db]");
            let source_db = args.get(3).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_backup(target_bak, source_db);
        }
        "--restore-preview" => {
            let backup_path = args.get(2).map(|s| s.as_str()).expect("Usage: omnibill --restore-preview <backup_path>");
            handle_restore_preview(backup_path);
        }
        "--restore" => {
            let backup_path = args.get(2).map(|s| s.as_str()).expect("Usage: omnibill --restore <backup_path> [target_db]");
            let target_db = args.get(3).map(|s| s.as_str()).unwrap_or(&default_db);
            handle_restore(backup_path, target_db);
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
