use control_plane::auth::{
    create_admin, verify_admin_login, AuthError, LoginPayload,
};
use control_plane::db::{append_audit, init_schema, open_in_memory, verify_chain};
use control_plane::escrow::{seal_dek, unseal_dek};
use control_plane::keys::{generate_keypairs, write_private_key, write_public_key};
use control_plane::ratelimit::SlidingWindowLimiter;
use control_plane::server::{create_router, AppState};
use serde_json::Value;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use totp_rs::{Algorithm, Builder, Secret};

const TEST_SECRET: &str = "test-server-secret-key-1234567890";

fn setup_test_db() -> rusqlite::Connection {
    let conn = open_in_memory().expect("open in-memory db");
    init_schema(&conn).expect("init schema");
    conn
}

async fn spawn_test_server(temp_db: PathBuf) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let state = Arc::new(AppState {
        db_path: temp_db,
        server_secret: TEST_SECRET.into(),
        rate_limiter: Arc::new(SlidingWindowLimiter::new(60_000, 100)),
    });
    let app = create_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (addr, handle)
}

async fn send_raw_http(addr: SocketAddr, req_str: &str) -> String {
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(req_str.as_bytes()).await.unwrap();

    let mut resp = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = stream.read(&mut buf).await.unwrap();
        if n == 0 {
            break;
        }
        resp.extend_from_slice(&buf[..n]);
        let s = String::from_utf8_lossy(&resp);
        if let Some(header_end) = s.find("\r\n\r\n") {
            let lower = s.to_ascii_lowercase();
            if let Some(pos) = lower.find("content-length: ") {
                let rest = &lower[pos + 16..];
                if let Some(end) = rest.find("\r\n") {
                    if let Ok(len) = rest[..end].trim().parse::<usize>() {
                        if resp.len() >= header_end + 4 + len {
                            break;
                        }
                    }
                }
            }
        }
    }
    String::from_utf8_lossy(&resp).to_string()
}

// ----------------------------------------------------------------------------
// 1. TOTP RFC 6238 vectors
// ----------------------------------------------------------------------------
#[test]
fn test_rfc_6238_vectors() {
    let secret_bytes: Box<[u8]> = b"12345678901234567890".to_vec().into_boxed_slice();
    let secret = Secret::new(secret_bytes);

    let totp_8 = Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(8)
        .with_step_duration(30)
        .with_secret(secret.clone())
        .build()
        .expect("build totp 8");

    let totp_6 = Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_step_duration(30)
        .with_secret(secret)
        .build()
        .expect("build totp 6");

    let cases = [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
        (20000000000, "65353130"),
    ];

    for (t, exp8) in cases {
        let code8 = totp_8.generate(t).to_string();
        let code6 = totp_6.generate(t).to_string();
        assert_eq!(code8, exp8, "Failed 8-digit code for time {}", t);
        assert_eq!(
            code6,
            &exp8[2..],
            "Failed 6-digit code match for last 6 digits for time {}",
            t
        );
    }
}

// ----------------------------------------------------------------------------
// 2. Wrong TOTP rejected
// ----------------------------------------------------------------------------
#[test]
fn test_wrong_totp_rejected() {
    let conn = setup_test_db();
    let now_ms = 1_700_000_000_000;
    let _ = create_admin(&conn, "admin_user", "CorrectPassword123!", TEST_SECRET, now_ms, false)
        .expect("create admin");

    let payload = LoginPayload {
        username: "admin_user".into(),
        password: "CorrectPassword123!".into(),
        totp: Some("000000".into()), // Wrong TOTP code
        recovery_code: None,
    };

    let err = verify_admin_login(&conn, &payload, TEST_SECRET, now_ms).unwrap_err();
    match err {
        AuthError::Invalid2Fa => {}
        other => panic!("Expected Invalid2Fa, got {:?}", other),
    }
}

// ----------------------------------------------------------------------------
// 3. TOTP replay rejected (last_totp_step must increase)
// ----------------------------------------------------------------------------
#[test]
fn test_totp_replay_rejected() {
    let conn = setup_test_db();
    let now_ms = 1_700_000_000_000;
    create_admin(&conn, "admin_user", "CorrectPassword123!", TEST_SECRET, now_ms, false)
        .expect("create admin");

    let totp_enc: Vec<u8> = conn
        .query_row(
            "SELECT totp_secret_enc FROM admins WHERE username = 'admin_user'",
            [],
            |r| r.get(0),
        )
        .expect("get totp_enc");

    let secret_raw = control_plane::auth::decrypt_totp_secret(&totp_enc, TEST_SECRET).unwrap();
    let totp = control_plane::auth::build_totp(&secret_raw, "admin_user").unwrap();
    let valid_code = totp.generate((now_ms / 1000) as u64).to_string();

    let payload = LoginPayload {
        username: "admin_user".into(),
        password: "CorrectPassword123!".into(),
        totp: Some(valid_code.clone()),
        recovery_code: None,
    };

    // First login succeeds
    let (admin_id, token) =
        verify_admin_login(&conn, &payload, TEST_SECRET, now_ms).expect("first login succeeds");
    assert!(admin_id > 0);
    assert_eq!(token.len(), 64);

    // Second login with the SAME TOTP token must be rejected as replay
    let replay_err = verify_admin_login(&conn, &payload, TEST_SECRET, now_ms).unwrap_err();
    match replay_err {
        AuthError::TotpReplay => {}
        other => panic!("Expected TotpReplay, got {:?}", other),
    }
}

// ----------------------------------------------------------------------------
// 4. Recovery code works once then is rejected
// ----------------------------------------------------------------------------
#[test]
fn test_recovery_code_once_then_rejected() {
    let conn = setup_test_db();
    let now_ms = 1_700_000_000_000;
    let created = create_admin(&conn, "admin_user", "CorrectPassword123!", TEST_SECRET, now_ms, false)
        .expect("create admin");

    let code_to_use = created.recovery_codes[0].clone();

    let payload = LoginPayload {
        username: "admin_user".into(),
        password: "CorrectPassword123!".into(),
        totp: None,
        recovery_code: Some(code_to_use.clone()),
    };

    // First use: succeeds
    let (admin_id, _) =
        verify_admin_login(&conn, &payload, TEST_SECRET, now_ms).expect("recovery login succeeds");
    assert!(admin_id > 0);

    // Verify audit log has admin.recovery_code_used
    let audit_count: i64 = conn
        .query_row(
            "SELECT count(*) FROM admin_audit WHERE action = 'admin.recovery_code_used'",
            [],
            |r| r.get(0),
        )
        .expect("audit query");
    assert_eq!(audit_count, 1);

    // Second use of the same code: rejected
    let second_err = verify_admin_login(&conn, &payload, TEST_SECRET, now_ms + 1000).unwrap_err();
    match second_err {
        AuthError::Invalid2Fa => {}
        other => panic!("Expected Invalid2Fa on reused recovery code, got {:?}", other),
    }
}

// ----------------------------------------------------------------------------
// 5. Cookie flags present on login response
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_cookie_flags_present() {
    let temp_db = std::env::temp_dir().join(format!("ctrl_cookie_{}.db", uuid::Uuid::new_v4()));
    let conn = control_plane::db::open_db(&temp_db).unwrap();
    init_schema(&conn).unwrap();

    let now_ms = 1_700_000_000_000;
    let created = create_admin(&conn, "superadmin", "Password!456", TEST_SECRET, now_ms, false).unwrap();
    drop(conn);

    let (addr, handle) = spawn_test_server(temp_db.clone()).await;

    let login_body = serde_json::json!({
        "username": "superadmin",
        "password": "Password!456",
        "recovery_code": created.recovery_codes[0]
    })
    .to_string();

    let req = format!(
        "POST /v1/admin/login HTTP/1.1\r\n\
         Host: 127.0.0.1\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         X-OmniBill-Admin: 1\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        login_body.len(),
        login_body
    );

    let resp = send_raw_http(addr, &req).await;
    assert!(resp.starts_with("HTTP/1.1 200 OK"), "Response was: {}", resp);

    let lower = resp.to_ascii_lowercase();
    assert!(lower.contains("set-cookie: admin_session="));
    assert!(lower.contains("httponly"));
    assert!(lower.contains("secure"));
    assert!(lower.contains("samesite=strict"));
    assert!(lower.contains("path=/"));

    handle.abort();
    let _ = fs::remove_file(temp_db);
}

// ----------------------------------------------------------------------------
// 6. Missing X-OmniBill-Admin rejected on a mutating route
// ----------------------------------------------------------------------------
#[tokio::test]
async fn test_missing_admin_header_rejected_on_mutating_route() {
    let temp_db = std::env::temp_dir().join(format!("ctrl_hdr_{}.db", uuid::Uuid::new_v4()));
    let conn = control_plane::db::open_db(&temp_db).unwrap();
    init_schema(&conn).unwrap();
    drop(conn);

    let (addr, handle) = spawn_test_server(temp_db.clone()).await;

    // Request WITHOUT header
    let req_no_header = "POST /v1/admin/login HTTP/1.1\r\n\
                         Host: 127.0.0.1\r\n\
                         Content-Type: application/json\r\n\
                         Content-Length: 2\r\n\
                         Connection: close\r\n\
                         \r\n\
                         {}";

    let resp_no_header = send_raw_http(addr, req_no_header).await;
    assert!(
        resp_no_header.starts_with("HTTP/1.1 403 Forbidden"),
        "Expected 403, got: {}",
        resp_no_header
    );

    // Request WITH invalid header
    let req_bad_header = "POST /v1/admin/login HTTP/1.1\r\n\
                          Host: 127.0.0.1\r\n\
                          Content-Type: application/json\r\n\
                          Content-Length: 2\r\n\
                          X-OmniBill-Admin: 0\r\n\
                          Connection: close\r\n\
                          \r\n\
                          {}";

    let resp_bad_header = send_raw_http(addr, req_bad_header).await;
    assert!(
        resp_bad_header.starts_with("HTTP/1.1 403 Forbidden"),
        "Expected 403, got: {}",
        resp_bad_header
    );

    handle.abort();
    let _ = fs::remove_file(temp_db);
}

// ----------------------------------------------------------------------------
// 7. Audit chain tamper detection
// ----------------------------------------------------------------------------
#[test]
fn test_audit_chain_tamper_detection() {
    let conn = setup_test_db();
    let ts = 1_700_000_000_000;

    let _ = append_audit(&conn, Some(1), "admin.login", None, "First action", ts).unwrap();
    let id2 = append_audit(&conn, Some(1), "tenant.create", Some("t1"), "Second action", ts + 10).unwrap();
    let _ = append_audit(&conn, Some(1), "licence.issue", Some("t1"), "Third action", ts + 20).unwrap();

    assert_eq!(verify_chain(&conn), Ok(()), "Untampered chain must pass");

    // Drop triggers inside the test to simulate direct disk corruption/tampering
    conn.execute_batch(
        "DROP TRIGGER admin_audit_no_update;
         DROP TRIGGER admin_audit_no_delete;",
    )
    .unwrap();

    // Tamper with row 2 detail
    conn.execute(
        "UPDATE admin_audit SET detail = 'TAMPERED' WHERE id = ?1",
        rusqlite::params![id2],
    )
    .unwrap();

    let tamper_res = verify_chain(&conn);
    assert_eq!(tamper_res, Err(id2), "Tampering at row 2 must be detected");
}

// ----------------------------------------------------------------------------
// 8. Lockout: 5 failed attempts -> 15 min lockout
// ----------------------------------------------------------------------------
#[test]
fn test_lockout_after_five_failed_attempts() {
    let conn = setup_test_db();
    let now_ms = 1_700_000_000_000;
    create_admin(&conn, "admin_user", "CorrectPassword123!", TEST_SECRET, now_ms, false).unwrap();

    let bad_pw_payload = LoginPayload {
        username: "admin_user".into(),
        password: "WrongPassword!".into(),
        totp: None,
        recovery_code: None,
    };

    // Attempts 1 to 4: fail with InvalidCredentials, not locked yet
    for _ in 1..=4 {
        let err = verify_admin_login(&conn, &bad_pw_payload, TEST_SECRET, now_ms).unwrap_err();
        match err {
            AuthError::InvalidCredentials => {}
            other => panic!("Expected InvalidCredentials, got {:?}", other),
        }
    }

    // 5th attempt: fails and triggers lockout
    let err5 = verify_admin_login(&conn, &bad_pw_payload, TEST_SECRET, now_ms).unwrap_err();
    match err5 {
        AuthError::InvalidCredentials => {}
        other => panic!("Expected InvalidCredentials, got {:?}", other),
    }

    // 6th attempt (even with CORRECT password): locked out!
    let correct_payload = LoginPayload {
        username: "admin_user".into(),
        password: "CorrectPassword123!".into(),
        totp: None,
        recovery_code: None,
    };

    let err6 = verify_admin_login(&conn, &correct_payload, TEST_SECRET, now_ms + 100).unwrap_err();
    match err6 {
        AuthError::LockedOut(locked_until) => {
            assert!(locked_until > now_ms);
            assert_eq!(locked_until, now_ms + 15 * 60 * 1000);
        }
        other => panic!("Expected LockedOut, got {:?}", other),
    }
}

// ----------------------------------------------------------------------------
// 9. Keygen refuses overwrite
// ----------------------------------------------------------------------------
#[test]
fn test_keygen_refuses_overwrite() {
    let temp_dir = std::env::temp_dir().join(format!("ctrl_keygen_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();

    let v_priv = temp_dir.join("vendor.key");
    let v_pub = temp_dir.join("vendor.pub");
    let e_priv = temp_dir.join("escrow.key");
    let e_pub = temp_dir.join("escrow.pub");

    let keys = generate_keypairs();
    write_private_key(&v_priv, &keys.vendor_private).unwrap();
    write_public_key(&v_pub, &keys.vendor_public).unwrap();
    write_private_key(&e_priv, &keys.escrow_private).unwrap();
    write_public_key(&e_pub, &keys.escrow_public).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let v_meta = fs::metadata(&v_priv).unwrap();
        assert_eq!(v_meta.permissions().mode() & 0o777, 0o600);
        let e_meta = fs::metadata(&e_priv).unwrap();
        assert_eq!(e_meta.permissions().mode() & 0o777, 0o600);
    }

    // Second write to existing file must refuse
    let overwrite_res = write_private_key(&v_priv, &keys.vendor_private);
    assert!(overwrite_res.is_err(), "Must refuse overwrite of private key");

    let overwrite_pub_res = write_public_key(&v_pub, &keys.vendor_public);
    assert!(overwrite_pub_res.is_err(), "Must refuse overwrite of public key");

    let _ = fs::remove_dir_all(temp_dir);
}

// ----------------------------------------------------------------------------
// 10. Escrow roundtrip and L3C vector file verification
// ----------------------------------------------------------------------------
#[test]
fn test_escrow_roundtrip_and_l3c_vectors() {
    let keys = generate_keypairs();
    let runtime_dek = [0x7au8; 32];

    // Seal with crypto_box using runtime key
    let sealed = seal_dek(&runtime_dek, &keys.escrow_public).expect("seal dek");
    let unsealed_hex = unseal_dek(&sealed, &keys.escrow_private).expect("unseal dek");

    let mut expected_hex = String::new();
    for b in runtime_dek {
        use std::fmt::Write;
        let _ = write!(&mut expected_hex, "{:02x}", b);
    }
    assert_eq!(unsealed_hex, expected_hex);

    // Verify against docs/test_vectors/escrow_vectors.json from Task L3C
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let vector_path = manifest_dir.parent().unwrap().join("docs/test_vectors/escrow_vectors.json");

    if vector_path.exists() {
        let content = fs::read_to_string(&vector_path).expect("read escrow vectors");
        let val: Value = serde_json::from_str(&content).expect("parse escrow vector json");

        let sealed_b64 = val["sealed_b64"].as_str().expect("sealed_b64");
        let dek_hex = val["dek_hex"].as_str().expect("dek_hex");
        let secret_hex = val["TEST_ONLY_escrow_secret_hex"].as_str().expect("secret hex");

        let mut sk_bytes = [0u8; 32];
        for i in 0..32 {
            sk_bytes[i] = u8::from_str_radix(&secret_hex[i * 2..i * 2 + 2], 16).unwrap();
        }

        let recovered_dek_hex = unseal_dek(sealed_b64, &sk_bytes).expect("unseal l3c vector");
        assert_eq!(recovered_dek_hex, dek_hex, "L3C test vector unsealed DEK matches");
    }
}
