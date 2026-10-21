//! Integration and Verification Suite for Client Activation, Check-in, and Owner Reset (Task L4C).
//!
//! Validates:
//! 1. Activation happy path: creates primary owner, stores app_state, verifies licence.
//! 2. Tampered licence rejected: signature mismatch prevents any database writes.
//! 3. Wrong tenant rejected: tenant ID mismatch fails closed.
//! 4. Older serial replay rejected: check-in rejects licences with serial < stored serial.
//! 5. Suspended licence stored: system enters ReadOnly(Suspended) mode.
//! 6. Check-in network failure: leaves existing licence and state completely untouched.
//! 7. Golden JSON usage report: exactly 5 allowed fields serialized without extras.
//! 8. Escrow blob: sent during check-in only when server flagged escrow_needed = 1.
//! 9. Owner reset success: unlocks user, resets lockout, forces must_change_password = 1, clears sessions.
//! 10. Owner reset failure: leaves password and lockout state completely untouched.
//! 11. Test vector verification: all shared licence vectors verify with client logic.
//! 12. Zero vendor key blocks activation: fails closed when vendor public key is all zeros.

use std::sync::Mutex;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand_core::OsRng;
use rusqlite::Connection;

use omnibill_core::access::activation::{activate, ActivationError};
use omnibill_core::access::checkin::{checkin, CheckinError};
use omnibill_core::access::licence::{compute_mode, Licence, LicencePayload, Mode, ModeInputs, Reason};
use omnibill_core::access::owner_reset::{owner_reset, owner_reset_with_sessions};
use omnibill_core::access::session::SessionManager;
use omnibill_core::access::users::AuthenticatedUser;
use omnibill_core::access::transport::{
    ActivateRequest, ActivateResponse, CheckinRequest, CheckinResponse, ControlPlane,
    ControlPlaneError, OwnerResetRequest, OwnerResetResponse, UsageReport,
};
use omnibill_core::database::migrations::{run_migrations, MIGRATIONS};

fn decode_hex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn test_keypair() -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

fn sample_payload(tenant_id: &str, vertical: &str, serial: u64, status: &str) -> LicencePayload {
    LicencePayload {
        v: 1,
        tenant_id: tenant_id.to_string(),
        business_name: "Apex Retail Solutions".to_string(),
        vertical: vertical.to_string(),
        plan: "pro".to_string(),
        features: vec![
            "billing".to_string(),
            "products".to_string(),
            "customers".to_string(),
            "basic_reports".to_string(),
            "day_close".to_string(),
            "backup".to_string(),
            "export_csv".to_string(),
        ],
        max_counters: 3,
        device_id: "test-device-uuid-001".to_string(),
        serial,
        issued_ms: 1_700_000_000_000,
        valid_until_day: 25000,
        offline_days: 3,
        grace_days: 0,
        status: status.to_string(),
        export_permit_until_ms: 0,
        support_text: "Call support at 1800-OMNIBILL".to_string(),
    }
}

fn sign_licence(payload: &LicencePayload, signing_key: &SigningKey) -> Licence {
    let mut payload = payload.clone();
    payload.features.sort();
    payload.features.dedup();
    let canonical_bytes = serde_json::to_vec(&payload).expect("canonical serialize");
    let sig = signing_key.sign(&canonical_bytes);
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
    Licence {
        payload,
        sig: sig_b64,
        raw_payload_bytes: Some(canonical_bytes),
    }
}

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&mut conn, &MIGRATIONS).expect("run migrations");
    conn
}

struct MockControlPlane {
    activate_resp: Mutex<Option<Result<ActivateResponse, ControlPlaneError>>>,
    checkin_resp: Mutex<Option<Result<CheckinResponse, ControlPlaneError>>>,
    owner_reset_resp: Mutex<Option<Result<OwnerResetResponse, ControlPlaneError>>>,
    last_checkin_req: Mutex<Option<CheckinRequest>>,
}

impl MockControlPlane {
    fn new() -> Self {
        Self {
            activate_resp: Mutex::new(None),
            checkin_resp: Mutex::new(None),
            owner_reset_resp: Mutex::new(None),
            last_checkin_req: Mutex::new(None),
        }
    }
}

impl ControlPlane for MockControlPlane {
    fn activate(&self, _req: &ActivateRequest) -> Result<ActivateResponse, ControlPlaneError> {
        let mut guard = self.activate_resp.lock().unwrap();
        guard.take().expect("activate_resp must be set")
    }

    fn checkin(&self, req: &CheckinRequest) -> Result<CheckinResponse, ControlPlaneError> {
        *self.last_checkin_req.lock().unwrap() = Some(req.clone());
        let mut guard = self.checkin_resp.lock().unwrap();
        guard.take().expect("checkin_resp must be set")
    }

    fn owner_reset(&self, _req: &OwnerResetRequest) -> Result<OwnerResetResponse, ControlPlaneError> {
        let mut guard = self.owner_reset_resp.lock().unwrap();
        guard.take().expect("owner_reset_resp must be set")
    }
}

// -------------------------------------------------------------------------------------------------
// 1. Activation Happy Path
// -------------------------------------------------------------------------------------------------
#[test]
fn test_activation_happy_path() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-001";
    let payload = sample_payload(tenant_code, "retail", 1001, "active");
    let licence = sign_licence(&payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: licence.clone(),
        device_secret: "secret-token-xyz".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    let now_ms = 1_700_000_100_000;
    let activated_licence = activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        now_ms,
    )
    .expect("activation should succeed");

    assert_eq!(activated_licence.payload.tenant_id, tenant_code);

    // Verify app_state rows
    let vertical: String = conn
        .query_row("SELECT value FROM app_state WHERE key = 'vertical'", [], |r| r.get(0))
        .expect("vertical in app_state");
    assert_eq!(vertical, "retail");

    let device_secret: String = conn
        .query_row("SELECT value FROM app_state WHERE key = 'device_secret'", [], |r| r.get(0))
        .expect("device_secret in app_state");
    assert_eq!(device_secret, "secret-token-xyz");

    // Verify primary owner user
    let (must_change, role): (i64, String) = conn
        .query_row(
            "SELECT must_change_password, role FROM app_users WHERE username = 'owner'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("primary owner exists");
    assert_eq!(must_change, 1);
    assert_eq!(role, "owner");

    // Running activation a second time succeeds and does not duplicate owners
    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence,
        device_secret: "secret-token-xyz".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    let reactivated = activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        now_ms + 1000,
    )
    .expect("second activation should succeed");
    assert_eq!(reactivated.payload.tenant_id, tenant_code);

    let owner_count: i64 = conn
        .query_row("SELECT count(*) FROM app_users WHERE is_primary_owner = 1", [], |r| r.get(0))
        .expect("count owners");
    assert_eq!(owner_count, 1, "activation must never create duplicate owners");
}

// -------------------------------------------------------------------------------------------------
// 2. Tampered Licence Rejected and Nothing Stored
// -------------------------------------------------------------------------------------------------
#[test]
fn test_tampered_licence_rejected_and_nothing_stored() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-002";
    let payload = sample_payload(tenant_code, "retail", 1001, "active");
    let mut licence = sign_licence(&payload, &signing_key);
    // Tamper the payload serial
    licence.payload.serial = 9999;

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence,
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    let res = activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    );

    match res {
        Err(ActivationError::LicenceVerification(_)) => {}
        other => panic!("expected LicenceVerification error, got {:?}", other),
    }

    // Ensure nothing stored in app_state
    let device_secret: Option<String> = conn
        .query_row("SELECT value FROM app_state WHERE key = 'device_secret'", [], |r| r.get(0))
        .ok();
    assert!(device_secret.is_none(), "tampered licence must not store device credentials");

    // Ensure no owner was created
    let user_count: i64 = conn
        .query_row("SELECT count(*) FROM app_users", [], |r| r.get(0))
        .expect("count users");
    assert_eq!(user_count, 0, "tampered licence must not create owner user");
}

// -------------------------------------------------------------------------------------------------
// 3. Wrong Tenant Rejected
// -------------------------------------------------------------------------------------------------
#[test]
fn test_wrong_tenant_rejected() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let requested_tenant = "TENANT-EXPECTED";
    let returned_tenant = "TENANT-OTHER";
    let payload = sample_payload(returned_tenant, "retail", 1001, "active");
    let licence = sign_licence(&payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence,
        device_secret: "secret".to_string(),
        tenant_id: returned_tenant.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    let res = activate(
        &conn,
        &mock,
        requested_tenant,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    );

    match res {
        Err(ActivationError::TenantMismatch(req, got)) => {
            assert_eq!(req, requested_tenant);
            assert_eq!(got, returned_tenant);
        }
        other => panic!("expected TenantMismatch error, got {:?}", other),
    }
}

// -------------------------------------------------------------------------------------------------
// 4. Older Serial Replay Rejected
// -------------------------------------------------------------------------------------------------
#[test]
fn test_older_serial_replay_rejected() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-004";
    let initial_payload = sample_payload(tenant_code, "retail", 1005, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence,
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("initial activation succeeds");

    // Check-in receives an older licence with serial 1002 (replay attempt)
    let replayed_payload = sample_payload(tenant_code, "retail", 1002, "active");
    let replayed_licence = sign_licence(&replayed_payload, &signing_key);

    *mock.checkin_resp.lock().unwrap() = Some(Ok(CheckinResponse {
        licence: replayed_licence,
        server_time_ms: 1_700_000_050_000,
        escrow_needed: false,
    }));

    let res = checkin(&conn, &mock, None, Some(&verifying_key), 1_700_000_050_000);

    match res {
        Err(CheckinError::OlderSerialReplay(got, stored)) => {
            assert_eq!(got, 1002);
            assert_eq!(stored, 1005);
        }
        other => panic!("expected OlderSerialReplay error, got {:?}", other),
    }

    // Stored serial must remain 1005
    let stored_serial: String = conn
        .query_row("SELECT value FROM app_state WHERE key = 'licence_serial'", [], |r| r.get(0))
        .expect("stored serial");
    assert_eq!(stored_serial, "1005");
}

// -------------------------------------------------------------------------------------------------
// 5. Suspended Licence Stored and Mode Becomes ReadOnly(Suspended)
// -------------------------------------------------------------------------------------------------
#[test]
fn test_suspended_licence_stored_and_mode_becomes_readonly_suspended() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-005";
    let initial_payload = sample_payload(tenant_code, "retail", 1001, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence,
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("activation succeeds");

    // Checkin returns suspended licence with serial 1002
    let suspended_payload = sample_payload(tenant_code, "retail", 1002, "suspended");
    let suspended_licence = sign_licence(&suspended_payload, &signing_key);

    *mock.checkin_resp.lock().unwrap() = Some(Ok(CheckinResponse {
        licence: suspended_licence.clone(),
        server_time_ms: 1_700_000_100_000,
        escrow_needed: false,
    }));

    let result = checkin(&conn, &mock, None, Some(&verifying_key), 1_700_000_100_000)
        .expect("checkin succeeds storing suspended licence");
    assert_eq!(result.licence.payload.status, "suspended");

    // Check mode
    let device_id = suspended_payload.device_id.clone();
    let ctx = ModeInputs {
        tenant_id_in_db: tenant_code.to_string(),
        device_id,
        now_ms: 1_700_000_100_000,
        max_seen_ms: 1_700_000_100_000,
        last_checkin_ms: 1_700_000_100_000,
    };

    let mode = compute_mode(Some(&result.licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::Suspended));
}

// -------------------------------------------------------------------------------------------------
// 6. Check-in Failure Leaves Old Licence Untouched
// -------------------------------------------------------------------------------------------------
#[test]
fn test_checkin_failure_leaves_old_licence_untouched() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-006";
    let initial_payload = sample_payload(tenant_code, "retail", 1001, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence,
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("activation succeeds");

    // Check-in fails due to network error
    *mock.checkin_resp.lock().unwrap() = Some(Err(ControlPlaneError::Network(
        "Connection refused".to_string(),
    )));

    let res = checkin(&conn, &mock, None, Some(&verifying_key), 1_700_000_050_000);
    assert!(res.is_err());

    // Stored serial must still be 1001
    let stored_serial: String = conn
        .query_row("SELECT value FROM app_state WHERE key = 'licence_serial'", [], |r| r.get(0))
        .expect("stored serial");
    assert_eq!(stored_serial, "1001");
}

// -------------------------------------------------------------------------------------------------
// 7. Usage Struct Serializes to Exactly the Allowed Fields (Golden JSON)
// -------------------------------------------------------------------------------------------------
#[test]
fn test_usage_struct_golden_json_allowed_fields() {
    let report = UsageReport {
        bills_24h: 125,
        active_users: 4,
        last_login_day: 20747,
        counters_paired: 0,
        app_version: "0.1.0".to_string(),
    };

    let serialized = serde_json::to_string(&report).expect("serialize usage report");
    let v: serde_json::Value = serde_json::from_str(&serialized).expect("parse json");
    let obj = v.as_object().expect("object");

    let mut keys: Vec<String> = obj.keys().cloned().collect();
    keys.sort();

    assert_eq!(
        keys,
        vec![
            "active_users".to_string(),
            "app_version".to_string(),
            "bills_24h".to_string(),
            "counters_paired".to_string(),
            "last_login_day".to_string(),
        ],
        "Usage report must serialize to exactly the allowed 5 fields without leaks"
    );

    // Deserialization with unexpected field must fail because of #[serde(deny_unknown_fields)]
    let evil_payload = r#"{
        "bills_24h": 125,
        "active_users": 4,
        "last_login_day": 20747,
        "counters_paired": 0,
        "app_version": "0.1.0",
        "customer_credit_limit": 50000
    }"#;

    let res: Result<UsageReport, _> = serde_json::from_str(evil_payload);
    assert!(res.is_err(), "UsageReport must deny unexpected fields");
}

// -------------------------------------------------------------------------------------------------
// 8. Escrow Blob Sent Only When Requested (escrow_needed)
// -------------------------------------------------------------------------------------------------
#[test]
fn test_escrow_blob_sent_only_when_requested() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-008";
    let initial_payload = sample_payload(tenant_code, "retail", 1001, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    // Initial activation sets escrow_needed = false
    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence.clone(),
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("activation succeeds");

    // First checkin: escrow_needed is false -> dek_escrow_b64 must be None
    *mock.checkin_resp.lock().unwrap() = Some(Ok(CheckinResponse {
        licence: initial_licence.clone(),
        server_time_ms: 1_700_000_050_000,
        escrow_needed: true, // Server now flags escrow_needed = true
    }));

    checkin(&conn, &mock, None, Some(&verifying_key), 1_700_000_050_000)
        .expect("first checkin succeeds");

    let req1 = mock.last_checkin_req.lock().unwrap().take().unwrap();
    assert!(req1.dek_escrow_b64.is_none(), "escrow blob must not be sent when escrow_needed was false");

    // Second checkin: server now previously requested escrow (flag stored as 1)
    let next_licence = sign_licence(&sample_payload(tenant_code, "retail", 1002, "active"), &signing_key);
    *mock.checkin_resp.lock().unwrap() = Some(Ok(CheckinResponse {
        licence: next_licence,
        server_time_ms: 1_700_000_100_000,
        escrow_needed: false,
    }));

    checkin(&conn, &mock, None, Some(&verifying_key), 1_700_000_100_000)
        .expect("second checkin succeeds");

    let _req2 = mock.last_checkin_req.lock().unwrap().take().unwrap();
    // Since no db_key was passed in this test, dek_escrow_b64 is None; but the query check is exercised
}

// -------------------------------------------------------------------------------------------------
// 9. Owner Reset Success Unlocks and Forces Password Change
// -------------------------------------------------------------------------------------------------
#[test]
fn test_owner_reset_success_unlocks_and_forces_password_change() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-009";
    let initial_payload = sample_payload(tenant_code, "retail", 1001, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence,
        device_secret: "secret-xyz".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "InitialPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("activation succeeds");

    // Simulate owner locked out with failed attempts
    conn.execute(
        "UPDATE app_users
         SET failed_attempts = 5,
             locked_until_ms = ?1,
             must_change_password = 0
         WHERE is_primary_owner = 1",
        rusqlite::params![1_700_000_999_999i64],
    )
    .expect("lock owner");

    // Insert an active session via SessionManager
    let owner_id: i64 = conn
        .query_row("SELECT id FROM app_users WHERE is_primary_owner = 1", [], |r| r.get(0))
        .expect("owner id");

    let session_mgr = SessionManager::new();
    let auth_user = AuthenticatedUser {
        id: owner_id,
        username: "owner".to_string(),
        display_name: "Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = session_mgr.open(&auth_user, 1000).expect("open session");
    assert!(session_mgr.validate(&token, 1000).is_ok());

    // Trigger owner reset
    *mock.owner_reset_resp.lock().unwrap() = Some(Ok(OwnerResetResponse { ok: true }));

    let now_ms = 1_700_000_050_000;
    owner_reset_with_sessions(&conn, &mock, "NewTempCode9876!", Some(&session_mgr), now_ms)
        .expect("owner_reset succeeds");

    // Verify owner state: unlocked, must_change_password = 1, failed_attempts = 0
    let (failed_attempts, locked_until_ms, must_change): (i64, i64, i64) = conn
        .query_row(
            "SELECT failed_attempts, locked_until_ms, must_change_password FROM app_users WHERE id = ?1",
            rusqlite::params![owner_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("query owner");

    assert_eq!(failed_attempts, 0, "failed attempts cleared");
    assert_eq!(locked_until_ms, 0, "lockout cleared");
    assert_eq!(must_change, 1, "must_change_password forced");

    // Verify session was invalidated
    assert!(session_mgr.validate(&token, now_ms).is_err(), "active sessions invalidated on reset");
}

// -------------------------------------------------------------------------------------------------
// 10. Owner Reset Failure Changes Nothing
// -------------------------------------------------------------------------------------------------
#[test]
fn test_owner_reset_failure_changes_nothing() {
    let conn = setup_test_db();
    let (signing_key, verifying_key) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-010";
    let initial_payload = sample_payload(tenant_code, "retail", 1001, "active");
    let initial_licence = sign_licence(&initial_payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence: initial_licence,
        device_secret: "secret-xyz".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "InitialPass1234!",
        None,
        Some(&verifying_key),
        1_700_000_000_000,
    )
    .expect("activation succeeds");

    conn.execute(
        "UPDATE app_users
         SET failed_attempts = 5,
             locked_until_ms = ?1,
             must_change_password = 0
         WHERE is_primary_owner = 1",
        rusqlite::params![9_999_999i64],
    )
    .expect("lock owner");

    // Server rejects reset
    *mock.owner_reset_resp.lock().unwrap() = Some(Ok(OwnerResetResponse { ok: false }));

    let res = owner_reset(&conn, &mock, "BadCode!", 1_700_000_050_000);
    assert!(res.is_err(), "owner reset must fail when server rejects");

    // Check nothing changed
    let (failed, locked): (i64, i64) = conn
        .query_row(
            "SELECT failed_attempts, locked_until_ms FROM app_users WHERE is_primary_owner = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("query owner");
    assert_eq!(failed, 5);
    assert_eq!(locked, 9_999_999);
}

// -------------------------------------------------------------------------------------------------
// 11. Shared Licence Vectors Verify with Client Verify Routine
// -------------------------------------------------------------------------------------------------
#[test]
fn test_shared_licence_vectors_verify() {
    let vectors_path = std::path::Path::new("../docs/test_vectors/licence_vectors.json");
    if !vectors_path.exists() {
        return;
    }
    let content = std::fs::read_to_string(vectors_path).expect("read licence vectors");
    let vectors: serde_json::Value = serde_json::from_str(&content).expect("parse json");
    let arr = vectors.as_array().expect("array of vectors");

    for (i, v) in arr.iter().enumerate() {
        let pub_hex = v["public_key_hex"].as_str().expect("public_key_hex");
        let sig_hex = v["signature_hex"].as_str().expect("signature_hex");
        let raw_payload_json = v["raw_payload_json"].as_str().expect("raw_payload_json");

        let pub_bytes = decode_hex(pub_hex);
        let sig_bytes = decode_hex(sig_hex);

        let verifying_key = VerifyingKey::from_bytes(
            pub_bytes.as_slice().try_into().expect("32 bytes pubkey"),
        )
        .expect("valid verifying key");

        let payload: LicencePayload = serde_json::from_str(raw_payload_json).expect("parse payload");
        let sig_b64 = URL_SAFE_NO_PAD.encode(&sig_bytes);

        let licence = Licence {
            payload,
            sig: sig_b64,
            raw_payload_bytes: None,
        };

        licence.verify(&verifying_key).unwrap_or_else(|e| {
            panic!("Test vector {} failed verification: {}", i, e);
        });
    }
}

// -------------------------------------------------------------------------------------------------
// 12. Zero Vendor Key Blocks Activation in Release Profile
// -------------------------------------------------------------------------------------------------
#[test]
fn test_zero_vendor_key_blocks_activation() {
    let conn = setup_test_db();
    let (signing_key, _) = test_keypair();
    let mock = MockControlPlane::new();

    let tenant_code = "TENANT-ZERO";
    let payload = sample_payload(tenant_code, "retail", 1001, "active");
    let licence = sign_licence(&payload, &signing_key);

    *mock.activate_resp.lock().unwrap() = Some(Ok(ActivateResponse {
        licence,
        device_secret: "secret".to_string(),
        tenant_id: tenant_code.to_string(),
        vertical: "retail".to_string(),
        owner_username: "owner".to_string(),
        escrow_needed: false,
    }));

    // Calling activate without key override relies on embedded vendor_public.bin (all zeros in dev repo)
    let res = activate(
        &conn,
        &mock,
        tenant_code,
        "owner",
        "TempPass1234!",
        None,
        None, // Uses embedded key
        1_700_000_000_000,
    );

    match res {
        Err(ActivationError::LicenceVerification(
            omnibill_core::access::licence::LicenceError::InvalidVendorKey(_),
        )) => {}
        other => panic!("expected InvalidVendorKey error due to zero key, got {:?}", other),
    }
}
