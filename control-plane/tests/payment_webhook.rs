use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use control_plane::civil::{add_months, ist_day};
use control_plane::db::{init_schema, open_db, verify_chain};
use control_plane::licence::Licence;
use control_plane::payments::{compute_payment_signature, verify_payment_signature};
use control_plane::ratelimit::SlidingWindowLimiter;
use control_plane::routes::{create_router, AppState};
use control_plane::signaling::SignalingHub;
use ed25519_dalek::{Signature, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const TEST_SECRET: &str = "test_webhook_secret_key_999";

struct TestServer {
    addr: SocketAddr,
    db_path: PathBuf,
    #[allow(dead_code)]
    signing_key: SigningKey,
    verifying_key: VerifyingKey,
    _join_handle: tokio::task::JoinHandle<()>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self._join_handle.abort();
        let _ = std::fs::remove_file(&self.db_path);
    }
}

struct HttpResponse {
    status: u16,
    #[allow(dead_code)]
    headers: HashMap<String, String>,
    body: String,
}

impl HttpResponse {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|_| {
            panic!(
                "Expected JSON response, got status {} body: {}",
                self.status, self.body
            )
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
    let mut stream = tokio::net::TcpStream::connect(addr)
        .await
        .expect("connect to test server");
    let body_bytes = body.as_bytes();
    let mut req = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        method,
        path,
        addr,
        body_bytes.len()
    );
    for (k, v) in headers {
        req.push_str(&format!("{}: {}\r\n", k, v));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .expect("write req header");
    if !body_bytes.is_empty() {
        stream
            .write_all(body_bytes)
            .await
            .expect("write req body");
    }

    let mut resp_bytes = Vec::new();
    stream
        .read_to_end(&mut resp_bytes)
        .await
        .expect("read response");

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

fn verify_licence_signature(licence: &Licence, verifying_key: &VerifyingKey) -> bool {
    let mut payload = licence.payload.clone();
    payload.features.sort();
    payload.features.dedup();
    let canonical = match serde_json::to_vec(&payload) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let sig_bytes = match URL_SAFE_NO_PAD.decode(&licence.sig) {
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

async fn setup_test_server() -> TestServer {
    let temp_db = std::env::temp_dir().join(format!("test_webhook_{}.db", uuid::Uuid::new_v4()));
    let conn = open_db(&temp_db).expect("open test db");
    init_schema(&conn).expect("init schema");

    let mut rng = OsRng;
    let signing_key = SigningKey::generate(&mut rng);
    let verifying_key = signing_key.verifying_key();

    let state = Arc::new(AppState {
        db_path: temp_db.clone(),
        server_secret: TEST_SECRET.into(),
        webhook_secret: Some(TEST_SECRET.into()),
        signing_key: Arc::new(signing_key.clone()),
        rate_limiter: Arc::new(SlidingWindowLimiter::new(60_000, 10_000)),
        signaling: SignalingHub::new(),
    });

    let app = create_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind tcp");
    let addr = listener.local_addr().expect("local addr");
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    TestServer {
        addr,
        db_path: temp_db,
        signing_key,
        verifying_key,
        _join_handle: handle,
    }
}

// ----------------------------------------------------------------------------
// 1. Signature Unit Tests
// ----------------------------------------------------------------------------
#[test]
fn test_signature_verification_rfc_vectors() {
    let secret = "rzp_secret_98765";
    let order_id = "order_1001";
    let payment_id = "pay_2002";
    let sig = compute_payment_signature(order_id, payment_id, secret);

    assert!(verify_payment_signature(order_id, payment_id, &sig, secret));
    assert!(!verify_payment_signature(order_id, payment_id, &sig, "wrong"));
    assert!(!verify_payment_signature("order_other", payment_id, &sig, secret));
    assert!(!verify_payment_signature(order_id, "pay_other", &sig, secret));
    assert!(!verify_payment_signature(order_id, payment_id, "00112233", secret));
    assert!(!verify_payment_signature(order_id, payment_id, "", secret));
}

// ----------------------------------------------------------------------------
// 2. HTTP Webhook Success & Atomic Update Flow
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_payment_webhook_happy_path() {
    let s = setup_test_server().await;
    let conn = open_db(&s.db_path).unwrap();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let today = ist_day(now_ms);

    // Seed a tenant with suspended status and old expiry
    let tenant_id = "tenant_webhook_01";
    let old_valid_until = today - 5;
    conn.execute(
        "INSERT INTO tenants (id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial, created_ms, notes)
         VALUES (?1, 'Apex Mart', 'retail', 'pro', ?2, 'suspended', 2, 3, 0, 0, 1, ?3, '')",
        rusqlite::params![tenant_id, old_valid_until, now_ms],
    ).unwrap();

    let order_id = "order_rzp_001";
    let payment_id = "pay_rzp_001";
    let sig = compute_payment_signature(order_id, payment_id, TEST_SECRET);

    let payload = json!({
        "order_id": order_id,
        "payment_id": payment_id,
        "signature": sig,
        "tenant_id": tenant_id,
        "months": 6,
        "amount_rupees": "9999.00",
        "note": "Semi-annual subscription payment"
    });

    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/payment",
        &[("Content-Type", "application/json")],
        &payload.to_string(),
    )
    .await;

    assert_eq!(resp.status, 200, "Webhook failed: {}", resp.body);
    let val = resp.json();

    assert_eq!(val["tenant_id"], tenant_id);
    assert_eq!(val["amount_paise"], 999900);
    assert_eq!(val["status"], "active");
    assert_eq!(val["old_valid_until_day"], old_valid_until);

    let expected_new_until = add_months(today - 1, 6);
    assert_eq!(val["new_valid_until_day"], expected_new_until);

    // Verify license re-signing
    let licence: Licence = serde_json::from_value(val["licence"].clone()).expect("parse licence");
    assert_eq!(licence.payload.tenant_id, tenant_id);
    assert_eq!(licence.payload.valid_until_day, expected_new_until);
    assert_eq!(licence.payload.status, "active");
    assert_eq!(licence.payload.serial, 1);
    assert!(
        verify_licence_signature(&licence, &s.verifying_key),
        "License signature failed verification!"
    );

    // Verify DB update
    let (db_valid_until, db_status, db_serial): (i64, String, u64) = conn
        .query_row(
            "SELECT valid_until_day, status, next_serial FROM tenants WHERE id = ?1",
            rusqlite::params![tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();

    assert_eq!(db_status, "active");
    assert_eq!(db_valid_until, expected_new_until);
    assert_eq!(db_serial, 2); // Incremented for next issuance

    // Verify payment record
    let (db_paise, db_months, db_old_valid, db_new_valid): (i64, i64, i64, i64) = conn
        .query_row(
            "SELECT amount_paise, months, old_valid_until_day, new_valid_until_day FROM payments WHERE tenant_id = ?1",
            rusqlite::params![tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();

    assert_eq!(db_paise, 999900);
    assert_eq!(db_months, 6);
    assert_eq!(db_old_valid, old_valid_until);
    assert_eq!(db_new_valid, expected_new_until);

    // Verify audit chain
    assert!(verify_chain(&conn).is_ok());
}

// ----------------------------------------------------------------------------
// 3. Razorpay Alias Endpoint and Header Signature Fallback
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_razorpay_alias_and_header_signature() {
    let s = setup_test_server().await;
    let conn = open_db(&s.db_path).unwrap();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let today = ist_day(now_ms);

    let tenant_id = "tenant_razorpay_alias";
    conn.execute(
        "INSERT INTO tenants (id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial, created_ms, notes)
         VALUES (?1, 'Quick Supermarket', 'retail', 'basic', ?2, 'active', 1, 3, 0, 0, 1, ?3, '')",
        rusqlite::params![tenant_id, today + 30, now_ms],
    ).unwrap();

    let order_id = "order_alias_999";
    let payment_id = "pay_alias_888";
    let sig = compute_payment_signature(order_id, payment_id, TEST_SECRET);

    // Signature omitted in JSON body; sent in X-Razorpay-Signature header
    let payload = json!({
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "tenant_id": tenant_id,
        "months": 1,
        "amount_paise": 499900
    });

    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/razorpay",
        &[
            ("Content-Type", "application/json"),
            ("X-Razorpay-Signature", &sig),
        ],
        &payload.to_string(),
    )
    .await;

    assert_eq!(resp.status, 200, "Razorpay alias failed: {}", resp.body);
    let val = resp.json();
    assert_eq!(val["tenant_id"], tenant_id);
    assert_eq!(val["amount_paise"], 499900);

    let expected_new = add_months(today + 30, 1);
    assert_eq!(val["new_valid_until_day"], expected_new);
}

// ----------------------------------------------------------------------------
// 4. Error Handling: Bad Signature, Tenant Not Found, Invalid Amounts
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_payment_webhook_error_cases() {
    let s = setup_test_server().await;
    let conn = open_db(&s.db_path).unwrap();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let today = ist_day(now_ms);

    conn.execute(
        "INSERT INTO tenants (id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial, created_ms, notes)
         VALUES ('tenant_err', 'Err Store', 'retail', 'pro', ?1, 'active', 1, 3, 0, 0, 1, ?2, '')",
        rusqlite::params![today, now_ms],
    ).unwrap();

    // A. Invalid signature -> 401 Unauthorized
    let bad_sig_payload = json!({
        "order_id": "order_bad",
        "payment_id": "pay_bad",
        "signature": "deadbeef123456",
        "tenant_id": "tenant_err",
        "months": 1,
        "amount_rupees": "100.00"
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/payment",
        &[("Content-Type", "application/json")],
        &bad_sig_payload.to_string(),
    )
    .await;
    assert_eq!(resp.status, 401, "Expected 401 for bad signature, got: {}", resp.body);

    // B. Tenant not found -> 404 Not Found
    let valid_sig = compute_payment_signature("ord1", "pay1", TEST_SECRET);
    let missing_tenant_payload = json!({
        "order_id": "ord1",
        "payment_id": "pay1",
        "signature": valid_sig,
        "tenant_id": "non_existent_tenant_999",
        "months": 1,
        "amount_rupees": "100.00"
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/payment",
        &[("Content-Type", "application/json")],
        &missing_tenant_payload.to_string(),
    )
    .await;
    assert_eq!(resp.status, 404, "Expected 404 for missing tenant, got: {}", resp.body);

    // C. Invalid months (> 36) -> 400 Bad Request
    let valid_sig2 = compute_payment_signature("ord2", "pay2", TEST_SECRET);
    let invalid_months_payload = json!({
        "order_id": "ord2",
        "payment_id": "pay2",
        "signature": valid_sig2,
        "tenant_id": "tenant_err",
        "months": 48,
        "amount_rupees": "100.00"
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/payment",
        &[("Content-Type", "application/json")],
        &invalid_months_payload.to_string(),
    )
    .await;
    assert_eq!(resp.status, 400, "Expected 400 for invalid months, got: {}", resp.body);

    // D. Missing amount -> 400 Bad Request
    let valid_sig3 = compute_payment_signature("ord3", "pay3", TEST_SECRET);
    let missing_amt_payload = json!({
        "order_id": "ord3",
        "payment_id": "pay3",
        "signature": valid_sig3,
        "tenant_id": "tenant_err",
        "months": 1
    });
    let resp = send_http(
        s.addr,
        "POST",
        "/v1/webhooks/payment",
        &[("Content-Type", "application/json")],
        &missing_amt_payload.to_string(),
    )
    .await;
    assert_eq!(resp.status, 400, "Expected 400 for missing amount, got: {}", resp.body);
}
