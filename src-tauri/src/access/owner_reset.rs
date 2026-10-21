//! Client Owner Password Reset Subsystem (Task L4C).
//!
//! Allows a locked-out or credential-compromised primary Owner to reset their
//! password using a vendor-provided temporary reset code:
//! - Validates the device's activation credentials with the Control Plane.
//! - Hashes the temporary password using Argon2id with production parameters.
//! - Sets `must_change_password = 1` to force a password change on next login.
//! - Closes all active user sessions for the primary Owner.
//! - Clears any existing lockout state.
//! - Records an audit event for `auth.owner_reset`.
//! - Never logs or stores the plaintext temporary password.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::audit::record_auth_event;
use super::password::{hash_password, PasswordError};
use super::transport::{ControlPlane, ControlPlaneError, OwnerResetRequest};

#[derive(Debug)]
pub enum OwnerResetError {
    NotActivated,
    NoPrimaryOwner,
    ServerRejected(ControlPlaneError),
    Password(PasswordError),
    Db(rusqlite::Error),
}

impl std::fmt::Display for OwnerResetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OwnerResetError::NotActivated => write!(f, "Device not activated"),
            OwnerResetError::NoPrimaryOwner => write!(f, "Primary owner user not found"),
            OwnerResetError::ServerRejected(e) => {
                write!(f, "Control Plane rejected owner reset: {}", e)
            }
            OwnerResetError::Password(e) => write!(f, "Password hashing failed: {}", e),
            OwnerResetError::Db(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for OwnerResetError {}

impl From<ControlPlaneError> for OwnerResetError {
    fn from(e: ControlPlaneError) -> Self {
        OwnerResetError::ServerRejected(e)
    }
}

impl From<PasswordError> for OwnerResetError {
    fn from(e: PasswordError) -> Self {
        OwnerResetError::Password(e)
    }
}

impl From<rusqlite::Error> for OwnerResetError {
    fn from(e: rusqlite::Error) -> Self {
        OwnerResetError::Db(e)
    }
}

#[derive(Debug, Deserialize)]
pub struct OwnerResetInput {
    pub reset_code: String,
}

#[derive(Debug, Serialize)]
pub struct OwnerResetResult {
    pub success: bool,
    pub message: String,
}

/// Executes an owner reset flow using the provided transport and optional in-memory session manager.
pub fn owner_reset<T: ControlPlane>(
    conn: &Connection,
    transport: &T,
    temp_password: &str,
    now_ms: i64,
) -> Result<(), OwnerResetError> {
    owner_reset_with_sessions(conn, transport, temp_password, None, now_ms)
}

/// Executes an owner reset flow, invalidating any active in-memory sessions for the primary owner.
pub fn owner_reset_with_sessions<T: ControlPlane>(
    conn: &Connection,
    transport: &T,
    temp_password: &str,
    session_mgr: Option<&super::session::SessionManager>,
    now_ms: i64,
) -> Result<(), OwnerResetError> {
    // 1. Fetch device credentials
    let mut stmt = conn.prepare(
        "SELECT key, value FROM app_state WHERE key IN ('tenant_id', 'device_id', 'device_secret')",
    )?;

    let mut tenant_id = String::new();
    let mut device_id = String::new();
    let mut device_secret = String::new();

    let rows = stmt.query_map([], |row| {
        let k: String = row.get(0)?;
        let v: String = row.get(1)?;
        Ok((k, v))
    })?;

    for item in rows {
        let (k, v) = item?;
        match k.as_str() {
            "tenant_id" => tenant_id = v,
            "device_id" => device_id = v,
            "device_secret" => device_secret = v,
            _ => {}
        }
    }

    if tenant_id.is_empty() || device_id.is_empty() || device_secret.is_empty() {
        return Err(OwnerResetError::NotActivated);
    }

    // 2. Fetch primary owner user
    let (owner_id, owner_username): (i64, String) = conn
        .query_row(
            "SELECT id, username FROM app_users WHERE is_primary_owner = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| OwnerResetError::NoPrimaryOwner)?;

    // 3. Call Control Plane to verify and consume the token
    let req = OwnerResetRequest {
        tenant_id,
        device_id,
        device_secret,
        reset_token: temp_password.trim().to_string(),
    };

    let resp = transport.owner_reset(&req)?;
    if !resp.ok {
        return Err(OwnerResetError::ServerRejected(ControlPlaneError::Server(
            400,
            "Reset rejected by server".into(),
        )));
    }

    // 4. Update owner credentials and lockout state
    let pw_hash = hash_password(temp_password.trim())?;

    conn.execute(
        "UPDATE app_users
         SET password_hash = ?1,
             must_change_password = 1,
             failed_attempts = 0,
             locked_until_ms = 0,
             updated_ms = ?2
         WHERE id = ?3",
        params![pw_hash, now_ms, owner_id],
    )?;

    // 5. Invalidate all active sessions for this owner if session manager is provided
    if let Some(sm) = session_mgr {
        let _ = sm.close_all_for_user(owner_id);
    }

    // 6. Record audit event
    record_auth_event(
        Some(conn),
        now_ms,
        "auth.owner_reset",
        &owner_username,
        "Primary Owner password reset via vendor recovery code",
    );

    Ok(())
}

/// Command handler for `owner_reset_with_code`.
pub fn cmd_owner_reset_with_code(db_path: &std::path::Path, input: &str) -> String {
    let payload: OwnerResetInput = match serde_json::from_str(input) {
        Ok(p) => p,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Invalid input: {}", e)
            })
            .to_string();
        }
    };

    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Database error: {}", e)
            })
            .to_string();
        }
    };

    let transport = match super::transport::ReqwestControlPlane::default_from_env() {
        Ok(t) => t,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Control plane config error: {}", e)
            })
            .to_string();
        }
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    match owner_reset(&conn, &transport, &payload.reset_code, now_ms) {
        Ok(()) => serde_json::json!({
            "success": true,
            "message": "Owner password has been reset. Please log in with the temporary password and set a new password."
        })
        .to_string(),
        Err(e) => serde_json::json!({
            "success": false,
            "error": e.to_string()
        })
        .to_string(),
    }
}
