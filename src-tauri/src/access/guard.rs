//! Access Guard for OmniBill.
//!
//! Intercepts every command invocation and strictly enforces:
//! 1. Command registration in COMMAND_POLICY (fails closed on unknown commands)
//! 2. Public bypass for unauthenticated entry points (login, get_boot_state)
//! 3. Active session validation (rejects missing, invalid, idle-expired, or absolute-expired sessions)
//! 4. Active user status & mandatory password change restriction (only change_password and logout permitted)
//! 5. Role permissions (via effective_permissions, defaulting to role default_permissions)
//! 6. Plan feature flag licensing
//! 7. Operational mode (read-only / no-export / no-print)
//!
//! Denials are rate-limited to at most 1 audit event per (user, command) per minute.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use super::audit::record_auth_event;
use super::permissions::Permission;
use super::policy_table::{Feature, find_policy};
use super::roles::Role;
use super::session::{SessionError, SessionManager};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthContext {
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub is_primary_owner: bool,
    pub is_public: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardError {
    UnknownCommand(String),
    MissingSessionToken,
    SessionInvalid,
    SessionExpired(String),
    UserInactive,
    MustChangePassword,
    PermissionDenied(Permission),
    FeatureNotLicensed(Feature),
    ModeRestricted(String),
    LockError,
}

impl fmt::Display for GuardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GuardError::UnknownCommand(cmd) => write!(f, "Unknown command '{}'", cmd),
            GuardError::MissingSessionToken => write!(f, "Missing session authentication token"),
            GuardError::SessionInvalid => write!(f, "Invalid session token"),
            GuardError::SessionExpired(msg) => write!(f, "Session expired: {}", msg),
            GuardError::UserInactive => write!(f, "User account is deactivated"),
            GuardError::MustChangePassword => write!(
                f,
                "Password change required before accessing other commands"
            ),
            GuardError::PermissionDenied(perm) => {
                write!(f, "Permission denied: requires '{:?}'", perm)
            }
            GuardError::FeatureNotLicensed(feat) => {
                write!(f, "Feature '{:?}' is not included in current plan", feat)
            }
            GuardError::ModeRestricted(msg) => write!(f, "Operation blocked by mode: {}", msg),
            GuardError::LockError => write!(f, "Internal guard lock contention error"),
        }
    }
}

impl std::error::Error for GuardError {}

pub trait LicenceFeatureProvider: Send + Sync {
    fn has_feature(&self, feature: Feature) -> bool;
}

pub struct MockAllFeaturesLicensed;
impl LicenceFeatureProvider for MockAllFeaturesLicensed {
    fn has_feature(&self, _feature: Feature) -> bool {
        true
    }
}

pub struct MockNoFeaturesLicensed;
impl LicenceFeatureProvider for MockNoFeaturesLicensed {
    fn has_feature(&self, _feature: Feature) -> bool {
        false
    }
}

pub trait ModeAllowsProvider: Send + Sync {
    fn mode_allows(&self, write: bool, export: bool, print: bool) -> bool;
}

pub struct MockAllModesAllowed;
impl ModeAllowsProvider for MockAllModesAllowed {
    fn mode_allows(&self, _write: bool, _export: bool, _print: bool) -> bool {
        true
    }
}

pub struct GuardContext<'a> {
    pub session_mgr: &'a SessionManager,
    pub vertical: &'a str,
    pub licence: &'a dyn LicenceFeatureProvider,
    pub mode: &'a dyn ModeAllowsProvider,
}

pub struct AppAuthState {
    pub session_mgr: SessionManager,
    pub vertical: String,
    pub licence: Box<dyn LicenceFeatureProvider>,
    pub mode: Box<dyn ModeAllowsProvider>,
}

impl AppAuthState {
    pub fn new(vertical: &str) -> Self {
        Self {
            session_mgr: SessionManager::new(),
            vertical: vertical.to_string(),
            licence: Box::new(MockAllFeaturesLicensed),
            mode: Box::new(MockAllModesAllowed),
        }
    }

    pub fn as_guard_context(&self) -> GuardContext<'_> {
        GuardContext {
            session_mgr: &self.session_mgr,
            vertical: &self.vertical,
            licence: self.licence.as_ref(),
            mode: self.mode.as_ref(),
        }
    }
}

impl From<GuardError> for String {
    fn from(err: GuardError) -> Self {
        match err {
            GuardError::PermissionDenied(_) => "Not allowed".to_string(),
            GuardError::SessionExpired(_) => "Session expired".to_string(),
            GuardError::FeatureNotLicensed(_) => "Licence required".to_string(),
            GuardError::ModeRestricted(msg) => format!("Mode restricted: {}", msg),
            GuardError::MustChangePassword => "Password change required".to_string(),
            GuardError::UnknownCommand(cmd) => format!("Unknown command '{}'", cmd),
            GuardError::MissingSessionToken | GuardError::SessionInvalid => {
                "Invalid or missing session token".to_string()
            }
            GuardError::UserInactive => "User account is deactivated".to_string(),
            GuardError::LockError => "Internal server error".to_string(),
        }
    }
}

pub fn guard_command(
    state: &AppAuthState,
    token: Option<&str>,
    cmd: &str,
    now_ms: i64,
) -> Result<AuthContext, String> {
    authorize(&state.as_guard_context(), token, cmd, now_ms).map_err(Into::into)
}

static DENIAL_AUDIT_LOG: Mutex<Option<HashMap<(String, String), i64>>> = Mutex::new(None);

fn audit_denial(user_or_token: &str, cmd: &str, reason: &str, now_ms: i64) {
    let key = (user_or_token.to_string(), cmd.to_string());
    let mut lock = match DENIAL_AUDIT_LOG.lock() {
        Ok(l) => l,
        Err(_) => return,
    };

    let map = lock.get_or_insert_with(HashMap::new);
    if let Some(&last_ms) = map.get(&key)
        && now_ms.saturating_sub(last_ms) < 60_000
    {
        return; // Rate limit: at most 1 audit per user+command per minute
    }

    map.insert(key, now_ms);
    record_auth_event(
        None,
        now_ms,
        "auth.denied",
        user_or_token,
        &format!("Command '{}' denied: {}", cmd, reason),
    );
}

/// Resolves effective permissions for a role in a vertical.
/// Overridden by role_permissions table in Task L2C.
pub fn effective_permissions(role: Role, vertical: &str) -> Vec<Permission> {
    super::role_perms::effective_permissions(None, role, vertical)
}

/// Main authorization guard for all incoming command requests.
/// Enforces all 7 stages in exact sequential order.
pub fn authorize(
    ctx: &GuardContext<'_>,
    token: Option<&str>,
    cmd: &str,
    now_ms: i64,
) -> Result<AuthContext, GuardError> {
    // 1. Command must exist in COMMAND_POLICY (fail closed)
    let policy = match find_policy(cmd) {
        Some(p) => p,
        None => {
            audit_denial(token.unwrap_or("anon"), cmd, "unknown command", now_ms);
            return Err(GuardError::UnknownCommand(cmd.to_string()));
        }
    };

    // 2. Public commands return early without requiring session
    if policy.public {
        return Ok(AuthContext {
            user_id: None,
            username: None,
            display_name: None,
            role: None,
            is_primary_owner: false,
            is_public: true,
        });
    }

    // 3. Validate session token
    let token_str = match token {
        Some(t) if !t.is_empty() => t,
        _ => {
            audit_denial("missing_token", cmd, "missing session token", now_ms);
            return Err(GuardError::MissingSessionToken);
        }
    };

    let session = match ctx.session_mgr.validate(token_str, now_ms) {
        Ok(s) => s,
        Err(SessionError::IdleTimeout) => {
            audit_denial("expired_token", cmd, "session idle timeout", now_ms);
            return Err(GuardError::SessionExpired("Idle timeout".into()));
        }
        Err(SessionError::AbsoluteTimeout) => {
            audit_denial(
                "expired_token",
                cmd,
                "session absolute lifetime expired",
                now_ms,
            );
            return Err(GuardError::SessionExpired(
                "Absolute lifetime expired".into(),
            ));
        }
        Err(_) => {
            audit_denial("invalid_token", cmd, "invalid session token", now_ms);
            return Err(GuardError::SessionInvalid);
        }
    };

    // 4. User active & must_change_password enforcement
    // (If user must change password, only change_password and logout are allowed)
    if session.must_change_password {
        let is_allowed = cmd == "change_password"
            || cmd == "logout"
            || cmd == "cmd_change_password"
            || cmd == "cmd_logout";
        if !is_allowed {
            audit_denial(&session.username, cmd, "must change password first", now_ms);
            return Err(GuardError::MustChangePassword);
        }
    }

    // 5. Role permissions check
    let role_enum = match Role::parse_role(&session.role) {
        Some(r) => r,
        None => {
            audit_denial(&session.username, cmd, "unrecognized user role", now_ms);
            return Err(GuardError::UserInactive);
        }
    };

    let granted = effective_permissions(role_enum, ctx.vertical);

    if let Some(required_perm) = policy.permission
        && !granted.contains(&required_perm)
    {
        audit_denial(
            &session.username,
            cmd,
            &format!("missing permission {:?}", required_perm),
            now_ms,
        );
        return Err(GuardError::PermissionDenied(required_perm));
    }

    // 6. Plan feature flag licensing check
    if let Some(required_feat) = policy.feature
        && !ctx.licence.has_feature(required_feat)
    {
        audit_denial(
            &session.username,
            cmd,
            &format!("feature {:?} not licensed", required_feat),
            now_ms,
        );
        return Err(GuardError::FeatureNotLicensed(required_feat));
    }

    // 7. Mode allows hook (read-only, export, print)
    if !ctx
        .mode
        .mode_allows(policy.write, policy.export, policy.print)
    {
        audit_denial(&session.username, cmd, "mode restriction", now_ms);
        return Err(GuardError::ModeRestricted(
            "Current operating mode restricts write, export, or print operations".into(),
        ));
    }

    Ok(AuthContext {
        user_id: Some(session.user_id),
        username: Some(session.username),
        display_name: Some(session.display_name),
        role: Some(session.role),
        is_primary_owner: session.is_primary_owner,
        is_public: false,
    })
}
