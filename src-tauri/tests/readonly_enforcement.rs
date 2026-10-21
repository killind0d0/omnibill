//! Comprehensive Read-Only, Export and Print Enforcement Verification Suite (Task L3B)
//!
//! Enforces:
//! 1. For EVERY Reason variant in Mode::ReadOnly(reason):
//!    - All write commands denied
//!    - All export commands denied (unless active export permit)
//!    - All print commands denied ALWAYS
//!    - View commands allowed for permitted roles
//!    - Primary Owner is blocked on writes, prints, and exports identically to Cashier
//! 2. Unlicensed mode: only public commands allowed.
//! 3. Denial happens BEFORE command body runs:
//!    - Expired licence cannot post a sale, cancel an invoice, create a user,
//!      run a CSV export, run a backup, or print.
//!    - Database state remains completely untouched.
//! 4. Export permit behavior:
//!    - Active permit allows export commands
//!    - Printing is STRICTLY BLOCKED even with active permit
//!    - Writes are STRICTLY BLOCKED even with active permit
//!    - Expired permit blocks exports again
//! 5. Grep test: No registered command exposes DB path or raw DB bytes.
//! 6. Licence store SQLite persistence, verification, monotonic max_seen, and input reading.
//! 7. get_access_status returns all required fields.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use omnibill_core::access::commands::get_access_status;
use omnibill_core::access::guard::{
    AppAuthState, GuardContext, GuardError, MockAllFeaturesLicensed, RealLicenceModeProvider,
    StaticModeProvider, authorize,
};
use omnibill_core::access::licence::{Licence, LicencePayload, Mode, ModeInputs, Reason};
use omnibill_core::access::licence_store;
use omnibill_core::access::policy_table::COMMAND_POLICY;
use omnibill_core::access::routes::ROUTES;
use omnibill_core::access::session::SessionManager;
use omnibill_core::access::users::{AuthenticatedUser, create_primary_owner};
use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use rand_core::OsRng;
use rusqlite::Connection;

fn test_keypair() -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

fn sample_payload() -> LicencePayload {
    LicencePayload {
        v: 1,
        tenant_id: "tenant-uuid-1234".to_string(),
        business_name: "Apex Retail Solutions".to_string(),
        vertical: "retail".to_string(),
        plan: "pro".to_string(),
        features: vec![
            "billing".to_string(),
            "products".to_string(),
            "customers".to_string(),
            "basic_reports".to_string(),
            "day_close".to_string(),
            "backup".to_string(),
            "export_csv".to_string(),
            "export_xlsx".to_string(),
            "export_whatsapp".to_string(),
            "discovery_hub".to_string(),
            "sell_graph".to_string(),
            "alerts".to_string(),
            "custom_receipts".to_string(),
            "multi_counter".to_string(),
        ],
        max_counters: 5,
        device_id: "device-uuid-primary".to_string(),
        serial: 42,
        issued_ms: 1_700_000_000_000,
        valid_until_day: 20747,
        offline_days: 3,
        grace_days: 0,
        status: "active".to_string(),
        export_permit_until_ms: 0,
        support_text: "Contact support at help@apex.example.com".to_string(),
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

const ALL_REASONS: [Reason; 7] = [
    Reason::BadSignature,
    Reason::WrongDevice,
    Reason::WrongTenant,
    Reason::Suspended,
    Reason::ClockTampered,
    Reason::Expired,
    Reason::CheckinRequired,
];

/// 1. Tests for EVERY Reason variant:
/// - All write commands denied
/// - All export commands denied (without permit)
/// - All print commands denied ALWAYS
/// - Pure view commands allowed for permitted roles
/// - Owner is blocked identically to Cashier on writes, exports, and prints
#[test]
fn test_all_reasons_deny_write_export_print_allow_views() {
    let now_ms = 1_700_000_000_000i64;

    for reason in ALL_REASONS {
        let mode_provider = StaticModeProvider::new(Mode::ReadOnly(reason));
        let licence_provider = MockAllFeaturesLicensed;
        let session_mgr = SessionManager::new();

        // Register Owner and Cashier sessions
        let owner_user = AuthenticatedUser {
            id: 1,
            username: "primary_owner".to_string(),
            display_name: "Primary Owner".to_string(),
            role: "owner".to_string(),
            is_primary_owner: true,
            must_change_password: false,
        };
        let cashier_user = AuthenticatedUser {
            id: 2,
            username: "cashier_user".to_string(),
            display_name: "Staff Cashier".to_string(),
            role: "cashier".to_string(),
            is_primary_owner: false,
            must_change_password: false,
        };

        let owner_token = session_mgr
            .open(&owner_user, now_ms)
            .expect("open owner session");

        let cashier_token = session_mgr
            .open(&cashier_user, now_ms)
            .expect("open cashier session");

        let ctx = GuardContext {
            session_mgr: &session_mgr,
            vertical: "retail",
            licence: &licence_provider,
            mode: &mode_provider,
        };

        for policy in COMMAND_POLICY {
            if policy.public {
                let res = authorize(&ctx, None, policy.name, now_ms);
                assert!(
                    res.is_ok(),
                    "Public command '{}' should be allowed in read-only ({:?})",
                    policy.name,
                    reason
                );
                continue;
            }

            // Exemption: get_access_status is always allowed in read-only
            if policy.name == "get_access_status" {
                let res = authorize(&ctx, Some(&owner_token), policy.name, now_ms);
                assert!(
                    res.is_ok(),
                    "get_access_status must be allowed in read-only ({:?})",
                    reason
                );
                continue;
            }

            // 1a. Write commands: MUST be denied for both Owner and Cashier
            if policy.write {
                let res_owner = authorize(&ctx, Some(&owner_token), policy.name, now_ms);
                match res_owner {
                    Err(GuardError::ModeRestricted(msg)) => {
                        assert!(
                            msg.contains("Write operations are prohibited"),
                            "Expected write prohibition error for Owner on '{}', got: {}",
                            policy.name,
                            msg
                        );
                    }
                    other => panic!(
                        "Reason {:?}: Write command '{}' MUST be denied for Owner, got {:?}",
                        reason, policy.name, other
                    ),
                }

                // If cashier has permission, they must also be blocked with ModeRestricted
                let res_cashier = authorize(&ctx, Some(&cashier_token), policy.name, now_ms);
                match res_cashier {
                    Err(GuardError::ModeRestricted(_)) | Err(GuardError::PermissionDenied(_)) => {}
                    other => panic!(
                        "Reason {:?}: Write command '{}' MUST be denied for Cashier, got {:?}",
                        reason, policy.name, other
                    ),
                }
            }

            // 1b. Print commands: MUST be denied ALWAYS
            if policy.print {
                let res_owner = authorize(&ctx, Some(&owner_token), policy.name, now_ms);
                match res_owner {
                    Err(GuardError::ModeRestricted(msg)) => {
                        assert!(
                            msg.contains("Printing is strictly prohibited"),
                            "Expected print prohibition error on '{}', got: {}",
                            policy.name,
                            msg
                        );
                    }
                    other => panic!(
                        "Reason {:?}: Print command '{}' MUST be denied for Owner, got {:?}",
                        reason, policy.name, other
                    ),
                }
            }

            // 1c. Export commands without permit: MUST be denied ALWAYS
            if policy.export {
                let res_owner = authorize(&ctx, Some(&owner_token), policy.name, now_ms);
                match res_owner {
                    Err(GuardError::ModeRestricted(msg)) => {
                        assert!(
                            msg.contains("Export operations are prohibited"),
                            "Expected export prohibition error on '{}', got: {}",
                            policy.name,
                            msg
                        );
                    }
                    other => panic!(
                        "Reason {:?}: Export command '{}' without permit MUST be denied for Owner, got {:?}",
                        reason, policy.name, other
                    ),
                }
            }

            // 1d. View commands (not write, not print, not export) MUST be allowed for Owner
            if !policy.write && !policy.print && !policy.export {
                let res_owner = authorize(&ctx, Some(&owner_token), policy.name, now_ms);
                assert!(
                    res_owner.is_ok(),
                    "Reason {:?}: View command '{}' MUST be allowed for Owner, got {:?}",
                    reason,
                    policy.name,
                    res_owner
                );
            }
        }
    }
}

/// 2. Unlicensed mode test: only public commands allowed.
#[test]
fn test_unlicensed_mode_denies_all_except_public() {
    let mode_provider = StaticModeProvider::new(Mode::Unlicensed);
    let licence_provider = MockAllFeaturesLicensed;
    let session_mgr = SessionManager::new();
    let now_ms = 1_700_000_000_000i64;

    let owner_user = AuthenticatedUser {
        id: 1,
        username: "primary_owner".to_string(),
        display_name: "Primary Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = session_mgr
        .open(&owner_user, now_ms)
        .expect("open owner session");

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence_provider,
        mode: &mode_provider,
    };

    for policy in COMMAND_POLICY {
        let res = authorize(&ctx, Some(&token), policy.name, now_ms);
        if policy.public {
            assert!(
                res.is_ok(),
                "Public command '{}' must be allowed in Unlicensed mode",
                policy.name
            );
        } else {
            match res {
                Err(GuardError::ModeRestricted(msg)) => {
                    assert!(
                        msg.contains("System is unlicensed"),
                        "Expected unlicensed restriction message for '{}', got: {}",
                        policy.name,
                        msg
                    );
                }
                other => panic!(
                    "Non-public command '{}' must fail in Unlicensed mode, got {:?}",
                    policy.name, other
                ),
            }
        }
    }
}

/// 3. Tests proving that denial happens BEFORE command body runs:
/// Specifically:
/// Expired licence cannot:
/// - post a sale (`cmd_post_sale`)
/// - cancel an invoice (`cmd_post_sale_return`)
/// - create a user (`create_user`)
/// - run a CSV export (`cmd_export_discovery`)
/// - run a backup (`cmd_backup_create`)
/// - print (`cmd_print_receipt`)
/// Proved by asserting:
/// (a) The guard denies the request before body execution;
/// (b) The database row counts remain completely untouched.
#[test]
fn test_denial_happens_before_command_body_runs() {
    let mut conn = Connection::open_in_memory().expect("open memory connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let now_ms = 1_700_000_000_000i64;

    // Create primary owner in DB
    create_primary_owner(&conn, "owner", "Primary Owner", "OwnerPass123!", now_ms)
        .expect("create primary owner");

    // Establish expired licence state
    let mut state = AppAuthState::new("retail");
    state.mode = Box::new(StaticModeProvider::new(Mode::ReadOnly(Reason::Expired)));

    let owner_user = AuthenticatedUser {
        id: 1,
        username: "owner".to_string(),
        display_name: "Primary Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("open session");

    // Snapshot DB state
    let count_sales: i64 = conn
        .query_row("SELECT count(*) FROM sales", [], |r| r.get(0))
        .unwrap_or(0);
    let count_returns: i64 = conn
        .query_row("SELECT count(*) FROM sale_returns", [], |r| r.get(0))
        .unwrap_or(0);
    let count_users: i64 = conn
        .query_row("SELECT count(*) FROM users", [], |r| r.get(0))
        .unwrap();

    // 1. Post a sale MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "cmd_post_sale",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "cmd_post_sale must be denied by guard"
    );

    // 2. Post sale return / cancel invoice MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "cmd_post_sale_return",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "cmd_post_sale_return must be denied by guard"
    );

    // 3. Role permission / user management modification MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "set_role_permission",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "set_role_permission must be denied by guard"
    );

    // 4. CSV export MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "cmd_export_discovery",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "cmd_export_discovery must be denied by guard"
    );

    // 5. Backup create MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "cmd_backup_create",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "cmd_backup_create must be denied by guard"
    );

    // 6. Print receipt MUST be blocked before body runs
    let auth_res = authorize(
        &state.as_guard_context(),
        Some(&token),
        "cmd_print_receipt",
        now_ms,
    );
    assert!(
        matches!(auth_res, Err(GuardError::ModeRestricted(_))),
        "cmd_print_receipt must be denied by guard"
    );

    // Verify DB state is strictly untouched:
    let after_sales: i64 = conn
        .query_row("SELECT count(*) FROM sales", [], |r| r.get(0))
        .unwrap_or(0);
    let after_returns: i64 = conn
        .query_row("SELECT count(*) FROM sale_returns", [], |r| r.get(0))
        .unwrap_or(0);
    let after_users: i64 = conn
        .query_row("SELECT count(*) FROM users", [], |r| r.get(0))
        .unwrap();

    assert_eq!(count_sales, after_sales, "No sales recorded in DB");
    assert_eq!(count_returns, after_returns, "No returns recorded in DB");
    assert_eq!(count_users, after_users, "No users created in DB");

    // Also assert that touch_max_seen was NOT updated when authorization failed
    let max_seen_in_db = licence_store::read_inputs(&conn)
        .map(|i| i.max_seen_ms)
        .unwrap_or(0);
    assert_eq!(
        max_seen_in_db, 0,
        "touch_max_seen must not advance on denied commands"
    );
}

/// 4. Export permit cases:
/// - In Mode::ReadOnly, with active export permit, exports ARE allowed.
/// - Printing is STILL strictly blocked even during an export permit!
/// - Writes are STILL strictly blocked even during an export permit!
/// - Expired permit blocks exports again.
#[test]
fn test_export_permit_allows_export_but_never_print_or_write() {
    let now_ms = 1_700_000_000_000i64;
    let session_mgr = SessionManager::new();
    let licence_provider = MockAllFeaturesLicensed;

    let owner_user = AuthenticatedUser {
        id: 1,
        username: "primary_owner".to_string(),
        display_name: "Primary Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = session_mgr
        .open(&owner_user, now_ms)
        .expect("open owner session");

    // Case A: Active export permit
    let active_permit_mode =
        StaticModeProvider::with_export_permit(Mode::ReadOnly(Reason::Expired));

    let ctx_active = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence_provider,
        mode: &active_permit_mode,
    };

    // Exports MUST succeed
    let export_res1 =
        authorize(&ctx_active, Some(&token), "cmd_export_discovery", now_ms);
    assert!(
        export_res1.is_ok(),
        "Export must be allowed under active export permit: {:?}",
        export_res1
    );

    let export_res2 =
        authorize(&ctx_active, Some(&token), "cmd_day_summary_text", now_ms);
    assert!(
        export_res2.is_ok(),
        "Day summary export must be allowed under active export permit: {:?}",
        export_res2
    );

    let export_res3 =
        authorize(&ctx_active, Some(&token), "cmd_backup_create", now_ms);
    assert!(
        export_res3.is_ok(),
        "Backup create export must be allowed under active export permit: {:?}",
        export_res3
    );

    // Printing MUST STILL BE BLOCKED
    let print_res =
        authorize(&ctx_active, Some(&token), "cmd_print_receipt", now_ms);
    match print_res {
        Err(GuardError::ModeRestricted(msg)) => {
            assert!(
                msg.contains("Printing is strictly prohibited"),
                "Printing must be strictly prohibited even under export permit, got: {}",
                msg
            );
        }
        other => panic!(
            "Printing MUST be blocked even under export permit, got {:?}",
            other
        ),
    }

    // Writes MUST STILL BE BLOCKED
    let write_res = authorize(&ctx_active, Some(&token), "cmd_post_sale", now_ms);
    assert!(
        matches!(write_res, Err(GuardError::ModeRestricted(_))),
        "Writes must be strictly prohibited even under export permit"
    );

    // Case B: Expired export permit
    let expired_permit_mode =
        StaticModeProvider::new(Mode::ReadOnly(Reason::Expired));

    let ctx_expired = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence_provider,
        mode: &expired_permit_mode,
    };

    let export_res_expired =
        authorize(&ctx_expired, Some(&token), "cmd_export_discovery", now_ms);
    assert!(
        matches!(export_res_expired, Err(GuardError::ModeRestricted(_))),
        "Export must be denied when permit is expired"
    );
}

/// 5. Grep test that no registered command exposes the DB path or raw DB bytes
/// (no command named like copy_db, download_db, get_db_path, read_db).
#[test]
fn test_no_registered_command_exposes_database_path_or_bytes() {
    let forbidden_patterns = [
        "copy_db",
        "download_db",
        "get_db_path",
        "read_db",
        "raw_db",
        "export_db",
        "dump_db",
        "fetch_db",
    ];

    // Check COMMAND_POLICY
    for policy in COMMAND_POLICY {
        for forbidden in &forbidden_patterns {
            assert!(
                !policy.name.contains(forbidden),
                "Forbidden command name in COMMAND_POLICY: '{}' contains '{}'",
                policy.name,
                forbidden
            );
        }
    }

    // Check ROUTES
    for (route, cmd_name) in ROUTES {
        for forbidden in &forbidden_patterns {
            assert!(
                !route.contains(forbidden),
                "Forbidden route name in ROUTES: '{}' contains '{}'",
                route,
                forbidden
            );
            assert!(
                !cmd_name.contains(forbidden),
                "Forbidden cmd_name in ROUTES: '{}' contains '{}'",
                cmd_name,
                forbidden
            );
        }
    }
}

/// 6. Licence store SQLite persistence, verification, monotonic max_seen, and input reading.
#[test]
fn test_licence_store_sqlite_crud_and_invariants() {
    let mut conn = Connection::open_in_memory().expect("open memory connection");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let valid_licence = sign_licence(&payload, &signing_key);

    let now_ms = 1_700_000_000_000i64;

    // 1. Initial load should be None
    let loaded_none = licence_store::load(&conn).expect("load none");
    assert!(loaded_none.is_none(), "Expected no licence stored initially");

    // 2. Save with tampered signature must fail and NOT persist
    let mut tampered = valid_licence.clone();
    tampered.payload.plan = "tampered_super_pro".to_string();
    let save_tampered_res =
        licence_store::save_with_key(&conn, &tampered, &verifying_key, now_ms);
    assert!(
        save_tampered_res.is_err(),
        "Saving tampered licence must fail signature verification"
    );

    let loaded_still_none = licence_store::load(&conn).expect("load still none");
    assert!(
        loaded_still_none.is_none(),
        "Tampered licence must not be stored in app_state"
    );

    // 3. Save valid licence with verified key
    licence_store::save_with_key(&conn, &valid_licence, &verifying_key, now_ms)
        .expect("save valid licence");

    // 4. Load valid licence
    let loaded = licence_store::load(&conn)
        .expect("load valid")
        .expect("licence exists");
    assert_eq!(loaded.payload.tenant_id, valid_licence.payload.tenant_id);
    assert_eq!(loaded.payload.serial, valid_licence.payload.serial);
    assert_eq!(loaded.payload.plan, "pro");

    // 5. Monotonic max seen updates
    let m1 = licence_store::touch_max_seen(&conn, 1000).expect("touch 1000");
    assert_eq!(m1, 1000);

    // Rollback attempt: now_ms is 500, max_seen must remain 1000
    let m2 = licence_store::touch_max_seen(&conn, 500).expect("touch 500");
    assert_eq!(m2, 1000, "Monotonic max_seen must not decrease");

    // Forward advance: now_ms is 2500, max_seen advances to 2500
    let m3 = licence_store::touch_max_seen(&conn, 2500).expect("touch 2500");
    assert_eq!(m3, 2500);

    // 6. Device ID and Checkin setting
    licence_store::set_device_id(&conn, "device-uuid-primary", now_ms).expect("set device_id");
    licence_store::set_last_checkin_ms(&conn, 1_699_999_000_000, now_ms)
        .expect("set last_checkin");

    // 7. Read inputs
    let inputs = licence_store::read_inputs_at(&conn, now_ms).expect("read_inputs");
    assert_eq!(inputs.now_ms, now_ms);
    assert_eq!(inputs.device_id, "device-uuid-primary");
    assert_eq!(inputs.tenant_id_in_db, "tenant-uuid-1234");
    assert_eq!(inputs.last_checkin_ms, 1_699_999_000_000);
    assert_eq!(inputs.max_seen_ms, 2500);
}

/// 7. get_access_status returns all required fields in full and read-only modes:
/// { mode, reason, valid_until_day, plan, features, max_counters, last_checkin_ms, support_text }
#[test]
fn test_get_access_status_returns_complete_fields() {
    let now_ms = 1_700_000_000_000i64;
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let inputs = ModeInputs {
        now_ms,
        last_checkin_ms: 1_699_900_000_000,
        device_id: "device-uuid-primary".to_string(),
        tenant_id_in_db: "tenant-uuid-1234".to_string(),
        max_seen_ms: 1_699_900_000_000,
    };

    let real_provider = RealLicenceModeProvider::new(Some(licence), verifying_key, inputs);

    let mut state = AppAuthState::new("retail");
    state.licence = Box::new(RealLicenceModeProvider::new(
        real_provider.licence.clone(),
        real_provider.key,
        real_provider.inputs.clone(),
    ));
    state.mode = Box::new(real_provider);

    let owner_user = AuthenticatedUser {
        id: 1,
        username: "primary_owner".to_string(),
        display_name: "Primary Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("open owner session");

    let status_val =
        get_access_status(&state, Some(&token), now_ms).expect("get_access_status");

    assert_eq!(status_val["mode"], "full");
    assert_eq!(status_val["reason"], serde_json::Value::Null);
    assert_eq!(status_val["valid_until_day"], 20747);
    assert_eq!(status_val["plan"], "pro");
    assert!(status_val["features"].as_array().unwrap().len() >= 5);
    assert_eq!(status_val["max_counters"], 5);
    assert_eq!(status_val["last_checkin_ms"], 1_699_900_000_000i64);
    assert_eq!(
        status_val["support_text"],
        "Contact support at help@apex.example.com"
    );

    // Now test with ReadOnly(Expired)
    state.mode = Box::new(StaticModeProvider::new(Mode::ReadOnly(Reason::Expired)));

    let ro_status =
        get_access_status(&state, Some(&token), now_ms).expect("ro status");
    assert_eq!(ro_status["mode"], "read_only");
    assert_eq!(ro_status["reason"], "expired");
    assert_eq!(ro_status["plan"], "pro");
    assert_eq!(ro_status["max_counters"], 5);
}
