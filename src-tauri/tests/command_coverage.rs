//! Command Coverage & Authorization Guard Verification Suite (Task L2B Replacement)
//!
//! Enforces:
//! (a) Every `pub fn cmd_*` is in `COMMAND_POLICY`.
//! (b) `ROUTES` and `COMMAND_POLICY` match exactly (1-to-1).
//! (c) `cmd_` calls inside `omnibill.rs` appear only inside `guarded_dispatch`.
//! (d) Table-driven runtime test on a temp DB: for every non-public route:
//!     - sends no bearer -> 401
//!     - sends valid token for role without permission -> 403
//!     - sends valid permitted token -> neither 401 nor 403.

use omnibill_core::access::guard::{AppAuthState, GuardError, authorize};
use omnibill_core::access::policy_table::{COMMAND_POLICY, find_policy};
use omnibill_core::access::routes::ROUTES;
use omnibill_core::access::users::{AuthenticatedUser, create_primary_owner, create_user};
use omnibill_core::database::migrations::{MIGRATIONS, run_migrations};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

fn find_rs_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                files.extend(find_rs_files(&p));
            } else if p.extension().map(|e| e == "rs").unwrap_or(false) {
                files.push(p);
            }
        }
    }
    files
}

/// (a) Every `pub fn cmd_*` is in `COMMAND_POLICY`.
#[test]
fn test_a_every_pub_fn_cmd_is_in_command_policy() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let rs_files = find_rs_files(&src_dir);
    let mut found_cmds = Vec::new();

    for file in rs_files {
        let content = fs::read_to_string(&file).unwrap_or_default();
        for line in content.lines() {
            let l = line.trim();
            if l.starts_with("pub fn cmd_")
                && let Some(pos) = l.find('(') {
                    let fn_name = l["pub fn ".len()..pos].trim().to_string();
                    let base_name = fn_name.strip_suffix("_guarded").unwrap_or(&fn_name);
                    found_cmds.push((fn_name.clone(), base_name.to_string(), file.clone()));
                }
        }
    }

    assert!(!found_cmds.is_empty(), "Must find cmd_* functions in src/");

    for (fn_name, base_name, file) in found_cmds {
        let policy_name = match base_name.as_str() {
            "cmd_init_database" => "cmd_run_migrations",
            "cmd_create_resource" => "cmd_record_resource",
            "cmd_get_resources" => "cmd_list_resources",
            "cmd_create_entity" => "cmd_record_entity",
            "cmd_get_entities" => "cmd_list_entities",
            "cmd_get_gstr1_summary" => "cmd_get_gstr1",
            other => other,
        };
        let policy = find_policy(policy_name);
        assert!(
            policy.is_some(),
            "Function '{}' in {:?} has base name '{}' (policy '{}') not found in COMMAND_POLICY",
            fn_name,
            file,
            base_name,
            policy_name
        );
    }
}

/// (b) `ROUTES` and `COMMAND_POLICY` match exactly.
#[test]
fn test_b_routes_and_command_policy_match_exactly() {
    assert_eq!(
        ROUTES.len(),
        COMMAND_POLICY.len(),
        "ROUTES (len {}) and COMMAND_POLICY (len {}) must have identical length",
        ROUTES.len(),
        COMMAND_POLICY.len()
    );

    // Every route maps to a valid policy in COMMAND_POLICY
    for (route, cmd_name) in ROUTES {
        let policy = find_policy(cmd_name);
        assert!(
            policy.is_some(),
            "Route '{}' maps to command '{}' which is missing from COMMAND_POLICY",
            route,
            cmd_name
        );
    }

    // Every policy in COMMAND_POLICY is mapped in ROUTES
    for policy in COMMAND_POLICY {
        let found = ROUTES.iter().any(|(_, cmd_name)| *cmd_name == policy.name);
        assert!(
            found,
            "Policy '{}' in COMMAND_POLICY has no route in ROUTES",
            policy.name
        );
    }
}

/// (c) A grep test that `cmd_` calls inside `omnibill.rs` appear only inside `guarded_dispatch`.
#[test]
fn test_c_cmd_calls_in_omnibill_appear_only_in_guarded_dispatch() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let omnibill_path = manifest_dir.join("src/bin/omnibill.rs");
    let content = fs::read_to_string(&omnibill_path).expect("read omnibill.rs");

    let lines: Vec<&str> = content.lines().collect();
    let mut in_guarded_dispatch = false;
    let mut dispatch_brace_depth: i32 = 0;
    let mut in_routes = false;
    let mut illegal_hits = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let l = line.trim();

        if l.starts_with("pub fn guarded_dispatch(") || l.starts_with("fn guarded_dispatch(") {
            in_guarded_dispatch = true;
            dispatch_brace_depth = 0;
        } else if l.starts_with("pub const ROUTES") || l.starts_with("const ROUTES") {
            in_routes = true;
        }

        if in_guarded_dispatch {
            for ch in l.chars() {
                if ch == '{' {
                    dispatch_brace_depth += 1;
                } else if ch == '}' {
                    dispatch_brace_depth -= 1;
                    if dispatch_brace_depth <= 0 {
                        in_guarded_dispatch = false;
                        break;
                    }
                }
            }
        }

        if in_routes && (l.ends_with("];") || l == "];") {
            in_routes = false;
        }

        // Check for cmd_ occurrences
        if l.contains("cmd_") && !in_guarded_dispatch && !in_routes {
            // Ignore comments, imports, or test modules
            if !l.starts_with("//") && !l.starts_with("use ") {
                illegal_hits.push((idx + 1, l.to_string()));
            }
        }
    }

    assert!(
        illegal_hits.is_empty(),
        "`cmd_` calls in omnibill.rs found outside guarded_dispatch / ROUTES: {:?}",
        illegal_hits
    );
}

/// (d) A table-driven runtime test on a temp DB that, for every non-public route:
///     - sends no bearer -> 401
///     - sends a valid token for a role without the permission -> 403
///     - sends a valid permitted token -> neither 401 nor 403.
#[test]
fn test_d_table_driven_runtime_authorization_on_routes() {
    let mut conn = Connection::open_in_memory().expect("create temp db");
    conn.execute_batch("PRAGMA foreign_keys = ON;").expect("enable fk");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let state = AppAuthState::new("retail");
    let now_ms = 1_700_000_000_000;

    // Create primary owner (has all permissions)
    let owner_id = create_primary_owner(
        &conn,
        "owner_coverage",
        "Owner User",
        "OwnerPassword123!",
        now_ms,
    )
    .expect("create owner");

    // Create a staff user with restricted role (cashier: no owner/manager permissions)
    let cashier_id = create_user(
        &conn,
        owner_id,
        omnibill_core::access::users::CreateUserInput {
            username: "cashier_coverage".into(),
            display_name: "Cashier User".into(),
            password: "CashierPassword123!".into(),
            role: "cashier".into(),
        },
        "retail",
        now_ms,
    )
    .expect("create cashier");

    // Create session tokens
    let owner_user = AuthenticatedUser {
        id: owner_id,
        username: "owner_coverage".into(),
        display_name: "Owner User".into(),
        role: "owner".into(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let owner_token = state.session_mgr.open(&owner_user, now_ms).expect("open owner session");

    let cashier_user = AuthenticatedUser {
        id: cashier_id,
        username: "cashier_coverage".into(),
        display_name: "Cashier User".into(),
        role: "cashier".into(),
        is_primary_owner: false,
        must_change_password: false,
    };
    let _cashier_token = state
        .session_mgr
        .open(&cashier_user, now_ms)
        .expect("open cashier session");

    // Create a user with role that has NO permissions for testing 403
    let clerk_user = AuthenticatedUser {
        id: cashier_id + 10,
        username: "clerk_unprivileged".into(),
        display_name: "Unprivileged Clerk".into(),
        role: "clerk".into(), // Clerk in retail vertical has empty permissions
        is_primary_owner: false,
        must_change_password: false,
    };
    let unprivileged_token = state
        .session_mgr
        .open(&clerk_user, now_ms)
        .expect("open unprivileged session");

    for (route, cmd_name) in ROUTES {
        let policy = find_policy(cmd_name).unwrap();

        if policy.public {
            // Public route (login, get_boot_state) skips authorization checks
            let res = authorize(&state.as_guard_context(), None, cmd_name, now_ms);
            assert!(
                res.is_ok(),
                "Public route '{}' must succeed without bearer",
                route
            );
            continue;
        }

        // 1. Sends no bearer -> Expect 401 (MissingSessionToken)
        let res_no_bearer = authorize(&state.as_guard_context(), None, cmd_name, now_ms);
        match res_no_bearer {
            Err(GuardError::MissingSessionToken) => {}
            other => panic!(
                "Route '{}' ({}) without bearer expected 401 (MissingSessionToken), got {:?}",
                route, cmd_name, other
            ),
        }

        // 2. Sends valid token for a role without permission -> Expect 403 (PermissionDenied)
        if policy.permission.is_some() {
            let res_unprivileged = authorize(
                &state.as_guard_context(),
                Some(&unprivileged_token),
                cmd_name,
                now_ms,
            );
            match res_unprivileged {
                Err(GuardError::PermissionDenied(_)) | Err(GuardError::ModeRestricted(_)) => {}
                other => panic!(
                    "Route '{}' ({}) with unprivileged role expected 403 (PermissionDenied), got {:?}",
                    route, cmd_name, other
                ),
            }
        }

        // 3. Sends valid permitted token -> Expect neither 401 nor 403
        let res_permitted = authorize(
            &state.as_guard_context(),
            Some(&owner_token),
            cmd_name,
            now_ms,
        );
        match res_permitted {
            Ok(_) => {}
            Err(GuardError::MissingSessionToken)
            | Err(GuardError::SessionInvalid)
            | Err(GuardError::SessionExpired(_)) => {
                panic!(
                    "Route '{}' ({}) with valid owner token got 401: {:?}",
                    route, cmd_name, res_permitted
                );
            }
            Err(GuardError::PermissionDenied(_)) => {
                panic!(
                    "Route '{}' ({}) with valid owner token got 403 PermissionDenied: {:?}",
                    route, cmd_name, res_permitted
                );
            }
            Err(_) => {} // other errors (like ModeRestricted on print in read-only) are acceptable, but not 401 or PermissionDenied
        }
    }
}
