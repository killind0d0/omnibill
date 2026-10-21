//! Owner-Editable Role Permissions Verification Suite (Task L2C)
//!
//! Verifies:
//! 1. Defaults unchanged when no override rows exist in DB.
//! 2. Granting `sales_cancel` to cashier (with confirm=true) permits cancellation; revoking blocks on next call.
//! 3. Granting dangerous permission without confirm=true is rejected.
//! 4. Granting `OWNER_ONLY_LOCKED` (users_manage, settings_manage, backup_restore) to manager is rejected.
//! 5. Vertical mismatch permission (e.g., hospital permission in retail) is rejected.
//! 6. Attempting to edit or reset `owner` or `co_owner` permissions is rejected.
//! 7. Non-manager/owner role (e.g. cashier) calling `set_role_permission` is denied with permission error.
//! 8. `reset_role_permissions` clears all overrides and restores defaults.
//! 9. Audit event `auth.role_permission_changed` correctly captures role, permission, before, and after.
//! 10. Cache invalidation is proven: permission changes take effect immediately for other sessions of that role.

use omnibill_core::access::audit::{clear_audit_events, get_audit_events};
use omnibill_core::access::commands_roles::{
    get_role_permissions, reset_role_permissions, set_role_permission,
};
use omnibill_core::access::guard::{AppAuthState, GuardError, authorize};
use omnibill_core::access::permissions::Permission;
use omnibill_core::access::role_perms::{DANGEROUS, OWNER_ONLY_LOCKED, clear_cache};
use omnibill_core::access::roles::{Role, default_permissions};
use omnibill_core::access::users::{
    AuthenticatedUser, CreateUserInput, create_primary_owner, create_user,
};
use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use rusqlite::Connection;
use std::sync::Mutex;

static TEST_MUTEX: Mutex<()> = Mutex::new(());

fn setup_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");
    clear_audit_events();
    clear_cache();
    conn
}

fn make_auth_user(
    id: i64,
    username: &str,
    role: &str,
    is_primary_owner: bool,
) -> AuthenticatedUser {
    AuthenticatedUser {
        id,
        username: username.to_string(),
        display_name: username.to_string(),
        role: role.to_string(),
        is_primary_owner,
        must_change_password: false,
    }
}

#[test]
fn test_defaults_unchanged_when_no_rows() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner1", "Owner 1", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner1", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    let items = get_role_permissions(&state, &conn, Some(&owner_tok), "cashier", now_ms)
        .expect("get cashier perms");

    let defaults = default_permissions(Role::Cashier, "retail");

    for item in items {
        let should_be_default = defaults.contains(&item.permission);
        assert_eq!(
            item.is_default, should_be_default,
            "Perm {:?} is_default mismatch",
            item.permission
        );
        assert_eq!(
            item.granted, should_be_default,
            "Perm {:?} granted mismatch on clean db",
            item.permission
        );
        assert_eq!(
            item.locked,
            OWNER_ONLY_LOCKED.contains(&item.permission),
            "Perm {:?} locked mismatch",
            item.permission
        );
        assert_eq!(
            item.dangerous,
            DANGEROUS.contains(&item.permission),
            "Perm {:?} dangerous mismatch",
            item.permission
        );
    }
}

#[test]
fn test_dangerous_permission_without_confirm_rejected() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner2", "Owner 2", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner2", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    // Attempting to grant sales_cancel without confirm: true must fail
    let err = set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        true,
        false, // confirm = false
        now_ms,
    );

    assert!(
        err.is_err(),
        "Granting dangerous perm without confirm must fail"
    );
    let msg = err.unwrap_err();
    assert!(
        msg.contains("confirm=true"),
        "Error message should mention confirm=true, got: {}",
        msg
    );
}

#[test]
fn test_granting_sales_cancel_with_confirm_and_revoking() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner3", "Owner 3", "SecretOwner123!", now_ms)
        .expect("create owner");

    let cashier_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "cashier3".to_string(),
            display_name: "Cashier 3".to_string(),
            password: "SecretCashier123!".to_string(),
            role: "cashier".to_string(),
        },
        "retail",
        now_ms,
    )
    .expect("create cashier");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner3", "owner", true);
    let cashier_user = make_auth_user(cashier_id, "cashier3", "cashier", false);

    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");
    let cashier_tok = state
        .session_mgr
        .open(&cashier_user, now_ms)
        .expect("cashier session");

    // 1. Initially, cashier cannot cancel sales
    let auth_initial = authorize(
        &state.as_guard_context(),
        Some(&cashier_tok),
        "cmd_post_sale_return",
        now_ms,
    );
    match auth_initial {
        Err(GuardError::PermissionDenied(_)) => {}
        other => panic!("Expected PermissionDenied initially, got {:?}", other),
    }

    // 2. Owner grants sales_cancel to cashier role with confirm: true
    set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        true,
        true, // confirm = true
        now_ms,
    )
    .expect("grant sales_cancel");

    // 3. Immediately on next call (same open session), cashier is allowed to cancel sale
    let auth_after_grant = authorize(
        &state.as_guard_context(),
        Some(&cashier_tok),
        "cmd_post_sale_return",
        now_ms + 100,
    );
    assert!(
        auth_after_grant.is_ok(),
        "Cashier should now be authorized to cancel sale"
    );

    // 4. Owner revokes sales_cancel
    set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        false,
        false,
        now_ms + 200,
    )
    .expect("revoke sales_cancel");

    // 5. Cashier is immediately blocked again on next call
    let auth_after_revoke = authorize(
        &state.as_guard_context(),
        Some(&cashier_tok),
        "cmd_post_sale_return",
        now_ms + 300,
    );
    match auth_after_revoke {
        Err(GuardError::PermissionDenied(_)) => {}
        other => panic!("Expected PermissionDenied after revoke, got {:?}", other),
    }
}

#[test]
fn test_cache_invalidation_proven_across_different_users_same_role() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner4", "Owner 4", "SecretOwner123!", now_ms)
        .expect("create owner");

    let cashier1_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "cashier4a".to_string(),
            display_name: "Cashier 4A".to_string(),
            password: "SecretCashier123!".to_string(),
            role: "cashier".to_string(),
        },
        "retail",
        now_ms,
    )
    .expect("create cashier 1");

    let cashier2_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "cashier4b".to_string(),
            display_name: "Cashier 4B".to_string(),
            password: "SecretCashier123!".to_string(),
            role: "cashier".to_string(),
        },
        "retail",
        now_ms,
    )
    .expect("create cashier 2");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner4", "owner", true);
    let cashier1_user = make_auth_user(cashier1_id, "cashier4a", "cashier", false);
    let cashier2_user = make_auth_user(cashier2_id, "cashier4b", "cashier", false);

    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");
    let cashier1_tok = state
        .session_mgr
        .open(&cashier1_user, now_ms)
        .expect("cashier 1 session");
    let cashier2_tok = state
        .session_mgr
        .open(&cashier2_user, now_ms)
        .expect("cashier 2 session");

    // Both cashiers initially denied
    assert!(
        authorize(
            &state.as_guard_context(),
            Some(&cashier1_tok),
            "cmd_post_sale_return",
            now_ms
        )
        .is_err()
    );
    assert!(
        authorize(
            &state.as_guard_context(),
            Some(&cashier2_tok),
            "cmd_post_sale_return",
            now_ms
        )
        .is_err()
    );

    // Owner grants sales_cancel
    set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        true,
        true,
        now_ms,
    )
    .expect("grant sales_cancel");

    // Cashier 2 (without logging out or restarting) calls command: immediately permitted
    let res2 = authorize(
        &state.as_guard_context(),
        Some(&cashier2_tok),
        "cmd_post_sale_return",
        now_ms + 50,
    );
    assert!(
        res2.is_ok(),
        "Cashier 2 must immediately have access after cache update"
    );
}

#[test]
fn test_owner_only_locked_permissions_cannot_be_granted() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner5", "Owner 5", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner5", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    // users_manage, settings_manage, backup_restore cannot be granted to manager or cashier
    for perm_name in &["users_manage", "settings_manage", "backup_restore"] {
        let err = set_role_permission(
            &state,
            &conn,
            Some(&owner_tok),
            "manager",
            perm_name,
            true,
            true,
            now_ms,
        );
        assert!(
            err.is_err(),
            "Must reject granting {} to manager",
            perm_name
        );
        let msg = err.unwrap_err();
        assert!(
            msg.contains("owner-only"),
            "Expected owner-only error message: {}",
            msg
        );
    }
}

#[test]
fn test_vertical_mismatch_permission_rejected() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner6", "Owner 6", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner6", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    // Hospital permission in retail vertical
    let err_hosp = set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "hospital_clinical",
        true,
        true,
        now_ms,
    );
    assert!(
        err_hosp.is_err(),
        "Hospital perm in retail vertical must fail"
    );
    assert!(err_hosp.unwrap_err().contains("not valid for vertical"));

    // School permission in retail vertical
    let err_school = set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "school_fees_collect",
        true,
        true,
        now_ms,
    );
    assert!(
        err_school.is_err(),
        "School perm in retail vertical must fail"
    );
    assert!(err_school.unwrap_err().contains("not valid for vertical"));
}

#[test]
fn test_editing_owner_or_co_owner_rejected() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner7", "Owner 7", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner7", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    // Querying owner permissions is rejected
    assert!(get_role_permissions(&state, &conn, Some(&owner_tok), "owner", now_ms).is_err());
    assert!(get_role_permissions(&state, &conn, Some(&owner_tok), "co_owner", now_ms).is_err());

    // Setting owner permissions is rejected
    assert!(
        set_role_permission(
            &state,
            &conn,
            Some(&owner_tok),
            "owner",
            "sales_cancel",
            false,
            false,
            now_ms
        )
        .is_err()
    );

    assert!(
        set_role_permission(
            &state,
            &conn,
            Some(&owner_tok),
            "co_owner",
            "sales_cancel",
            false,
            false,
            now_ms
        )
        .is_err()
    );

    // Resetting owner permissions is rejected
    assert!(reset_role_permissions(&state, &conn, Some(&owner_tok), "owner", now_ms).is_err());
    assert!(reset_role_permissions(&state, &conn, Some(&owner_tok), "co_owner", now_ms).is_err());
}

#[test]
fn test_cashier_calling_set_role_permission_denied() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner8", "Owner 8", "SecretOwner123!", now_ms)
        .expect("create owner");

    let cashier_id = create_user(
        &conn,
        owner_id,
        CreateUserInput {
            username: "cashier8".to_string(),
            display_name: "Cashier 8".to_string(),
            password: "SecretCashier123!".to_string(),
            role: "cashier".to_string(),
        },
        "retail",
        now_ms,
    )
    .expect("create cashier");

    let state = AppAuthState::new("retail");
    let cashier_user = make_auth_user(cashier_id, "cashier8", "cashier", false);
    let cashier_tok = state
        .session_mgr
        .open(&cashier_user, now_ms)
        .expect("cashier session");

    // Cashier attempts to call set_role_permission
    let err = set_role_permission(
        &state,
        &conn,
        Some(&cashier_tok),
        "cashier",
        "sales_cancel",
        true,
        true,
        now_ms,
    );

    assert!(
        err.is_err(),
        "Cashier must be denied calling set_role_permission"
    );
    let msg = err.unwrap_err();
    assert!(
        msg.contains("Permission denied") || msg.contains("Not allowed"),
        "Expected permission denial, got: {}",
        msg
    );
}

#[test]
fn test_reset_role_permissions_restores_defaults() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner9", "Owner 9", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner9", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    // Grant sales_cancel to cashier
    set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        true,
        true,
        now_ms,
    )
    .expect("grant sales_cancel");

    // Verify it is granted
    let items_modified = get_role_permissions(&state, &conn, Some(&owner_tok), "cashier", now_ms)
        .expect("get perms");
    let cancel_item = items_modified
        .iter()
        .find(|i| i.permission == Permission::SalesCancel)
        .unwrap();
    assert!(cancel_item.granted);

    // Reset to defaults
    reset_role_permissions(&state, &conn, Some(&owner_tok), "cashier", now_ms + 100)
        .expect("reset perms");

    // Verify it is restored to default (false)
    let items_reset =
        get_role_permissions(&state, &conn, Some(&owner_tok), "cashier", now_ms + 200)
            .expect("get perms");
    let cancel_item_reset = items_reset
        .iter()
        .find(|i| i.permission == Permission::SalesCancel)
        .unwrap();
    assert!(!cancel_item_reset.granted);
}

#[test]
fn test_audit_entry_records_correct_before_and_after() {
    let _lock = TEST_MUTEX.lock().unwrap();
    let conn = setup_db();
    let now_ms = 1_700_000_000_000;

    let owner_id = create_primary_owner(&conn, "owner10", "Owner 10", "SecretOwner123!", now_ms)
        .expect("create owner");

    let state = AppAuthState::new("retail");
    let owner_user = make_auth_user(owner_id, "owner10", "owner", true);
    let owner_tok = state
        .session_mgr
        .open(&owner_user, now_ms)
        .expect("owner session");

    clear_audit_events();

    // Grant sales_cancel (before: false, after: true)
    set_role_permission(
        &state,
        &conn,
        Some(&owner_tok),
        "cashier",
        "sales_cancel",
        true,
        true,
        now_ms,
    )
    .expect("grant sales_cancel");

    let events = get_audit_events();
    let change_event = events
        .iter()
        .find(|e| e.event_type == "auth.role_permission_changed")
        .expect("audit event found");

    assert_eq!(change_event.username, "cashier");
    assert!(change_event.detail.contains("before=false"));
    assert!(change_event.detail.contains("after=true"));
    assert!(change_event.detail.contains("permission=sales_cancel"));
}
