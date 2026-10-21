//! OmniBill Access Control, Authentication, and Licensing Subsystem.

pub mod audit;
pub mod guard;
pub mod password;
pub mod permissions;
pub mod policy;
pub mod policy_table;
pub mod roles;
pub mod session;
pub mod users;

pub use audit::{AuthAuditEvent, clear_audit_events, get_audit_events, record_auth_event};
pub use guard::{
    AuthContext, GuardContext, GuardError, LicenceFeatureProvider, MockAllFeaturesLicensed,
    MockAllModesAllowed, MockNoFeaturesLicensed, ModeAllowsProvider, authorize,
};
pub use password::{PasswordError, check_strength, hash_password, verify_password};
pub use permissions::Permission;
pub use policy::*;
pub use policy_table::{COMMAND_POLICY, CommandPolicy, Feature, find_policy};
pub use roles::{ALL_PERMISSIONS, Role, default_permissions};
pub use session::{Session, SessionError, SessionManager, hash_token};
pub use users::{
    AuthError, AuthenticatedUser, CreateUserInput, UserRecord, admin_reset_password, authenticate,
    change_password, create_primary_owner, create_user, list_users, set_active, set_role,
};
