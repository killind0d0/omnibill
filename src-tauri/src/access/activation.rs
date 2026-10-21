//! Client Activation Subsystem (Task L4C).
//!
//! Handles device activation with the Control Plane:
//! - Generates a persistent UUID v4 device ID.
//! - Attaches sealed DEK escrow blob if configured.
//! - Cryptographically verifies the returned licence before storing any state.
//! - Enforces business vertical matching against existing database state.
//! - Stores tenant credentials and licence into `app_state`.
//! - Creates the primary Owner with `must_change_password = 1`.
//! - Guarantees that running activation twice does not create duplicate owners.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::VerifyingKey;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::dbkey::DbKey;
use super::escrow::{is_escrow_configured, seal_dek, ESCROW_PUBLIC_KEY};
use super::licence::{vendor_key, Licence, LicenceError};
use super::licence_store::save_with_key;
use super::password::hash_password;
use super::transport::{ActivateRequest, ControlPlane, ControlPlaneError};
use super::users::{create_primary_owner, AuthError};

#[derive(Debug)]
pub enum ActivationError {
    Transport(ControlPlaneError),
    LicenceVerification(LicenceError),
    VerticalMismatch(String, String),
    Db(rusqlite::Error),
    Auth(AuthError),
    TenantMismatch(String, String),
}

impl std::fmt::Display for ActivationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ActivationError::Transport(e) => write!(f, "Transport/Control Plane error: {}", e),
            ActivationError::LicenceVerification(e) => write!(f, "Licence verification failed: {}", e),
            ActivationError::VerticalMismatch(a, b) => {
                write!(
                    f,
                    "Vertical mismatch: database is configured for '{}' but licence specifies '{}'",
                    a, b
                )
            }
            ActivationError::Db(e) => write!(f, "Database error: {}", e),
            ActivationError::Auth(e) => write!(f, "Authentication error: {}", e),
            ActivationError::TenantMismatch(a, b) => {
                write!(
                    f,
                    "Tenant ID mismatch: requested '{}', received licence for '{}'",
                    a, b
                )
            }
        }
    }
}

impl std::error::Error for ActivationError {}

impl From<ControlPlaneError> for ActivationError {
    fn from(e: ControlPlaneError) -> Self {
        ActivationError::Transport(e)
    }
}

impl From<LicenceError> for ActivationError {
    fn from(e: LicenceError) -> Self {
        ActivationError::LicenceVerification(e)
    }
}

impl From<rusqlite::Error> for ActivationError {
    fn from(e: rusqlite::Error) -> Self {
        ActivationError::Db(e)
    }
}

impl From<AuthError> for ActivationError {
    fn from(e: AuthError) -> Self {
        ActivationError::Auth(e)
    }
}

#[derive(Debug, Deserialize)]
pub struct ActivateInput {
    pub tenant_code: String,
    pub owner_username: String,
    pub temp_password: String,
}

#[derive(Debug, Serialize)]
pub struct ActivateResult {
    pub success: bool,
    pub tenant_id: String,
    pub business_name: String,
    pub vertical: String,
    pub plan: String,
    pub device_id: String,
}

/// Activates the local business instance against the Control Plane.
///
/// Uses the provided `ControlPlane` transport (either real or test mock).
pub fn activate<T: ControlPlane>(
    conn: &Connection,
    transport: &T,
    tenant_code: &str,
    owner_username: &str,
    temp_password: &str,
    db_key: Option<&DbKey>,
    verifying_key_override: Option<&VerifyingKey>,
    now_ms: i64,
) -> Result<Licence, ActivationError> {
    let key = match verifying_key_override {
        Some(k) => *k,
        None => vendor_key().map_err(ActivationError::LicenceVerification)?,
    };

    // 1. Generate device ID
    let device_id = uuid::Uuid::new_v4().to_string();

    // 2. Compute sealed escrow blob if escrow key is configured
    let dek_escrow_b64 = if is_escrow_configured() {
        if let Some(dek) = db_key {
            match seal_dek(dek, ESCROW_PUBLIC_KEY) {
                Ok(sealed) => Some(BASE64.encode(&sealed)),
                Err(_) => None,
            }
        } else {
            None
        }
    } else {
        None
    };

    let app_version = env!("CARGO_PKG_VERSION").to_string();

    let req = ActivateRequest {
        tenant_code: tenant_code.trim().to_string(),
        owner_username: owner_username.trim().to_string(),
        temp_password: temp_password.to_string(),
        device_id: device_id.clone(),
        app_version,
        dek_escrow_b64,
    };

    // 3. Call server
    let resp = transport.activate(&req)?;

    // 4. Cryptographically verify licence BEFORE storing anything
    resp.licence.verify(&key)?;

    // Tenant ID must match
    if !resp.licence.payload.tenant_id.eq_ignore_ascii_case(tenant_code.trim()) {
        return Err(ActivationError::TenantMismatch(
            tenant_code.trim().to_string(),
            resp.licence.payload.tenant_id.clone(),
        ));
    }

    // 5. Enforce vertical match against local database if already set
    let mut stmt = conn.prepare("SELECT value FROM app_state WHERE key = 'vertical'")?;
    let existing_vertical: Option<String> = stmt.query_row([], |r| r.get(0)).optional()?;
    if let Some(ref v) = existing_vertical {
        if !v.is_empty() && v != &resp.licence.payload.vertical {
            return Err(ActivationError::VerticalMismatch(
                v.clone(),
                resp.licence.payload.vertical.clone(),
            ));
        }
    }

    // 6. Store all state in app_state
    save_with_key(conn, &resp.licence, &key, now_ms)
        .map_err(|e| ActivationError::LicenceVerification(LicenceError::Serialization(e.to_string())))?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('vertical', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![resp.licence.payload.vertical, now_ms],
    )?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('device_id', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![device_id, now_ms],
    )?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('device_secret', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![resp.device_secret, now_ms],
    )?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('last_checkin_ms', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![now_ms.to_string(), now_ms],
    )?;

    let escrow_needed_str = if resp.escrow_needed { "1" } else { "0" };
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('escrow_needed', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![escrow_needed_str, now_ms],
    )?;

    // 7. Create primary Owner via create_primary_owner with must_change_password = 1
    // Running activation twice must not create two owners
    let owner_exists: bool = conn
        .query_row(
            "SELECT count(*) > 0 FROM app_users WHERE is_primary_owner = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if !owner_exists {
        let owner_id = match create_primary_owner(conn, owner_username, owner_username, temp_password, now_ms) {
            Ok(id) => id,
            Err(_) => {
                let hash = hash_password(temp_password)
                    .map_err(|e| ActivationError::Auth(AuthError::PasswordStrength(e)))?;
                let mut stmt = conn.prepare(
                    "INSERT INTO app_users (
                        username, display_name, password_hash, role, is_primary_owner,
                        is_active, must_change_password, failed_attempts, locked_until_ms,
                        last_login_ms, created_by, created_ms, updated_ms
                    ) VALUES (
                        ?1, ?2, ?3, 'owner', 1,
                        1, 1, 0, 0,
                        0, NULL, ?4, ?4
                    )",
                )?;
                stmt.insert(params![owner_username, owner_username, hash, now_ms])?
            }
        };

        conn.execute(
            "UPDATE app_users SET must_change_password = 1 WHERE id = ?1",
            params![owner_id],
        )?;
    }

    Ok(resp.licence)
}

/// Command handler for `activate_licence`.
pub fn cmd_activate_licence(db_path: &std::path::Path, input: &str) -> String {
    let payload: ActivateInput = match serde_json::from_str(input) {
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

    match activate(
        &conn,
        &transport,
        &payload.tenant_code,
        &payload.owner_username,
        &payload.temp_password,
        None,
        None,
        now_ms,
    ) {
        Ok(licence) => {
            let res = ActivateResult {
                success: true,
                tenant_id: licence.payload.tenant_id,
                business_name: licence.payload.business_name,
                vertical: licence.payload.vertical,
                plan: licence.payload.plan,
                device_id: licence.payload.device_id,
            };
            serde_json::to_string(&res).unwrap_or_else(|_| "{\"success\":true}".into())
        }
        Err(e) => serde_json::json!({
            "success": false,
            "error": e.to_string()
        })
        .to_string(),
    }
}
