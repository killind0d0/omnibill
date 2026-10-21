//! OmniBill Access Control, Authentication, and Licensing Subsystem.

pub mod audit;
pub mod civil;
pub mod clock_guard;
pub mod commands;
pub mod commands_roles;
pub mod dbkey;
pub mod dbopen;
pub mod escrow;
pub mod guard;
pub mod licence;
pub mod licence_store;
pub mod password;
pub mod permissions;
pub mod policy;
pub mod policy_table;
pub mod role_perms;
pub mod roles;
pub mod routes;
pub mod session;
pub mod users;

pub use audit::{AuthAuditEvent, clear_audit_events, get_audit_events, record_auth_event};
pub use civil::{IST_OFFSET_MS, civil_from_days, days_from_civil, ist_day};
pub use clock_guard::advance_max_seen;
pub use guard::{
    AppAuthState, AuthContext, GuardContext, GuardError, LicenceFeatureProvider,
    MockAllFeaturesLicensed, MockAllModesAllowed, MockNoFeaturesLicensed, ModeAllowsProvider,
    RealLicenceModeProvider, StaticModeProvider, authorize, guard_command,
};
pub use licence::{
    Licence, LicenceError, LicencePayload, Mode, ModeInputs, Reason, compute_mode,
    compute_mode_default, export_allowed, parse_verifying_key, print_allowed, vendor_key,
};
pub use password::{PasswordError, check_strength, hash_password, verify_password};
pub use permissions::Permission;
pub use policy::*;
pub use policy_table::{COMMAND_POLICY, CommandPolicy, Feature, find_policy};
pub use role_perms::{
    DANGEROUS, OWNER_ONLY_LOCKED, RolePermError, RolePermissionItem, clear_cache,
    effective_permissions as effective_role_permissions, get_role_permissions_impl,
    is_role_editable, reset_role_permissions_impl, set_role_permission_impl,
};
pub use roles::{ALL_PERMISSIONS, Role, default_permissions};
pub use routes::ROUTES;
pub use session::{Session, SessionError, SessionManager, hash_token};
pub use users::{
    AuthError, AuthenticatedUser, CreateUserInput, UserRecord, admin_reset_password, authenticate,
    change_password, create_primary_owner, create_user, list_users, set_active, set_role,
};
