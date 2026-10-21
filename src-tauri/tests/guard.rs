use omnibill_core::access::guard::{
    GuardContext, GuardError, MockAllFeaturesLicensed, MockAllModesAllowed, MockNoFeaturesLicensed,
    ModeAllowsProvider, authorize,
};
use omnibill_core::access::policy_table::{COMMAND_POLICY, Feature};
use omnibill_core::access::roles::{Role, default_permissions};
use omnibill_core::access::session::SessionManager;
use omnibill_core::access::users::AuthenticatedUser;

struct RestrictiveMode {
    allow_write: bool,
    allow_export: bool,
    allow_print: bool,
}

impl ModeAllowsProvider for RestrictiveMode {
    fn mode_allows(&self, write: bool, export: bool, print: bool) -> bool {
        if write && !self.allow_write {
            return false;
        }
        if export && !self.allow_export {
            return false;
        }
        if print && !self.allow_print {
            return false;
        }
        true
    }
}

#[test]
fn test_guard_table_driven_all_roles_all_commands() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let roles_and_verticals = [
        (Role::Owner, "retail"),
        (Role::Owner, "wholesale"),
        (Role::Owner, "hospital"),
        (Role::Owner, "school"),
        (Role::CoOwner, "retail"),
        (Role::Manager, "retail"),
        (Role::Manager, "hospital"),
        (Role::Cashier, "retail"),
        (Role::StockClerk, "wholesale"),
        (Role::Accountant, "hospital"),
        (Role::Pharmacist, "hospital"),
        (Role::FrontDesk, "hospital"),
        (Role::LabTech, "hospital"),
        (Role::Bursar, "school"),
        (Role::Clerk, "school"),
    ];

    for (role, vertical) in roles_and_verticals {
        let user = AuthenticatedUser {
            id: 100,
            username: format!("user_{}", role.as_str()),
            display_name: format!("User {}", role.as_str()),
            role: role.as_str().to_string(),
            is_primary_owner: role == Role::Owner,
            must_change_password: false,
        };

        let token = session_mgr.open(&user, now_ms).expect("open session");
        let ctx = GuardContext {
            session_mgr: &session_mgr,
            vertical,
            licence: &licence,
            mode: &mode,
        };

        let granted = default_permissions(role, vertical);

        for policy in COMMAND_POLICY {
            let res = authorize(&ctx, Some(&token), policy.name, now_ms);

            if policy.public {
                assert!(
                    res.is_ok(),
                    "public command {} must succeed for all",
                    policy.name
                );
                continue;
            }

            match policy.permission {
                None => {
                    // Command requires no specific permission (e.g. get_schema_version, logout)
                    assert!(
                        res.is_ok(),
                        "permissionless command {} must succeed for {}",
                        policy.name,
                        role.as_str()
                    );
                }
                Some(required_perm) => {
                    if granted.contains(&required_perm) {
                        assert!(
                            res.is_ok(),
                            "role {} in {} should be granted {} (required {:?}) but got {:?}",
                            role.as_str(),
                            vertical,
                            policy.name,
                            required_perm,
                            res
                        );
                    } else {
                        match res {
                            Err(GuardError::PermissionDenied(p)) => {
                                assert_eq!(p, required_perm);
                            }
                            other => panic!(
                                "role {} in {} should be denied {} with PermissionDenied, got {:?}",
                                role.as_str(),
                                vertical,
                                policy.name,
                                other
                            ),
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn test_guard_unknown_command_fails_closed() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    let user = AuthenticatedUser {
        id: 1,
        username: "admin".to_string(),
        display_name: "Admin".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = session_mgr.open(&user, now_ms).expect("open session");

    let err = authorize(&ctx, Some(&token), "cmd_invented_backdoor", now_ms)
        .expect_err("unknown command must fail closed");
    assert_eq!(
        err,
        GuardError::UnknownCommand("cmd_invented_backdoor".into())
    );
}

#[test]
fn test_guard_public_commands_bypass_session() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    // login without token succeeds
    let auth_login = authorize(&ctx, None, "login", now_ms).expect("login is public");
    assert!(auth_login.is_public);

    // get_boot_state without token succeeds
    let auth_boot = authorize(&ctx, None, "get_boot_state", now_ms).expect("boot state is public");
    assert!(auth_boot.is_public);
}

#[test]
fn test_guard_session_expiration_and_invalidation() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let t0 = 10_000_000i64;

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    let user = AuthenticatedUser {
        id: 12,
        username: "cashier1".to_string(),
        display_name: "Cashier One".to_string(),
        role: "cashier".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };

    let token = session_mgr.open(&user, t0).expect("open session");

    // Valid immediately
    assert!(authorize(&ctx, Some(&token), "cmd_post_sale", t0).is_ok());

    // Expired after 15m 1s of inactivity
    let t_expired = t0 + 15 * 60_000 + 1_000;
    let err_exp = authorize(&ctx, Some(&token), "cmd_post_sale", t_expired)
        .expect_err("expired session must fail");
    assert!(matches!(err_exp, GuardError::SessionExpired(_)));

    // Invalidation via close_all_for_user
    let token2 = session_mgr.open(&user, t0).expect("open token2");
    assert!(authorize(&ctx, Some(&token2), "cmd_post_sale", t0).is_ok());

    session_mgr.close_all_for_user(12).expect("close all");
    let err_inv =
        authorize(&ctx, Some(&token2), "cmd_post_sale", t0).expect_err("closed session must fail");
    assert_eq!(err_inv, GuardError::SessionInvalid);
}

#[test]
fn test_guard_must_change_password_restricted_to_two_commands() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    let user = AuthenticatedUser {
        id: 99,
        username: "temp_user".to_string(),
        display_name: "Temp User".to_string(),
        role: "manager".to_string(),
        is_primary_owner: false,
        must_change_password: true,
    };

    let token = session_mgr.open(&user, now_ms).expect("open session");

    // Allowed commands: change_password, logout
    assert!(authorize(&ctx, Some(&token), "change_password", now_ms).is_ok());
    assert!(authorize(&ctx, Some(&token), "logout", now_ms).is_ok());

    // All other commands are strictly blocked
    let err_post = authorize(&ctx, Some(&token), "cmd_post_sale", now_ms)
        .expect_err("blocked by must_change_password");
    assert_eq!(err_post, GuardError::MustChangePassword);

    let err_list = authorize(&ctx, Some(&token), "cmd_list_resources", now_ms)
        .expect_err("blocked by must_change_password");
    assert_eq!(err_list, GuardError::MustChangePassword);
}

#[test]
fn test_guard_cashier_prohibited_commands() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    let cashier = AuthenticatedUser {
        id: 7,
        username: "cashier_sam".to_string(),
        display_name: "Sam Cashier".to_string(),
        role: "cashier".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };
    let token = session_mgr.open(&cashier, now_ms).expect("open token");

    // Cashier cannot call reports_financial
    assert_eq!(
        authorize(&ctx, Some(&token), "cmd_get_trial_balance", now_ms),
        Err(GuardError::PermissionDenied(
            omnibill_core::access::Permission::ReportsFinancial
        ))
    );

    // Cashier cannot call export_data
    assert_eq!(
        authorize(&ctx, Some(&token), "cmd_export_discovery", now_ms),
        Err(GuardError::PermissionDenied(
            omnibill_core::access::Permission::ExportData
        ))
    );

    // Cashier cannot call settings_manage / rebuild_analytics
    assert_eq!(
        authorize(&ctx, Some(&token), "cmd_rebuild_analytics", now_ms),
        Err(GuardError::PermissionDenied(
            omnibill_core::access::Permission::SettingsManage
        ))
    );
}

#[test]
fn test_guard_vertical_mismatch_denied() {
    let session_mgr = SessionManager::new();
    let licence = MockAllFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    // Pharmacist in retail vertical gets empty permissions
    let ctx = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &licence,
        mode: &mode,
    };

    let pharm = AuthenticatedUser {
        id: 8,
        username: "dr_pharma".to_string(),
        display_name: "Dr Pharma".to_string(),
        role: "pharmacist".to_string(),
        is_primary_owner: false,
        must_change_password: false,
    };
    let token = session_mgr.open(&pharm, now_ms).expect("open token");

    // Even products_view is denied because the role itself is invalid for the vertical
    let err = authorize(&ctx, Some(&token), "cmd_list_resources", now_ms)
        .expect_err("hospital role in retail vertical must be denied");
    assert_eq!(
        err,
        GuardError::PermissionDenied(omnibill_core::access::Permission::ProductsView)
    );
}

#[test]
fn test_guard_unlicensed_feature_and_mode_restrictions() {
    let session_mgr = SessionManager::new();
    let no_licence = MockNoFeaturesLicensed;
    let mode = MockAllModesAllowed;
    let now_ms = 1_700_000_000_000i64;

    let user = AuthenticatedUser {
        id: 1,
        username: "owner".to_string(),
        display_name: "Owner".to_string(),
        role: "owner".to_string(),
        is_primary_owner: true,
        must_change_password: false,
    };
    let token = session_mgr.open(&user, now_ms).expect("open token");

    // 1. Unlicensed feature
    let ctx_unlicensed = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &no_licence,
        mode: &mode,
    };
    let err_feat = authorize(
        &ctx_unlicensed,
        Some(&token),
        "cmd_discover_products",
        now_ms,
    )
    .expect_err("unlicensed feature must be denied");
    assert_eq!(
        err_feat,
        GuardError::FeatureNotLicensed(Feature::DiscoveryHub)
    );

    // 2. Restricted mode: read-only blocks writes
    let read_only_mode = RestrictiveMode {
        allow_write: false,
        allow_export: true,
        allow_print: true,
    };
    let full_licence = MockAllFeaturesLicensed;
    let ctx_readonly = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &full_licence,
        mode: &read_only_mode,
    };
    let err_write = authorize(&ctx_readonly, Some(&token), "cmd_post_sale", now_ms)
        .expect_err("write in read-only mode must be blocked");
    assert!(matches!(err_write, GuardError::ModeRestricted(_)));

    // 3. Restricted mode: no-export blocks export
    let no_export_mode = RestrictiveMode {
        allow_write: true,
        allow_export: false,
        allow_print: true,
    };
    let ctx_no_export = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &full_licence,
        mode: &no_export_mode,
    };
    let err_export = authorize(&ctx_no_export, Some(&token), "cmd_export_discovery", now_ms)
        .expect_err("export in no-export mode must be blocked");
    assert!(matches!(err_export, GuardError::ModeRestricted(_)));

    // 4. Restricted mode: no-print blocks print
    let no_print_mode = RestrictiveMode {
        allow_write: true,
        allow_export: true,
        allow_print: false,
    };
    let ctx_no_print = GuardContext {
        session_mgr: &session_mgr,
        vertical: "retail",
        licence: &full_licence,
        mode: &no_print_mode,
    };
    let err_print = authorize(&ctx_no_print, Some(&token), "cmd_print_receipt", now_ms)
        .expect_err("print in no-print mode must be blocked");
    assert!(matches!(err_print, GuardError::ModeRestricted(_)));
}
