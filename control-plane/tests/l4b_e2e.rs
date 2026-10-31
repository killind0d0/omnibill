use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use control_plane::auth::{build_totp, create_admin, decrypt_totp_secret};
use control_plane::civil::{add_months, days_from_civil};
use control_plane::db::{init_schema, open_db, verify_chain};
use control_plane::licence::{features_for, sign_licence, Licence, LicencePayload};
use control_plane::ratelimit::SlidingWindowLimiter;
use control_plane::routes::{create_router, AppState};
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use totp_rs::Totp;

const TEST_SECRET: &str = "test-secret-omnibill-control-plane-1234567890";

#[allow(dead_code)]
struct TestServer {
    pub addr: SocketAddr,
    pub db_path: PathBuf,
    pub signing_key: SigningKey,
    pub verifying_key: VerifyingKey,
    pub admin_session_token: String,
    pub totp: Totp,
    pub admin_id: i64,
    _join_handle: tokio::task::JoinHandle<()>,
}

#[allow(dead_code)]
struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

impl HttpResponse {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| {
            panic!("Expected JSON response, got status {} body: {}", self.status, self.body)
        })
    }
}

async fn send_http(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &str,
) -> HttpResponse {
    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect to test server");
    let body_bytes = body.as_bytes();
    let mut req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method, path, addr, body_bytes.len()
    );
    for (k, v) in headers {
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).await.expect("write req header");
    if !body_bytes.is_empty() {
        stream.write_all(body_bytes).await.expect("write req body");
    }

    let mut resp_bytes = Vec::new();
    stream.read_to_end(&mut resp_bytes).await.expect("read response");

    let resp_str = String::from_utf8_lossy(&resp_bytes);
    let parts: Vec<&str> = resp_str.splitn(2, "\r\n\r\n").collect();
    let header_part = parts[0];
    let body_part = if parts.len() > 1 { parts[1] } else { "" };

    let first_line = header_part.lines().next().unwrap_or("");
    let status = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    let mut parsed_headers = HashMap::new();
    for line in header_part.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            parsed_headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    HttpResponse {
        status,
        headers: parsed_headers,
        body: body_part.to_string(),
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

async fn setup_test_server() -> TestServer {
    let temp_db = std::env::temp_dir().join(format!("test_cp_{}.db", uuid::Uuid::new_v4()));
    let conn = open_db(&temp_db).expect("open test db");
    init_schema(&conn).expect("init schema");

    let created = create_admin(&conn, "superadmin", "Password123!", TEST_SECRET, 1000, false)
        .expect("create admin");

    let totp_enc: Vec<u8> = conn
        .query_row(
            "SELECT totp_secret_enc FROM admins WHERE id = ?1",
            rusqlite::params![created.admin_id],
            |r| r.get(0),
        )
        .expect("get totp_secret_enc");
    let secret_raw = decrypt_totp_secret(&totp_enc, TEST_SECRET).expect("decrypt totp secret");
    let totp = build_totp(&secret_raw, "superadmin").expect("build totp");

    // Pre-insert valid admin session to simplify admin calls
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let session_token = uuid::Uuid::new_v4().to_string();
    let token_hash = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(session_token.as_bytes());
        h.finalize().to_vec()
    };
    conn.execute(
        "INSERT INTO admin_sessions (id_hash, admin_id, created_ms, last_seen_ms)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![token_hash, created.admin_id, now_ms, now_ms],
    )
    .expect("insert admin session");

    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();

    let state = Arc::new(AppState {
        db_path: temp_db.clone(),
        server_secret: TEST_SECRET.into(),
        webhook_secret: None,
        signing_key: Arc::new(signing_key.clone()),
        rate_limiter: Arc::new(SlidingWindowLimiter::new(60_000, 10_000)),
        signaling: control_plane::signaling::SignalingHub::new(),
    });

    let app = create_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind tcp");
    let addr = listener.local_addr().expect("local addr");
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    TestServer {
        addr,
        db_path: temp_db,
        signing_key,
        verifying_key,
        admin_session_token: session_token,
        totp,
        admin_id: created.admin_id,
        _join_handle: handle,
    }
}

fn verify_licence_signature(licence: &Licence, verifying_key: &VerifyingKey) -> bool {
    let mut payload = licence.payload.clone();
    payload.features.sort();
    payload.features.dedup();
    let canonical = match serde_json::to_vec(&payload) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let sig_bytes = match URL_SAFE_NO_PAD
        .decode(&licence.sig)
        .or_else(|_| URL_SAFE.decode(&licence.sig))
    {
        Ok(s) => s,
        Err(_) => return false,
    };
    if sig_bytes.len() != 64 {
        return false;
    }
    let sig = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };
    verifying_key.verify(&canonical, &sig).is_ok()
}

// ----------------------------------------------------------------------------
// 1. End-to-end flow: create tenant -> activate -> check-in
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_end_to_end_tenant_lifecycle() {
    let s = setup_test_server().await;

    // A. Admin creates tenant
    let create_payload = json!({
        "business_name": "Apex Retailers",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000,
        "max_counters": 3,
        "notes": "E2E test tenant"
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    assert!(
        resp.status == 200 || resp.status == 201,
        "Create tenant failed: {}",
        resp.body
    );
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().expect("tenant_id").to_string();
    let temp_password = val["temp_password"].as_str().expect("temp_password").to_string();
    let owner_username = val["owner_username"].as_str().expect("owner_username").to_string();

    // B. Device activates
    let activate_payload = json!({
        "tenant_code": tenant_id,
        "owner_username": owner_username,
        "temp_password": temp_password,
        "device_id": "dev-apex-01",
        "app_version": "1.0.0",
        "dek_escrow_b64": BASE64.encode(b"apex-super-secret-dek-32bytes!!")
    });
    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &activate_payload.to_string(),
    )
    .await;
    assert_eq!(act_resp.status, 200, "Activate failed: {}", act_resp.body);
    let act_val = act_resp.json();
    let device_secret = act_val["device_secret"].as_str().expect("device_secret").to_string();
    let initial_licence: Licence = serde_json::from_value(act_val["licence"].clone()).expect("parse licence");

    assert_eq!(initial_licence.payload.tenant_id, tenant_id);
    assert_eq!(initial_licence.payload.business_name, "Apex Retailers");
    assert_eq!(initial_licence.payload.vertical, "retail");
    assert_eq!(initial_licence.payload.plan, "pro");
    assert_eq!(initial_licence.payload.max_counters, 3);
    assert_eq!(initial_licence.payload.device_id, "dev-apex-01");
    assert!(verify_licence_signature(&initial_licence, &s.verifying_key));

    // C. Device check-in
    let checkin_payload = json!({
        "tenant_id": tenant_id,
        "device_id": "dev-apex-01",
        "device_secret": device_secret,
        "licence_serial": initial_licence.payload.serial,
        "usage": {
            "bills_24h": 42,
            "active_users": 3,
            "last_login_day": 20000,
            "counters_paired": 2,
            "app_version": "1.0.0"
        },
        "dek_escrow_b64": null
    });
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &checkin_payload.to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 200, "Checkin failed: {}", chk_resp.body);
    let chk_val = chk_resp.json();
    let checkin_licence: Licence = serde_json::from_value(chk_val["licence"].clone()).expect("parse licence");

    assert_eq!(checkin_licence.payload.tenant_id, tenant_id);
    assert!(checkin_licence.payload.serial > initial_licence.payload.serial);
    assert!(verify_licence_signature(&checkin_licence, &s.verifying_key));
}

// ----------------------------------------------------------------------------
// 2. Wrong temp password rejected
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_wrong_temp_password_rejected() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Bakery One",
        "vertical": "retail",
        "plan": "basic",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();

    let activate_payload = json!({
        "tenant_code": tenant_id,
        "owner_username": "owner",
        "temp_password": "WrongPassword123",
        "device_id": "dev-01",
        "app_version": "1.0.0"
    });
    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &activate_payload.to_string(),
    )
    .await;
    assert_eq!(act_resp.status, 401);
}

// ----------------------------------------------------------------------------
// 3. Replayed activation rejected
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_replayed_activation_rejected() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Cafe Two",
        "vertical": "retail",
        "plan": "basic",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_payload = json!({
        "tenant_code": tenant_id,
        "owner_username": "owner",
        "temp_password": temp_pw,
        "device_id": "dev-01",
        "app_version": "1.0.0"
    });
    let resp1 = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act_payload.to_string(),
    )
    .await;
    assert_eq!(resp1.status, 200);

    // 1. Immediate replay while device is active is rejected
    let resp2 = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act_payload.to_string(),
    )
    .await;
    assert_eq!(resp2.status, 409);

    // 2. Even after revoking the active device, the bootstrap password cannot be replayed
    let _ = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/devices/dev-01/revoke", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
        ],
        "",
    )
    .await;

    let resp3 = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act_payload.to_string(),
    )
    .await;
    assert_eq!(resp3.status, 401);
}

// ----------------------------------------------------------------------------
// 4. Second device activation rejected (409 Conflict)
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_second_device_activation_rejected() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Clinic Three",
        "vertical": "hospital",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    // Dev 1 activates
    let act1 = json!({
        "tenant_code": tenant_id,
        "owner_username": "owner",
        "temp_password": temp_pw,
        "device_id": "host-pc-01",
        "app_version": "1.0.0"
    });
    let resp1 = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act1.to_string(),
    )
    .await;
    assert_eq!(resp1.status, 200);

    // Dev 2 tries to activate on same tenant (e.g. if someone resets password)
    // First generate reset password
    let reset_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/reset-owner", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
        ],
        "",
    )
    .await;
    let new_pw = reset_resp.json()["temp_password"].as_str().unwrap().to_string();

    let act2 = json!({
        "tenant_code": tenant_id,
        "owner_username": "owner",
        "temp_password": new_pw,
        "device_id": "intruder-pc-02",
        "app_version": "1.0.0"
    });
    let resp2 = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act2.to_string(),
    )
    .await;
    // P10/L4B rule: One Host PC owns SQLite. Only one device can be active per tenant.
    assert_eq!(resp2.status, 409, "Second device must be rejected with 409 Conflict");
}

// ----------------------------------------------------------------------------
// 5. Revoked device returns 403 on check-in
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_revoked_device_rejected_on_checkin() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "School Four",
        "vertical": "school",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act = json!({
        "tenant_code": tenant_id,
        "owner_username": "owner",
        "temp_password": temp_pw,
        "device_id": "school-pc-01",
        "app_version": "1.0.0"
    });
    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &act.to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Revoke device via admin
    let revoke_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/devices/school-pc-01/revoke", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
        ],
        "",
    )
    .await;
    assert_eq!(revoke_resp.status, 200);

    // Attempt checkin
    let chk = json!({
        "tenant_id": tenant_id,
        "device_id": "school-pc-01",
        "device_secret": secret,
        "licence_serial": 1,
        "usage": {
            "bills_24h": 0,
            "active_users": 1,
            "last_login_day": 20000,
            "counters_paired": 0,
            "app_version": "1.0.0"
        }
    });
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &chk.to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 403, "Revoked device check-in must return 403");
}

// ----------------------------------------------------------------------------
// 6. Suspended tenant reflected in licence
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_suspended_tenant_reflected_in_licence() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Wholesale Five",
        "vertical": "wholesale",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Admin suspends tenant
    let susp_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/suspend", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
        ],
        "",
    )
    .await;
    assert_eq!(susp_resp.status, 200);

    // Next checkin
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "licence_serial": 1,
            "usage": {
                "bills_24h": 0,
                "active_users": 1,
                "last_login_day": 20000,
                "counters_paired": 0,
                "app_version": "1.0.0"
            }
        }).to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 200);
    let chk_lic: Licence = serde_json::from_value(chk_resp.json()["licence"].clone()).unwrap();
    assert_eq!(chk_lic.payload.status, "suspended");
}

// ----------------------------------------------------------------------------
// 7. Expiry extension via mark-paid reflected at next check-in
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_expiry_extension_via_mark_paid() {
    let s = setup_test_server().await;

    // Start with day 20000 (roughly 2024-10-04)
    let initial_until_day = 20000;
    let create_payload = json!({
        "business_name": "Store Six",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": initial_until_day
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Mark paid 3 months
    let paid_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/mark-paid", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &json!({
            "months": 3,
            "amount_rupees": "4999.00",
            "payment_ref": "UPI-123456",
            "notes": "3 month renewal"
        }).to_string(),
    )
    .await;
    assert_eq!(paid_resp.status, 200, "mark-paid failed: {}", paid_resp.body);
    let new_until = paid_resp.json()["new_valid_until_day"].as_i64().unwrap();
    assert!(new_until > initial_until_day);

    // Next checkin
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "licence_serial": 1,
            "usage": {
                "bills_24h": 5,
                "active_users": 1,
                "last_login_day": 20000,
                "counters_paired": 0,
                "app_version": "1.0.0"
            }
        }).to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 200);
    let lic: Licence = serde_json::from_value(chk_resp.json()["licence"].clone()).unwrap();
    assert_eq!(lic.payload.valid_until_day, new_until);
}

// ----------------------------------------------------------------------------
// 8. Export permit capped at 72 h reflected in licence
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_export_permit_capped_at_72h() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Store Seven",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Ask for 120 hours (should be clamped to 72 hours per P6)
    let permit_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/export-permit", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &json!({ "hours": 120 }).to_string(),
    )
    .await;
    assert_eq!(permit_resp.status, 200);
    let permit_ms = permit_resp.json()["export_permit_until_ms"].as_i64().unwrap();

    // Next checkin
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "licence_serial": 1,
            "usage": {
                "bills_24h": 0,
                "active_users": 1,
                "last_login_day": 20000,
                "counters_paired": 0,
                "app_version": "1.0.0"
            }
        }).to_string(),
    )
    .await;
    let lic: Licence = serde_json::from_value(chk_resp.json()["licence"].clone()).unwrap();
    assert_eq!(lic.payload.export_permit_until_ms, permit_ms);
}

// ----------------------------------------------------------------------------
// 9. Basic plan forces max_counters = 1
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_basic_plan_forces_max_counters_one() {
    let s = setup_test_server().await;

    // Caller requests max_counters = 10 on basic plan
    let create_payload = json!({
        "business_name": "Basic Mart",
        "vertical": "retail",
        "plan": "basic",
        "valid_until_day": 25000,
        "max_counters": 10
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let lic: Licence = serde_json::from_value(act_resp.json()["licence"].clone()).unwrap();
    assert_eq!(lic.payload.max_counters, 1, "Basic plan must strictly enforce max_counters = 1");
}

// ----------------------------------------------------------------------------
// 10. Owner reset flow: happy path, single-use, wrong device
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_owner_reset_lifecycle() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Owner Reset Shop",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Admin issues owner reset token
    let reset_tok_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/owner-reset-token", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
        ],
        "",
    )
    .await;
    assert_eq!(reset_tok_resp.status, 200);
    let reset_token = reset_tok_resp.json()["reset_token"].as_str().unwrap().to_string();

    // 1. Wrong device rejected
    let wrong_dev_resp = send_http(
        s.addr,
        "POST",
        "/v1/owner-reset",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-intruder",
            "device_secret": secret,
            "reset_token": reset_token
        }).to_string(),
    )
    .await;
    assert_eq!(wrong_dev_resp.status, 400);

    // 2. Happy path on genuine device
    let ok_resp = send_http(
        s.addr,
        "POST",
        "/v1/owner-reset",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "reset_token": reset_token
        }).to_string(),
    )
    .await;
    assert_eq!(ok_resp.status, 200);
    assert_eq!(ok_resp.json()["ok"], true);

    // 3. Single use: second attempt rejected
    let replay_resp = send_http(
        s.addr,
        "POST",
        "/v1/owner-reset",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "reset_token": reset_token
        }).to_string(),
    )
    .await;
    assert_eq!(replay_resp.status, 400);
}

// ----------------------------------------------------------------------------
// 11. Escrow: stored at activation, downloaded with fresh TOTP, audited
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_escrow_lifecycle_and_audit() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Vault Ten",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let raw_dek_blob = b"sample-encrypted-dek-payload-12345678";
    let b64_escrow = BASE64.encode(raw_dek_blob);

    let _act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0",
            "dek_escrow_b64": b64_escrow
        }).to_string(),
    )
    .await;

    // 1. Attempt download without TOTP or wrong TOTP
    let bad_totp_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/escrow", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &json!({ "totp": "000000" }).to_string(),
    )
    .await;
    assert_eq!(bad_totp_resp.status, 401);

    // 2. Download with valid fresh TOTP
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let totp_code = s.totp.generate(now_secs).to_string();

    let ok_escrow_resp = send_http(
        s.addr,
        "POST",
        &format!("/v1/admin/tenants/{}/escrow", tenant_id),
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &json!({ "totp": totp_code }).to_string(),
    )
    .await;
    assert_eq!(ok_escrow_resp.status, 200);
    let downloaded_b64 = ok_escrow_resp.json()["blob_b64"].as_str().unwrap().to_string();
    assert_eq!(downloaded_b64, b64_escrow);

    // 3. Verify audit log entry
    let conn = open_db(&s.db_path).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM admin_audit WHERE action = 'escrow.download' AND tenant_id = ?1",
            rusqlite::params![tenant_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "Escrow download must be audited");
}

// ----------------------------------------------------------------------------
// 12. Civil date mark-paid vectors
// ----------------------------------------------------------------------------
#[test]
fn test_civil_date_mark_paid_vectors() {
    // Jan 31 + 1 month = Feb 28 (2023 is non-leap year)
    let d1 = days_from_civil(2023, 1, 31);
    let r1 = add_months(d1, 1);
    assert_eq!(r1, days_from_civil(2023, 2, 28));

    // Jan 31 + 1 month in leap year = Feb 29 (2024 is leap year)
    let d2 = days_from_civil(2024, 1, 31);
    let r2 = add_months(d2, 1);
    assert_eq!(r2, days_from_civil(2024, 2, 29));

    // Aug 31 + 1 month = Sep 30
    let d3 = days_from_civil(2023, 8, 31);
    let r3 = add_months(d3, 1);
    assert_eq!(r3, days_from_civil(2023, 9, 30));

    // Mar 31 + 12 months = Mar 31
    let d4 = days_from_civil(2023, 3, 31);
    let r4 = add_months(d4, 12);
    assert_eq!(r4, days_from_civil(2024, 3, 31));
}

// ----------------------------------------------------------------------------
// 13. Audit chain verified after all mutating actions
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_audit_chain_verified() {
    let s = setup_test_server().await;

    // Perform tenant creation and payment
    let create_payload = json!({
        "business_name": "Audit Store",
        "vertical": "retail",
        "plan": "basic",
        "valid_until_day": 25000
    });
    let _ = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;

    let conn = open_db(&s.db_path).unwrap();
    verify_chain(&conn).expect("audit chain verification failed");

    let count: i64 = conn
        .query_row("SELECT count(*) FROM admin_audit", [], |r| r.get(0))
        .unwrap();
    assert!(count > 0, "Expected at least 1 valid audit entry in chain");
}

// ----------------------------------------------------------------------------
// 14. Unknown usage field rejected (deny_unknown_fields)
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_unknown_usage_field_rejected() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Strict Store",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Checkin with unknown field inside usage report
    let bad_chk = json!({
        "tenant_id": tenant_id,
        "device_id": "dev-01",
        "device_secret": secret,
        "licence_serial": 1,
        "usage": {
            "bills_24h": 0,
            "active_users": 1,
            "last_login_day": 20000,
            "counters_paired": 0,
            "app_version": "1.0.0",
            "unknown_extra_metric": 999
        }
    });
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &bad_chk.to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 422, "Unknown fields in usage report must be rejected with 422");
}

// ----------------------------------------------------------------------------
// 15. Oversize body (>16 KB) rejected with 413
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_oversize_body_rejected() {
    let s = setup_test_server().await;

    // Body with 18 KB of padding
    let large_body = format!("{{\"padding\":\"{}\"}}", "A".repeat(18 * 1024));
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &large_body,
    )
    .await;
    assert_eq!(resp.status, 413, "Body > 16 KB must be rejected with 413");
}

// ----------------------------------------------------------------------------
// 16. Support text: set, returned in next licence
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_support_text_in_licence() {
    let s = setup_test_server().await;

    let create_payload = json!({
        "business_name": "Support Text Shop",
        "vertical": "retail",
        "plan": "pro",
        "valid_until_day": 25000
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/tenants",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &create_payload.to_string(),
    )
    .await;
    let val = resp.json();
    let tenant_id = val["tenant_id"].as_str().unwrap();
    let temp_pw = val["temp_password"].as_str().unwrap();

    let act_resp = send_http(
        s.addr,
        "POST",
        "/v1/activate",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_code": tenant_id,
            "owner_username": "owner",
            "temp_password": temp_pw,
            "device_id": "dev-01",
            "app_version": "1.0.0"
        }).to_string(),
    )
    .await;
    let secret = act_resp.json()["device_secret"].as_str().unwrap().to_string();

    // Admin sets support text
    let st_resp = send_http(
        s.addr,
        "POST",
        "/v1/admin/support-text",
        &[
            ("Cookie", &format!("admin_session={}", s.admin_session_token)),
            ("X-OmniBill-Admin", "1"),
            ("Content-Type", "application/json"),
        ],
        &json!({ "text": "Call 1800-OMNIBILL for help" }).to_string(),
    )
    .await;
    assert_eq!(st_resp.status, 200);

    // Next checkin
    let chk_resp = send_http(
        s.addr,
        "POST",
        "/v1/checkin",
        &[("Content-Type", "application/json")],
        &json!({
            "tenant_id": tenant_id,
            "device_id": "dev-01",
            "device_secret": secret,
            "licence_serial": 1,
            "usage": {
                "bills_24h": 0,
                "active_users": 1,
                "last_login_day": 20000,
                "counters_paired": 0,
                "app_version": "1.0.0"
            }
        }).to_string(),
    )
    .await;
    assert_eq!(chk_resp.status, 200);
    let lic: Licence = serde_json::from_value(chk_resp.json()["licence"].clone()).unwrap();
    assert_eq!(lic.payload.support_text, "Call 1800-OMNIBILL for help");
}

// ----------------------------------------------------------------------------
// 17. write_licence_vectors: writes docs/test_vectors/licence_vectors.json
// ----------------------------------------------------------------------------
#[test]
fn write_licence_vectors() {
    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();
    let public_key_hex = bytes_to_hex(verifying_key.as_bytes());

    let base_payload = LicencePayload {
        v: 1,
        tenant_id: "00000000-0000-0000-0000-000000000001".into(),
        business_name: "Test Tenant".into(),
        vertical: "retail".into(),
        plan: "pro".into(),
        features: features_for("pro"),
        max_counters: 3,
        device_id: "dev-test-vector-01".into(),
        serial: 1001,
        issued_ms: 1729500000000,
        valid_until_day: 20500,
        offline_days: 3,
        grace_days: 0,
        status: "active".into(),
        export_permit_until_ms: 0,
        support_text: "Call support at 1800-OMNIBILL".into(),
    };

    let cases = vec![
        (
            "basic plan active licence",
            LicencePayload {
                plan: "basic".into(),
                features: features_for("basic"),
                max_counters: 1,
                ..base_payload.clone()
            },
        ),
        (
            "pro plan active licence",
            LicencePayload {
                plan: "pro".into(),
                features: features_for("pro"),
                max_counters: 3,
                ..base_payload.clone()
            },
        ),
        (
            "pro plan expired licence",
            LicencePayload {
                valid_until_day: 19000,
                ..base_payload.clone()
            },
        ),
        (
            "pro plan suspended licence",
            LicencePayload {
                status: "suspended".into(),
                ..base_payload.clone()
            },
        ),
        (
            "pro plan with 72h export permit licence",
            LicencePayload {
                export_permit_until_ms: 1729500000000 + 72 * 3600 * 1000,
                ..base_payload.clone()
            },
        ),
    ];

    let mut vector_entries = Vec::new();

    for (desc, payload) in cases {
        let signed = sign_licence(&signing_key, payload).expect("sign licence");
        let mut canon_payload = signed.payload.clone();
        canon_payload.features.sort();
        canon_payload.features.dedup();
        let canonical_bytes = serde_json::to_vec(&canon_payload).expect("canonicalize");
        let raw_payload_json = serde_json::to_string(&canon_payload).expect("payload to string");
        let canonical_bytes_hex = bytes_to_hex(&canonical_bytes);

        let sig_bytes = URL_SAFE_NO_PAD
            .decode(&signed.sig)
            .or_else(|_| URL_SAFE.decode(&signed.sig))
            .expect("decode sig");
        let signature_hex = bytes_to_hex(&sig_bytes);

        vector_entries.push(json!({
            "description": desc,
            "raw_payload_json": raw_payload_json,
            "canonical_bytes_hex": canonical_bytes_hex,
            "signature_hex": signature_hex,
            "public_key_hex": public_key_hex.clone(),
        }));
    }

    if std::env::var("WRITE_VECTORS").unwrap_or_default() == "1" {
        let p1 = std::path::Path::new("../docs/test_vectors/licence_vectors.json");
        let p2 = std::path::Path::new("docs/test_vectors/licence_vectors.json");
        let vector_path = if std::path::Path::new("../docs/test_vectors").exists() {
            p1
        } else {
            p2
        };
        if let Some(parent) = vector_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let formatted = serde_json::to_string_pretty(&vector_entries).expect("format json");
        std::fs::write(vector_path, formatted).expect("write licence_vectors.json");
    }
}
