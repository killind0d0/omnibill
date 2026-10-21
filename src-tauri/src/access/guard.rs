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
use super::licence::{Licence, Mode, ModeInputs, compute_mode, export_allowed};
use super::permissions::Permission;
use super::policy_table::{Feature, find_policy};
use super::roles::Role;
use super::session::{SessionError, SessionManager};
use ed25519_dalek::VerifyingKey;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthContext {
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub role: Option<String>,
    pub is_primary_owner: bool,
    pub is_public: bool,
    pub mode: Mode,
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
    fn get_licence(&self) -> Option<&Licence> {
        None
    }
    fn plan(&self) -> Option<&str> {
        None
    }
    fn features_list(&self) -> Vec<String> {
        Vec::new()
    }
}

pub struct MockAllFeaturesLicensed;
impl LicenceFeatureProvider for MockAllFeaturesLicensed {
    fn has_feature(&self, _feature: Feature) -> bool {
        true
    }
    fn plan(&self) -> Option<&str> {
        Some("pro")
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
    fn current_mode(&self) -> Mode {
        Mode::Full
    }
    fn touch_max_seen(&self, _now_ms: i64) {}
    fn is_export_allowed(&self, _now_ms: i64) -> bool {
        false
    }
    fn last_checkin_ms(&self) -> i64 {
        0
    }
}

pub struct MockAllModesAllowed;
impl ModeAllowsProvider for MockAllModesAllowed {
    fn mode_allows(&self, _write: bool, _export: bool, _print: bool) -> bool {
        true
    }
    fn current_mode(&self) -> Mode {
        Mode::Full
    }
}

pub struct StaticModeProvider {
    pub mode: Mode,
    pub export_allowed_override: bool,
    pub max_seen: Mutex<i64>,
}

impl StaticModeProvider {
    pub fn new(mode: Mode) -> Self {
        Self {
            mode,
            export_allowed_override: false,
            max_seen: Mutex::new(0),
        }
    }

    pub fn with_export_permit(mode: Mode) -> Self {
        Self {
            mode,
            export_allowed_override: true,
            max_seen: Mutex::new(0),
        }
    }
}

impl ModeAllowsProvider for StaticModeProvider {
    fn mode_allows(&self, write: bool, export: bool, print: bool) -> bool {
        match &self.mode {
            Mode::Full => true,
            Mode::ReadOnly(_) => {
                if print || write {
                    return false;
                }
                if export {
                    return self.export_allowed_override;
                }
                true
            }
            Mode::Unlicensed => false,
        }
    }

    fn current_mode(&self) -> Mode {
        self.mode.clone()
    }

    fn touch_max_seen(&self, now_ms: i64) {
        if let Ok(mut lock) = self.max_seen.lock() {
            *lock = (*lock).max(now_ms);
        }
    }

    fn is_export_allowed(&self, _now_ms: i64) -> bool {
        self.export_allowed_override
    }
}

pub struct RealLicenceModeProvider {
    pub licence: Option<Licence>,
    pub key: VerifyingKey,
    pub inputs: ModeInputs,
    pub max_seen: Mutex<i64>,
}

impl RealLicenceModeProvider {
    pub fn new(licence: Option<Licence>, key: VerifyingKey, inputs: ModeInputs) -> Self {
        let max_seen = Mutex::new(inputs.max_seen_ms);
        Self {
            licence,
            key,
            inputs,
            max_seen,
        }
    }
}

impl LicenceFeatureProvider for RealLicenceModeProvider {
    fn has_feature(&self, feature: Feature) -> bool {
        if let Some(ref lic) = self.licence {
            lic.payload.features.iter().any(|f| f == feature.as_str())
        } else {
            false
        }
    }

    fn get_licence(&self) -> Option<&Licence> {
        self.licence.as_ref()
    }

    fn plan(&self) -> Option<&str> {
        self.licence.as_ref().map(|l| l.payload.plan.as_str())
    }

    fn features_list(&self) -> Vec<String> {
        self.licence
            .as_ref()
            .map(|l| l.payload.features.clone())
            .unwrap_or_default()
    }
}

impl ModeAllowsProvider for RealLicenceModeProvider {
    fn mode_allows(&self, write: bool, export: bool, print: bool) -> bool {
        let mode = self.current_mode();
        match mode {
            Mode::Full => true,
            Mode::ReadOnly(_) => {
                if print || write {
                    return false;
                }
                if export {
                    return self.is_export_allowed(self.inputs.now_ms);
                }
                true
            }
            Mode::Unlicensed => false,
        }
    }

    fn current_mode(&self) -> Mode {
        compute_mode(self.licence.as_ref(), &self.key, &self.inputs)
    }

    fn touch_max_seen(&self, now_ms: i64) {
        if let Ok(mut lock) = self.max_seen.lock() {
            *lock = (*lock).max(now_ms);
        }
    }

    fn is_export_allowed(&self, now_ms: i64) -> bool {
        let mode = self.current_mode();
        export_allowed(self.licence.as_ref(), &self.key, &mode, now_ms)
    }

    fn last_checkin_ms(&self) -> i64 {
        self.inputs.last_checkin_ms
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
/// Enforces all stages in exact sequential order:
/// 1. Policy registration check
/// 2. Mode computation: Unlicensed -> only public commands
/// 3. Public bypass
/// 4. Session token validation
/// 5. Mandatory password change check
/// 6. Role permission check
/// 7. Plan feature flag licensing
/// 8. Read-only / no-export / no-print enforcement
/// 9. touch_max_seen advancement on success
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

    // Mode computation
    let current_mode = ctx.mode.current_mode();

    // - Unlicensed -> only public commands
    if current_mode == Mode::Unlicensed && !policy.public {
        audit_denial(
            token.unwrap_or("anon"),
            cmd,
            "unlicensed: public only",
            now_ms,
        );
        return Err(GuardError::ModeRestricted(
            "System is unlicensed: only public commands are permitted".into(),
        ));
    }

    // 2. Public commands return early without requiring session
    if policy.public {
        return Ok(AuthContext {
            user_id: None,
            username: None,
            display_name: None,
            role: None,
            is_primary_owner: false,
            is_public: true,
            mode: current_mode,
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

    // 7. Operating mode enforcement (ReadOnly, Export, Print)
    if let Mode::ReadOnly(ref reason) = current_mode {
        // Exemption: get_access_status is always allowed in read-only mode
        if cmd != "get_access_status" {
            // deny every write: true
            if policy.write {
                audit_denial(
                    &session.username,
                    cmd,
                    &format!("write denied in read-only mode ({:?})", reason),
                    now_ms,
                );
                return Err(GuardError::ModeRestricted(format!(
                    "Write operations are prohibited in read-only mode ({:?})",
                    reason
                )));
            }

            // deny print: true ALWAYS
            if policy.print {
                audit_denial(
                    &session.username,
                    cmd,
                    "print denied in read-only mode",
                    now_ms,
                );
                return Err(GuardError::ModeRestricted(
                    "Printing is strictly prohibited in read-only mode".into(),
                ));
            }

            // deny export: true unless export_allowed
            if policy.export && !ctx.mode.is_export_allowed(now_ms) {
                audit_denial(
                    &session.username,
                    cmd,
                    "export denied in read-only mode without permit",
                    now_ms,
                );
                return Err(GuardError::ModeRestricted(
                    "Export operations are prohibited without a valid export permit in read-only mode".into(),
                ));
            }
        }
    }

    // Hook compatibility check
    if !ctx
        .mode
        .mode_allows(policy.write, policy.export, policy.print)
    {
        audit_denial(&session.username, cmd, "mode restriction", now_ms);
        return Err(GuardError::ModeRestricted(
            "Current operating mode restricts write, export, or print operations".into(),
        ));
    }

    // Every successful authorize calls touch_max_seen
    ctx.mode.touch_max_seen(now_ms);

    Ok(AuthContext {
        user_id: Some(session.user_id),
        username: Some(session.username),
        display_name: Some(session.display_name),
        role: Some(session.role),
        is_primary_owner: session.is_primary_owner,
        is_public: false,
        mode: current_mode,
    })
}
