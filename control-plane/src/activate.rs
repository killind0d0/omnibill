use crate::auth::verify_password;
use crate::licence::{features_for, sign_licence, Licence, LicencePayload};
use crate::settings::get_support_text;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize)]
pub struct ActivatePayload {
    pub tenant_code: String,
    pub owner_username: String,
    pub temp_password: String,
    pub device_id: String,
    pub app_version: String,
    pub dek_escrow_b64: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ActivateResponse {
    pub licence: Licence,
    pub device_secret: String,
    pub tenant_id: String,
    pub vertical: String,
    pub owner_username: String,
    pub escrow_needed: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ActivateError {
    #[error("Invalid tenant code or password")]
    Unauthorized,
    #[error("Tenant bootstrap has already been consumed")]
    BootstrapConsumed,
    #[error("Tenant already activated on another device. Revoke existing device first.")]
    DeviceAlreadyExists,
    #[error("Invalid base64 in dek_escrow_b64")]
    InvalidEscrow,
    #[error("Database error: {0}")]
    Db(String),
}

pub fn handle_activation(
    conn: &mut Connection,
    signing_key: &SigningKey,
    payload: &ActivatePayload,
    now_ms: i64,
) -> Result<ActivateResponse, ActivateError> {
    let tx = conn.transaction().map_err(|e| ActivateError::Db(e.to_string()))?;

    // 1. Verify tenant exists
    let tenant_row: Option<(String, String, String, String, i64, String, u32, u32, u32, i64, u64)> = tx
        .query_row(
            "SELECT id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial
             FROM tenants WHERE id = ?1",
            params![payload.tenant_code],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                ))
            },
        )
        .ok();

    let (
        tenant_id,
        business_name,
        vertical,
        plan,
        valid_until_day,
        status,
        max_counters_row,
        offline_days,
        grace_days,
        export_permit_until_ms,
        next_serial,
    ) = match tenant_row {
        Some(t) => t,
        None => return Err(ActivateError::Unauthorized),
    };

    // 2. Enforce exactly ONE active device
    let active_devices: i64 = tx
        .query_row(
            "SELECT count(*) FROM devices WHERE tenant_id = ?1 AND revoked = 0",
            params![tenant_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if active_devices > 0 {
        return Err(ActivateError::DeviceAlreadyExists);
    }

    // 3. Verify bootstrap credentials
    let bootstrap_row: Option<(String, i64)> = tx
        .query_row(
            "SELECT temp_password_hash, consumed_ms FROM tenant_owner_bootstrap WHERE tenant_id = ?1",
            params![tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let (pw_hash, consumed_ms) = match bootstrap_row {
        Some(b) => b,
        None => return Err(ActivateError::Unauthorized),
    };

    if consumed_ms > 0 {
        return Err(ActivateError::BootstrapConsumed);
    }

    if !verify_password(&payload.temp_password, &pw_hash) {
        return Err(ActivateError::Unauthorized);
    }

    // 4. Generate device secret
    let mut secret_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut secret_bytes);
    let mut device_secret = String::with_capacity(64);
    for b in secret_bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut device_secret, "{:02x}", b);
    }

    let mut hasher = Sha256::new();
    hasher.update(secret_bytes);
    let secret_hash: [u8; 32] = hasher.finalize().into();

    // 5. Decode escrow if present
    let (dek_escrow, escrow_needed) = match &payload.dek_escrow_b64 {
        Some(b64) => {
            let bytes = BASE64
                .decode(b64.trim())
                .map_err(|_| ActivateError::InvalidEscrow)?;
            if bytes.len() > 512 {
                return Err(ActivateError::InvalidEscrow);
            }
            (Some(bytes), false)
        }
        None => (None, true),
    };

    tx.execute(
        "INSERT INTO devices (id, tenant_id, secret_hash, activated_ms, last_checkin_ms, app_version, revoked, dek_escrow)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5, 0, ?6)",
        params![
            payload.device_id,
            tenant_id,
            secret_hash.as_slice(),
            now_ms,
            payload.app_version,
            dek_escrow
        ],
    ).map_err(|e| ActivateError::Db(e.to_string()))?;

    tx.execute(
        "UPDATE tenant_owner_bootstrap SET consumed_ms = ?1 WHERE tenant_id = ?2",
        params![now_ms, tenant_id],
    ).map_err(|e| ActivateError::Db(e.to_string()))?;

    // 6. Build and sign licence
    let max_counters = if plan == "basic" {
        1
    } else {
        max_counters_row
    };

    let features = features_for(&plan);
    let support_text = get_support_text(&tx);

    let serial = next_serial;
    tx.execute(
        "UPDATE tenants SET next_serial = next_serial + 1 WHERE id = ?1",
        params![tenant_id],
    ).map_err(|e| ActivateError::Db(e.to_string()))?;

    let payload_data = LicencePayload {
        v: 1,
        tenant_id: tenant_id.clone(),
        business_name,
        vertical: vertical.clone(),
        plan,
        features,
        max_counters,
        device_id: payload.device_id.clone(),
        serial,
        issued_ms: now_ms,
        valid_until_day,
        offline_days,
        grace_days,
        status,
        export_permit_until_ms,
        support_text,
    };

    let licence = sign_licence(signing_key, payload_data).map_err(|e| ActivateError::Db(e.to_string()))?;

    crate::db::append_audit(
        &tx,
        None,
        "device.activate",
        Some(&tenant_id),
        &format!("Device {} activated for tenant {}", payload.device_id, tenant_id),
        now_ms,
    ).map_err(|e| ActivateError::Db(e.to_string()))?;

    tx.commit().map_err(|e| ActivateError::Db(e.to_string()))?;

    Ok(ActivateResponse {
        licence,
        device_secret,
        tenant_id,
        vertical,
        owner_username: payload.owner_username.clone(),
        escrow_needed,
    })
}
