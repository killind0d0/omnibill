use omnibill_core::access::audit::{clear_audit_events, get_audit_events};
use omnibill_core::access::password::{check_strength, hash_password, verify_password};
use omnibill_core::access::session::{SessionError, SessionManager};
use omnibill_core::access::users::{
    AuthError, CreateUserInput, admin_reset_password, authenticate, change_password,
    create_primary_owner, create_user, set_active, set_role,
};
use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use rusqlite::Connection;

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open memory db");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable fk");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");
    clear_audit_events();
    conn
}

#[test]
fn test_password_strength_and_hashing_golden_rules() {
    // 1. Password strength rules
    assert!(check_strength("short1A!", "user1").is_err()); // < 10 chars
    assert!(check_strength("password", "user1").is_err()); // common password
    assert!(check_strength("Tr0ub4dor&3x", "user1").is_ok()); // >= 10 chars, 4 classes
    assert!(check_strength("Tr0ub4dor&3x", "Tr0ub4dor&3x").is_err()); // equals username
    assert!(check_strength("abcdefghijklmnop", "user1").is_ok()); // length >= 16 allowed single class
    assert!(check_strength("12345678", "user1").is_err()); // common password

    // 2. Hashing integrity
    let plain = "Tr0ub4dor&3x";
    let hash1 = hash_password(plain).expect("hash 1");
    let hash2 = hash_password(plain).expect("hash 2");

    // Stored hash must not equal plaintext
    assert_ne!(hash1, plain);
    assert_ne!(hash2, plain);

    // Two hashes of the same password differ due to unique salts
    assert_ne!(hash1, hash2);

    // Both hashes verify successfully against the plaintext
    assert!(verify_password(&hash1, plain));
    assert!(verify_password(&hash2, plain));
    assert!(!verify_password(&hash1, "wrong_password_attempt"));

    // Malformed hash safely returns false without panic
    assert!(!verify_password("not_a_valid_argon2_hash", plain));
    assert!(!verify_password("", plain));
}

#[test]
fn test_lockout_and_timing_boundary() {
    let conn = setup_test_db();
    let now_ms = 1_000_000_000i64;

    let owner_id = create_primary_owner(&conn, "owner_test", "Test Owner", "Tr0ub4dor&3x", now_ms)
        .expect("create owner");
    assert!(owner_id > 0);

    // 4 consecutive wrong password attempts
    for _ in 0..4 {
        let err = authenticate(&conn, "owner_test", "wrong_attempt_123", now_ms)
            .expect_err("wrong password must fail");
        assert_eq!(err, AuthError::InvalidCredentials);
    }

    // 5th wrong password attempt triggers lockout (15 minutes = 900,000 ms)
    let err5 = authenticate(&conn, "owner_test", "wrong_attempt_123", now_ms)
        .expect_err("5th attempt triggers lockout");
    assert_eq!(err5, AuthError::InvalidCredentials);

    let lock_expected = now_ms + 15 * 60_000;

    // While locked: even correct password fails with Locked WITHOUT verifying
    let err_locked = authenticate(&conn, "owner_test", "Tr0ub4dor&3x", now_ms + 500_000)
        .expect_err("locked account rejects correct password");
    assert_eq!(
        err_locked,
        AuthError::Locked {
            until_ms: lock_expected
        }
    );

    // Boundary check: after 15 minutes + 1 ms, account is unlocked and correct password succeeds
    let auth_ok = authenticate(&conn, "owner_test", "Tr0ub4dor&3x", lock_expected + 1)
        .expect("login after lockout expires must succeed");
    assert_eq!(auth_ok.username, "owner_test");
    assert_eq!(auth_ok.role, "owner");
    assert!(auth_ok.is_primary_owner);

    // Verify audit events recorded
    let events = get_audit_events();
    let event_types: Vec<String> = events.into_iter().map(|e| e.event_type).collect();
    assert!(event_types.contains(&"auth.user_created".to_string()));
    assert!(event_types.contains(&"auth.login_fail".to_string()));
    assert!(event_types.contains(&"auth.locked".to_string()));
    assert!(event_types.contains(&"auth.login_ok".to_string()));
}

#[test]
fn test_identical_error_text_unknown_vs_wrong_password() {
    let conn = setup_test_db();
    let now_ms = 1_000_000_000i64;

    create_primary_owner(
        &conn,
        "existing_user",
        "Existing User",
        "Tr0ub4dor&3x",
        now_ms,
    )
    .expect("create user");

    // 1. Unknown user error
    let err_unknown = authenticate(&conn, "unknown_user_999", "some_password_123!", now_ms)
        .expect_err("unknown user must fail");

    // 2. Existing user with wrong password
    let err_wrong = authenticate(&conn, "existing_user", "some_password_123!", now_ms)
        .expect_err("wrong password must fail");

    // Messages must be 100% identical
    assert_eq!(err_unknown, AuthError::InvalidCredentials);
    assert_eq!(err_wrong, AuthError::InvalidCredentials);
    assert_eq!(err_unknown.to_string(), err_wrong.to_string());
    assert_eq!(err_unknown.to_string(), "Invalid username or password");
}

#[test]
fn test_session_idle_and_absolute_boundaries() {
    let session_mgr = SessionManager::new();
    let user = omnibill_core::access::users::AuthenticatedUser {
        id: 42,
        username: "alice".to_string(),
        display_name: "Alice A".to_string(),
        role: "manager".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };

    let t0 = 10_000_000i64;
    let token = session_mgr.open(&user, t0).expect("open session");

    // 1. Idle boundary check:
    // 14 minutes 59 seconds elapsed (899_000 ms) -> valid
    let t_14m59s = t0 + 14 * 60_000 + 59_000;
    let session = session_mgr
        .validate(&token, t_14m59s)
        .expect("14m59s is within idle limit");
    assert_eq!(session.user_id, 42);

    // After this validation, session.last_seen_ms is refreshed to t_14m59s
    // 15 minutes 1 second without activity from t_14m59s (901_000 ms later) -> expired
    let t_idle_expired = t_14m59s + 15 * 60_000 + 1_000;
    let err_idle = session_mgr
        .validate(&token, t_idle_expired)
        .expect_err("idle limit exceeded must expire session");
    assert_eq!(err_idle, SessionError::IdleTimeout);

    // 2. Absolute lifetime boundary check:
    // Open a fresh session at t_base
    let t_base = 20_000_000i64;
    let token_abs = session_mgr.open(&user, t_base).expect("open session 2");

    // Keep it active every 10 minutes up to 12 hours
    let mut current_t = t_base;
    for _ in 0..71 {
        current_t += 10 * 60_000; // +10m
        assert!(session_mgr.validate(&token_abs, current_t).is_ok());
    }

    // Now current_t is t_base + 710 minutes (11h 50m). Still valid.
    // Jump past 12 absolute hours (12 * 3,600,000 = 43,200,000 ms from t_base)
    let t_abs_expired = t_base + 12 * 3_600_000 + 1_000;
    let err_abs = session_mgr
        .validate(&token_abs, t_abs_expired)
        .expect_err("absolute lifetime exceeded must expire session");
    assert_eq!(err_abs, SessionError::AbsoluteTimeout);
}

#[test]
fn test_session_close_all_for_user() {
    let session_mgr = SessionManager::new();
    let user1 = omnibill_core::access::users::AuthenticatedUser {
        id: 101,
        username: "user1".to_string(),
        display_name: "User One".to_string(),
        role: "cashier".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };
    let user2 = omnibill_core::access::users::AuthenticatedUser {
        id: 102,
        username: "user2".to_string(),
        display_name: "User Two".to_string(),
        role: "cashier".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };

    let now_ms = 50_000_000i64;
    let tok1_a = session_mgr.open(&user1, now_ms).expect("tok1_a");
    let tok1_b = session_mgr.open(&user1, now_ms).expect("tok1_b");
    let tok2 = session_mgr.open(&user2, now_ms).expect("tok2");

    assert_eq!(session_mgr.active_count().expect("count"), 3);

    // Invalidate all sessions for User 1
    let closed = session_mgr
        .close_all_for_user(101)
        .expect("close all for user 1");
    assert_eq!(closed, 2);

    assert_eq!(
        session_mgr.validate(&tok1_a, now_ms),
        Err(SessionError::InvalidSession)
    );
    assert_eq!(
        session_mgr.validate(&tok1_b, now_ms),
        Err(SessionError::InvalidSession)
    );
    // User 2 remains valid
    assert!(session_mgr.validate(&tok2, now_ms).is_ok());
}

#[test]
fn test_role_governance_and_p8_protections() {
    let conn = setup_test_db();
    let session_mgr = SessionManager::new();
    let now_ms = 1_700_000_000_000i64;

    // 1. Create Primary Owner
    let owner_id = create_primary_owner(&conn, "owner_main", "Main Owner", "Tr0ub4dor&3x", now_ms)
        .expect("create primary owner");

    // 2. Primary owner creates co-owner
    let coowner_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "coowner_first".to_string(),
            display_name: "First CoOwner".to_string(),
            password: "Tr0ub4dor&3x".to_string(),
            role: "co_owner".to_string(),
        },
        "retail",
        now_ms,
    )
    .expect("primary owner creates co-owner");

    // 3. Co-owner cannot create another co-owner
    let err_second_co = create_user(
        &conn,
        coowner_id,
        CreateUserInput {
            username: "coowner_second".to_string(),
            display_name: "Second CoOwner".to_string(),
            password: "Tr0ub4dor&3x".to_string(),
            role: "co_owner".to_string(),
        },
        "retail",
        now_ms,
    );
    assert!(
        err_second_co.is_err(),
        "co-owner must not be allowed to create a co-owner"
    );

    // 4. Co-owner cannot deactivate primary owner (P8)
    let err_deact_owner = set_active(&conn, coowner_id, owner_id, false, now_ms, &session_mgr);
    assert_eq!(
        err_deact_owner.expect_err("co-owner deactivating owner must fail"),
        AuthError::CannotModifyPrimaryOwner
    );

    // 5. Co-owner cannot reset password of primary owner (P8)
    let err_reset_owner = admin_reset_password(
        &conn,
        coowner_id,
        owner_id,
        "NewSecret123!",
        now_ms,
        &session_mgr,
    );
    assert_eq!(
        err_reset_owner.expect_err("co-owner resetting owner password must fail"),
        AuthError::CannotModifyPrimaryOwner
    );

    // 6. Co-owner cannot demote primary owner (P8)
    let err_demote_owner = set_role(&conn, coowner_id, owner_id, "manager", "retail", now_ms);
    assert_eq!(
        err_demote_owner.expect_err("co-owner demoting owner must fail"),
        AuthError::CannotModifyPrimaryOwner
    );

    // 7. Role validity: cashier role in hospital vertical is rejected
    let err_invalid_role = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "cashier_hosp".to_string(),
            display_name: "Hosp Cashier".to_string(),
            password: "Tr0ub4dor&3x".to_string(),
            role: "cashier".to_string(),
        },
        "hospital",
        now_ms,
    );
    assert!(
        err_invalid_role.is_err(),
        "cashier role must be rejected for hospital vertical"
    );

    // Pharmacist in hospital vertical succeeds
    let pharm_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "pharm_hosp".to_string(),
            display_name: "Hosp Pharmacist".to_string(),
            password: "Tr0ub4dor&3x".to_string(),
            role: "pharmacist".to_string(),
        },
        "hospital",
        now_ms,
    )
    .expect("pharmacist in hospital vertical must succeed");
    assert!(pharm_id > 0);

    // 8. Primary owner CAN deactivate and reactivate the co-owner
    set_active(&conn, owner_id, coowner_id, false, now_ms, &session_mgr)
        .expect("primary owner can deactivate co-owner");

    // Deactivated co-owner cannot login
    let err_deact_login = authenticate(&conn, "coowner_first", "Tr0ub4dor&3x", now_ms);
    assert_eq!(
        err_deact_login.expect_err("deactivated user cannot login"),
        AuthError::InvalidCredentials
    );

    // Primary owner reactivates co-owner
    set_active(&conn, owner_id, coowner_id, true, now_ms, &session_mgr)
        .expect("primary owner can reactivate co-owner");
    assert!(authenticate(&conn, "coowner_first", "Tr0ub4dor&3x", now_ms).is_ok());

    // 9. Change password flow
    change_password(&conn, pharm_id, "Tr0ub4dor&3x", "NewPassword99!", now_ms)
        .expect("change password succeeds");
    assert!(authenticate(&conn, "pharm_hosp", "NewPassword99!", now_ms).is_ok());

    // 10. Admin reset password
    admin_reset_password(
        &conn,
        owner_id,
        pharm_id,
        "AdminResetP@ss1",
        now_ms,
        &session_mgr,
    )
    .expect("admin reset password succeeds");

    let auth_reset = authenticate(&conn, "pharm_hosp", "AdminResetP@ss1", now_ms)
        .expect("login with reset password succeeds");
    assert!(auth_reset.must_change_password);
}
