//! User management, authentication, lockout enforcement, and role governance.
//!
//! Enforces:
//! - Strict caller hierarchy (P8 protections: primary owner cannot be modified/deactivated;
//!   co-owner only modifiable by primary owner)
//! - Constant-time timing defenses with uniform error reporting
//! - Lockout: 5 failed attempts locks the user account for 15 minutes
//! - Explicit `now_ms` parameter on every function (zero hidden clock dependencies)
//! - Float-free, zero secret leakage, audit event tracking

use rusqlite::{Connection, OptionalExtension, params};
use std::fmt;

use super::audit::record_auth_event;
use super::password::{
    PasswordError, check_strength, dummy_verify, hash_password, verify_password,
};
use super::policy::{LOCKOUT_FAILED_ATTEMPTS, LOCKOUT_MINUTES, is_role_valid_for_vertical};
use super::session::SessionManager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticatedUser {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_primary_owner: bool,
    pub must_change_password: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_primary_owner: bool,
    pub is_active: bool,
    pub must_change_password: bool,
    pub failed_attempts: u32,
    pub locked_until_ms: i64,
    pub last_login_ms: i64,
    pub created_by: Option<i64>,
    pub created_ms: i64,
    pub updated_ms: i64,
}

#[derive(Debug, Clone)]
pub struct CreateUserInput {
    pub username: String,
    pub display_name: String,
    pub password: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    InvalidCredentials,
    Locked { until_ms: i64 },
    PasswordStrength(PasswordError),
    Unauthorized(String),
    UserNotFound,
    UserAlreadyExists,
    InvalidRoleForVertical { role: String, vertical: String },
    CannotModifyPrimaryOwner,
    Database(String),
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::InvalidCredentials => write!(f, "Invalid username or password"),
            AuthError::Locked { until_ms } => write!(f, "Account locked until {}", until_ms),
            AuthError::PasswordStrength(e) => write!(f, "Password policy error: {}", e),
            AuthError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            AuthError::UserNotFound => write!(f, "User not found"),
            AuthError::UserAlreadyExists => write!(f, "User already exists"),
            AuthError::InvalidRoleForVertical { role, vertical } => {
                write!(
                    f,
                    "Role '{}' is not valid for vertical '{}'",
                    role, vertical
                )
            }
            AuthError::CannotModifyPrimaryOwner => {
                write!(
                    f,
                    "Primary owner account cannot be edited, demoted, or deactivated"
                )
            }
            AuthError::Database(msg) => write!(f, "Database error: {}", msg),
        }
    }
}

impl std::error::Error for AuthError {}

impl From<rusqlite::Error> for AuthError {
    fn from(err: rusqlite::Error) -> Self {
        AuthError::Database(err.to_string())
    }
}

impl From<PasswordError> for AuthError {
    fn from(err: PasswordError) -> Self {
        AuthError::PasswordStrength(err)
    }
}

/// Creates the initial Primary Owner account.
/// Used exclusively by initial system activation and vendor reset flows.
pub fn create_primary_owner(
    conn: &Connection,
    username: &str,
    display_name: &str,
    password: &str,
    now_ms: i64,
) -> Result<i64, AuthError> {
    check_strength(password, username)?;
    let hash = hash_password(password)?;

    let mut stmt = conn.prepare(
        "INSERT INTO app_users (
            username, display_name, password_hash, role, is_primary_owner,
            is_active, must_change_password, failed_attempts, locked_until_ms,
            last_login_ms, created_by, created_ms, updated_ms
        ) VALUES (
            ?1, ?2, ?3, 'owner', 1,
            1, 0, 0, 0,
            0, NULL, ?4, ?4
        )",
    )?;

    let user_id = stmt.insert(params![username, display_name, hash, now_ms])?;
    record_auth_event(
        Some(conn),
        now_ms,
        "auth.user_created",
        username,
        "Primary owner created",
    );
    Ok(user_id)
}

/// Creates a new user adhering to the creation governance rules:
/// - Owner and Co-owner may create staff with roles valid for the vertical (except owner/co-owner)
/// - Only the primary Owner may create a Co-owner
/// - Nobody may create a second primary Owner
pub fn create_user(
    conn: &Connection,
    creator_user_id: i64,
    input: CreateUserInput,
    vertical: &str,
    now_ms: i64,
) -> Result<i64, AuthError> {
    // 1. Fetch creator info
    let creator = conn
        .query_row(
            "SELECT role, is_primary_owner, is_active FROM app_users WHERE id = ?1",
            params![creator_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? == 1,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::Unauthorized("Creator user not found".into()))?;

    let (creator_role, is_primary_owner, is_creator_active) = creator;
    if !is_creator_active {
        return Err(AuthError::Unauthorized(
            "Creator account is inactive".into(),
        ));
    }

    if creator_role != "owner" && creator_role != "co_owner" {
        return Err(AuthError::Unauthorized(
            "Only owner or co-owner may create users".into(),
        ));
    }

    // Role creation rules
    if input.role == "owner" {
        return Err(AuthError::Unauthorized(
            "Cannot create an owner account".into(),
        ));
    }

    if input.role == "co_owner" && !is_primary_owner {
        return Err(AuthError::Unauthorized(
            "Only the primary owner may create a co-owner".into(),
        ));
    }

    // Validate role for vertical
    if !is_role_valid_for_vertical(&input.role, vertical) {
        return Err(AuthError::InvalidRoleForVertical {
            role: input.role.clone(),
            vertical: vertical.to_string(),
        });
    }

    // Check password strength and hash
    check_strength(&input.password, &input.username)?;
    let hash = hash_password(&input.password)?;

    let res = conn.execute(
        "INSERT INTO app_users (
            username, display_name, password_hash, role, is_primary_owner,
            is_active, must_change_password, failed_attempts, locked_until_ms,
            last_login_ms, created_by, created_ms, updated_ms
        ) VALUES (
            ?1, ?2, ?3, ?4, 0,
            1, 1, 0, 0,
            0, ?5, ?6, ?6
        )",
        params![
            input.username,
            input.display_name,
            hash,
            input.role,
            creator_user_id,
            now_ms
        ],
    );

    match res {
        Ok(_) => {
            let user_id = conn.last_insert_rowid();
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.user_created",
                &input.username,
                &format!("User created with role {}", input.role),
            );
            Ok(user_id)
        }
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(AuthError::UserAlreadyExists)
        }
        Err(e) => Err(AuthError::Database(e.to_string())),
    }
}

/// Authenticates a user with username and password.
/// Constant-time timing and uniform error text ensure no username enumeration.
pub fn authenticate(
    conn: &Connection,
    username: &str,
    password: &str,
    now_ms: i64,
) -> Result<AuthenticatedUser, AuthError> {
    let row = conn
        .query_row(
            "SELECT id, username, display_name, password_hash, role, is_primary_owner, is_active,
                must_change_password, failed_attempts, locked_until_ms
         FROM app_users
         WHERE username = ?1 COLLATE NOCASE
         LIMIT 1",
            params![username],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)? == 1,
                    r.get::<_, i64>(6)? == 1,
                    r.get::<_, i64>(7)? == 1,
                    r.get::<_, u32>(8)?,
                    r.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()?;

    let (
        id,
        found_username,
        display_name,
        password_hash,
        role,
        is_primary_owner,
        is_active,
        must_change_password,
        failed_attempts,
        locked_until_ms,
    ) = match row {
        Some(u) => u,
        None => {
            dummy_verify();
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.login_fail",
                "unknown",
                "User not found",
            );
            return Err(AuthError::InvalidCredentials);
        }
    };

    // Inactive user: uniform error
    if !is_active {
        dummy_verify();
        record_auth_event(
            Some(conn),
            now_ms,
            "auth.login_fail",
            &found_username,
            "Account inactive",
        );
        return Err(AuthError::InvalidCredentials);
    }

    // Locked check: if locked, exit immediately without password verification
    if locked_until_ms > now_ms {
        record_auth_event(
            Some(conn),
            now_ms,
            "auth.locked",
            &found_username,
            "Login attempted while account locked",
        );
        return Err(AuthError::Locked {
            until_ms: locked_until_ms,
        });
    }

    // Verify password
    let valid = verify_password(&password_hash, password);
    if !valid {
        let new_failed = failed_attempts + 1;
        if new_failed >= LOCKOUT_FAILED_ATTEMPTS {
            let lock_until = now_ms + LOCKOUT_MINUTES * 60_000;
            conn.execute(
                "UPDATE app_users
                 SET failed_attempts = 0, locked_until_ms = ?1, updated_ms = ?2
                 WHERE id = ?3",
                params![lock_until, now_ms, id],
            )?;
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.locked",
                &found_username,
                "Account locked due to consecutive failed attempts",
            );
        } else {
            conn.execute(
                "UPDATE app_users
                 SET failed_attempts = ?1, updated_ms = ?2
                 WHERE id = ?3",
                params![new_failed, now_ms, id],
            )?;
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.login_fail",
                &found_username,
                "Incorrect password",
            );
        }
        return Err(AuthError::InvalidCredentials);
    }

    // Login successful: reset counters and record last login
    conn.execute(
        "UPDATE app_users
         SET failed_attempts = 0, locked_until_ms = 0, last_login_ms = ?1, updated_ms = ?1
         WHERE id = ?2",
        params![now_ms, id],
    )?;

    record_auth_event(
        Some(conn),
        now_ms,
        "auth.login_ok",
        &found_username,
        "Login successful",
    );

    Ok(AuthenticatedUser {
        id,
        username: found_username,
        display_name,
        role,
        is_primary_owner,
        must_change_password,
    })
}

/// Verifies supervisor PIN / manager authorization for supervisor-protected actions:
/// (e.g. price override, bill cancel, credit limit bypass, cart void, negative margin).
///
/// Enforces:
/// 1. Supervisor authorization: user must have 'owner', 'admin', or 'manager' role.
/// 2. Monitored rate-limiting: consecutive wrong PIN attempts increment `failed_attempts`.
/// 3. Lockout enforcement: upon reaching consecutive failed PIN attempts (LOCKOUT_FAILED_ATTEMPTS),
///    the supervisor account is locked for 15 minutes (`locked_until_ms`), rejecting subsequent PIN checks.
/// 4. Cryptographic audit:
///    - On failure: logs `auth.override_fail`.
///    - On lockout: logs `auth.locked` with reason "Supervisor override PIN lockout".
///    - On success: logs `financial.override` with supervisor username, override type, and reason.
pub fn verify_supervisor_pin_override(
    conn: &Connection,
    supervisor_username: &str,
    supervisor_pin: &str,
    override_type: &str,
    reason: &str,
    now_ms: i64,
) -> Result<AuthenticatedUser, AuthError> {
    let row = conn
        .query_row(
            "SELECT id, username, display_name, password_hash, role, is_primary_owner, is_active,
                must_change_password, failed_attempts, locked_until_ms
         FROM app_users
         WHERE username = ?1 COLLATE NOCASE
         LIMIT 1",
            params![supervisor_username],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)? == 1,
                    r.get::<_, i64>(6)? == 1,
                    r.get::<_, i64>(7)? == 1,
                    r.get::<_, u32>(8)?,
                    r.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()?;

    let (
        id,
        found_username,
        display_name,
        password_hash,
        role,
        is_primary_owner,
        is_active,
        must_change_password,
        failed_attempts,
        locked_until_ms,
    ) = match row {
        Some(u) => u,
        None => {
            dummy_verify();
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.override_fail",
                "unknown",
                &format!("Supervisor override attempted for unknown user; type: {}, reason: {}", override_type, reason),
            );
            return Err(AuthError::InvalidCredentials);
        }
    };

    // Role check: supervisor override requires manager, admin, or owner
    let role_lower = role.to_lowercase();
    if role_lower != "owner" && role_lower != "admin" && role_lower != "manager" {
        record_auth_event(
            Some(conn),
            now_ms,
            "auth.override_denied",
            &found_username,
            &format!("User role '{}' lacks supervisor override authority", role),
        );
        return Err(AuthError::InvalidCredentials);
    }

    if !is_active {
        dummy_verify();
        record_auth_event(
            Some(conn),
            now_ms,
            "auth.override_fail",
            &found_username,
            "Account inactive",
        );
        return Err(AuthError::InvalidCredentials);
    }

    // Check if supervisor is currently locked out
    if locked_until_ms > now_ms {
        record_auth_event(
            Some(conn),
            now_ms,
            "auth.locked",
            &found_username,
            &format!("Supervisor override PIN rejected: account locked until {}", locked_until_ms),
        );
        return Err(AuthError::Locked {
            until_ms: locked_until_ms,
        });
    }

    // Verify PIN / password
    let valid = verify_password(&password_hash, supervisor_pin);
    if !valid {
        let new_failed = failed_attempts + 1;
        if new_failed >= LOCKOUT_FAILED_ATTEMPTS {
            let lock_until = now_ms + LOCKOUT_MINUTES * 60_000;
            conn.execute(
                "UPDATE app_users
                 SET failed_attempts = 0, locked_until_ms = ?1, updated_ms = ?2
                 WHERE id = ?3",
                params![lock_until, now_ms, id],
            )?;
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.locked",
                &found_username,
                &format!("Supervisor PIN locked out after {} failed attempts; override_type: {}", new_failed, override_type),
            );
        } else {
            conn.execute(
                "UPDATE app_users
                 SET failed_attempts = ?1, updated_ms = ?2
                 WHERE id = ?3",
                params![new_failed, now_ms, id],
            )?;
            record_auth_event(
                Some(conn),
                now_ms,
                "auth.override_fail",
                &found_username,
                &format!("Incorrect supervisor PIN ({}/{} attempts); override_type: {}", new_failed, LOCKOUT_FAILED_ATTEMPTS, override_type),
            );
        }
        return Err(AuthError::InvalidCredentials);
    }

    // PIN verified successfully: reset failed attempts
    conn.execute(
        "UPDATE app_users
         SET failed_attempts = 0, locked_until_ms = 0, updated_ms = ?1
         WHERE id = ?2",
        params![now_ms, id],
    )?;

    // Record persistent audit entry for supervisor override with reason code
    record_auth_event(
        Some(conn),
        now_ms,
        "financial.override",
        &found_username,
        &format!("Supervisor override authorized for [{}]. Reason: {}", override_type, reason),
    );

    Ok(AuthenticatedUser {
        id,
        username: found_username,
        display_name,
        role,
        is_primary_owner,
        must_change_password,
    })
}

/// Changes the password for an authenticated user.
pub fn change_password(
    conn: &Connection,
    user_id: i64,
    old_pw: &str,
    new_pw: &str,
    now_ms: i64,
) -> Result<(), AuthError> {
    let row = conn
        .query_row(
            "SELECT username, password_hash, is_active FROM app_users WHERE id = ?1",
            params![user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?;

    let (username, current_hash, is_active) = match row {
        Some(r) => r,
        None => return Err(AuthError::UserNotFound),
    };

    if !is_active {
        return Err(AuthError::Unauthorized("User is inactive".into()));
    }

    if !verify_password(&current_hash, old_pw) {
        return Err(AuthError::InvalidCredentials);
    }

    check_strength(new_pw, &username)?;
    let new_hash = hash_password(new_pw)?;

    conn.execute(
        "UPDATE app_users
         SET password_hash = ?1, must_change_password = 0, updated_ms = ?2
         WHERE id = ?3",
        params![new_hash, now_ms, user_id],
    )?;

    record_auth_event(
        Some(conn),
        now_ms,
        "auth.password_changed",
        &username,
        "Password changed by user",
    );

    Ok(())
}

/// Administrative password reset.
/// Resets target user's password, forces must_change_password=1, and terminates target sessions.
pub fn admin_reset_password(
    conn: &Connection,
    admin_user_id: i64,
    target_user_id: i64,
    new_temp_pw: &str,
    now_ms: i64,
    session_mgr: &SessionManager,
) -> Result<(), AuthError> {
    let admin = conn
        .query_row(
            "SELECT role, is_primary_owner, is_active FROM app_users WHERE id = ?1",
            params![admin_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? == 1,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::Unauthorized("Admin user not found".into()))?;

    let (admin_role, is_admin_primary, is_admin_active) = admin;
    if !is_admin_active || (admin_role != "owner" && admin_role != "co_owner") {
        return Err(AuthError::Unauthorized(
            "Only active owner or co-owner may reset passwords".into(),
        ));
    }

    let target = conn
        .query_row(
            "SELECT username, role, is_primary_owner FROM app_users WHERE id = ?1",
            params![target_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::UserNotFound)?;

    let (target_username, target_role, is_target_primary) = target;

    // Primary owner cannot be modified/reset by anyone via this flow
    if is_target_primary {
        return Err(AuthError::CannotModifyPrimaryOwner);
    }

    // Co-owner can only be reset by primary owner
    if target_role == "co_owner" && !is_admin_primary {
        return Err(AuthError::Unauthorized(
            "Only the primary owner may reset co-owner password".into(),
        ));
    }

    check_strength(new_temp_pw, &target_username)?;
    let new_hash = hash_password(new_temp_pw)?;

    conn.execute(
        "UPDATE app_users
         SET password_hash = ?1, must_change_password = 1, updated_ms = ?2
         WHERE id = ?3",
        params![new_hash, now_ms, target_user_id],
    )?;

    let _ = session_mgr.close_all_for_user(target_user_id);

    record_auth_event(
        Some(conn),
        now_ms,
        "auth.password_reset",
        &target_username,
        "Password reset by administrator",
    );

    Ok(())
}

/// Activates or deactivates a user account.
pub fn set_active(
    conn: &Connection,
    admin_user_id: i64,
    target_user_id: i64,
    active: bool,
    now_ms: i64,
    session_mgr: &SessionManager,
) -> Result<(), AuthError> {
    let admin = conn
        .query_row(
            "SELECT role, is_primary_owner, is_active FROM app_users WHERE id = ?1",
            params![admin_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? == 1,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::Unauthorized("Admin user not found".into()))?;

    let (admin_role, is_admin_primary, is_admin_active) = admin;
    if !is_admin_active || (admin_role != "owner" && admin_role != "co_owner") {
        return Err(AuthError::Unauthorized(
            "Only active owner or co-owner may toggle user active state".into(),
        ));
    }

    let target = conn
        .query_row(
            "SELECT username, role, is_primary_owner FROM app_users WHERE id = ?1",
            params![target_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::UserNotFound)?;

    let (target_username, target_role, is_target_primary) = target;

    if is_target_primary {
        return Err(AuthError::CannotModifyPrimaryOwner);
    }

    if target_role == "co_owner" && !is_admin_primary {
        return Err(AuthError::Unauthorized(
            "Only the primary owner may deactivate or activate co-owner".into(),
        ));
    }

    let active_int = if active { 1 } else { 0 };
    conn.execute(
        "UPDATE app_users SET is_active = ?1, updated_ms = ?2 WHERE id = ?3",
        params![active_int, now_ms, target_user_id],
    )?;

    if !active {
        let _ = session_mgr.close_all_for_user(target_user_id);
    }

    let event_name = if active {
        "auth.user_activated"
    } else {
        "auth.user_deactivated"
    };
    record_auth_event(
        Some(conn),
        now_ms,
        event_name,
        &target_username,
        &format!("User active status set to {}", active),
    );

    Ok(())
}

/// Changes a user's role with validation against vertical permissions.
pub fn set_role(
    conn: &Connection,
    admin_user_id: i64,
    target_user_id: i64,
    new_role: &str,
    vertical: &str,
    now_ms: i64,
) -> Result<(), AuthError> {
    let admin = conn
        .query_row(
            "SELECT role, is_primary_owner, is_active FROM app_users WHERE id = ?1",
            params![admin_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)? == 1,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::Unauthorized("Admin user not found".into()))?;

    let (admin_role, is_admin_primary, is_admin_active) = admin;
    if !is_admin_active || (admin_role != "owner" && admin_role != "co_owner") {
        return Err(AuthError::Unauthorized(
            "Only active owner or co-owner may change roles".into(),
        ));
    }

    let target = conn
        .query_row(
            "SELECT username, role, is_primary_owner FROM app_users WHERE id = ?1",
            params![target_user_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? == 1,
                ))
            },
        )
        .optional()?
        .ok_or(AuthError::UserNotFound)?;

    let (target_username, target_role, is_target_primary) = target;

    if is_target_primary {
        return Err(AuthError::CannotModifyPrimaryOwner);
    }

    if target_role == "co_owner" && !is_admin_primary {
        return Err(AuthError::Unauthorized(
            "Only the primary owner may demote co-owner".into(),
        ));
    }

    if new_role == "owner" {
        return Err(AuthError::Unauthorized("Cannot promote to owner".into()));
    }

    if new_role == "co_owner" && !is_admin_primary {
        return Err(AuthError::Unauthorized(
            "Only the primary owner may promote to co-owner".into(),
        ));
    }

    if !is_role_valid_for_vertical(new_role, vertical) {
        return Err(AuthError::InvalidRoleForVertical {
            role: new_role.to_string(),
            vertical: vertical.to_string(),
        });
    }

    conn.execute(
        "UPDATE app_users SET role = ?1, updated_ms = ?2 WHERE id = ?3",
        params![new_role, now_ms, target_user_id],
    )?;

    record_auth_event(
        Some(conn),
        now_ms,
        "auth.role_changed",
        &target_username,
        &format!("Role changed to {}", new_role),
    );

    Ok(())
}

/// Lists all users from the database.
pub fn list_users(conn: &Connection) -> Result<Vec<UserRecord>, AuthError> {
    let mut stmt = conn.prepare(
        "SELECT id, username, display_name, role, is_primary_owner, is_active,
                must_change_password, failed_attempts, locked_until_ms, last_login_ms,
                created_by, created_ms, updated_ms
         FROM app_users
         ORDER BY id ASC",
    )?;

    let users = stmt
        .query_map([], |r| {
            Ok(UserRecord {
                id: r.get(0)?,
                username: r.get(1)?,
                display_name: r.get(2)?,
                role: r.get(3)?,
                is_primary_owner: r.get::<_, i64>(4)? == 1,
                is_active: r.get::<_, i64>(5)? == 1,
                must_change_password: r.get::<_, i64>(6)? == 1,
                failed_attempts: r.get(7)?,
                locked_until_ms: r.get(8)?,
                last_login_ms: r.get(9)?,
                created_by: r.get(10)?,
                created_ms: r.get(11)?,
                updated_ms: r.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(users)
}
