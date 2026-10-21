use crate::civil::ist_day;
use crate::licence::{features_for, sign_licence, Licence, LicencePayload};
use crate::settings::get_support_text;
use crate::usage::UsageReportPayload;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::SigningKey;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Debug, Deserialize)]
pub struct CheckinPayload {
    pub tenant_id: String,
    pub device_id: String,
    pub device_secret: String,
    pub licence_serial: u64,
    pub usage: UsageReportPayload,
    pub dek_escrow_b64: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CheckinResponse {
    pub licence: Licence,
    pub server_time_ms: i64,
    pub escrow_needed: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CheckinError {
    #[error("Device not found or invalid credentials")]
    Unauthorized,
    #[error("revoked")]
    Revoked,
    #[error("Usage payload validation failed: {0}")]
    UsageValidation(&'static str),
    #[error("Database error: {0}")]
    Db(String),
}

pub fn handle_checkin(
    conn: &mut Connection,
    signing_key: &SigningKey,
    payload: &CheckinPayload,
    now_ms: i64,
) -> Result<CheckinResponse, CheckinError> {
    payload
        .usage
        .validate()
        .map_err(CheckinError::UsageValidation)?;

    let tx = conn.transaction().map_err(|e| CheckinError::Db(e.to_string()))?;

    // 1. Authenticate device
    let device_row: Option<(Vec<u8>, i64, Option<Vec<u8>>)> = tx
        .query_row(
            "SELECT secret_hash, revoked, dek_escrow FROM devices WHERE id = ?1 AND tenant_id = ?2",
            params![payload.device_id, payload.tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();

    let (stored_secret_hash, revoked, existing_escrow) = match device_row {
        Some(d) => d,
        None => return Err(CheckinError::Unauthorized),
    };

    if revoked != 0 {
        return Err(CheckinError::Revoked);
    }

    let mut secret_bytes = Vec::new();
    let sec_str = payload.device_secret.trim();
    if sec_str.len() % 2 == 0 {
        for i in (0..sec_str.len()).step_by(2) {
            if let Ok(b) = u8::from_str_radix(&sec_str[i..i + 2], 16) {
                secret_bytes.push(b);
            } else {
                return Err(CheckinError::Unauthorized);
            }
        }
    } else {
        return Err(CheckinError::Unauthorized);
    }

    let mut hasher = Sha256::new();
    hasher.update(&secret_bytes);
    let computed_hash: [u8; 32] = hasher.finalize().into();

    if stored_secret_hash.ct_eq(&computed_hash).unwrap_u8() != 1 {
        return Err(CheckinError::Unauthorized);
    }

    // 2. Escrow update if provided and not stored yet
    let (_new_escrow, escrow_needed) = match existing_escrow {
        Some(escrow) => (Some(escrow), false),
        None => {
            if let Some(ref b64) = payload.dek_escrow_b64 {
                if let Ok(bytes) = BASE64.decode(b64.trim()) {
                    if bytes.len() <= 512 {
                        tx.execute(
                            "UPDATE devices SET dek_escrow = ?1 WHERE id = ?2",
                            params![bytes, payload.device_id],
                        )
                        .map_err(|e| CheckinError::Db(e.to_string()))?;
                        (Some(bytes), false)
                    } else {
                        (None, true)
                    }
                } else {
                    (None, true)
                }
            } else {
                (None, true)
            }
        }
    };

    // 3. Record usage report
    let today_day = ist_day(now_ms);
    tx.execute(
        "INSERT INTO usage_reports (tenant_id, device_id, day, bills_24h, active_users, last_login_day, counters_paired, received_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            payload.tenant_id,
            payload.device_id,
            today_day,
            payload.usage.bills_24h,
            payload.usage.active_users,
            payload.usage.last_login_day,
            payload.usage.counters_paired,
            now_ms
        ],
    ).map_err(|e| CheckinError::Db(e.to_string()))?;

    // 4. Update device last_checkin_ms and app_version
    tx.execute(
        "UPDATE devices SET last_checkin_ms = ?1, app_version = ?2 WHERE id = ?3",
        params![now_ms, payload.usage.app_version, payload.device_id],
    ).map_err(|e| CheckinError::Db(e.to_string()))?;

    // 5. Build and sign new licence with latest tenant state
    let tenant_row: (String, String, String, i64, String, u32, u32, u32, i64, u64) = tx
        .query_row(
            "SELECT business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial
             FROM tenants WHERE id = ?1",
            params![payload.tenant_id],
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
                ))
            },
        )
        .map_err(|e| CheckinError::Db(e.to_string()))?;

    let (
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
    ) = tenant_row;

    let max_counters = if plan == "basic" { 1 } else { max_counters_row };
    let features = features_for(&plan);
    let support_text = get_support_text(&tx);

    let serial = next_serial;
    tx.execute(
        "UPDATE tenants SET next_serial = next_serial + 1 WHERE id = ?1",
        params![payload.tenant_id],
    ).map_err(|e| CheckinError::Db(e.to_string()))?;

    let payload_data = LicencePayload {
        v: 1,
        tenant_id: payload.tenant_id.clone(),
        business_name,
        vertical,
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

    let licence = sign_licence(signing_key, payload_data)
        .map_err(|e| CheckinError::Db(e.to_string()))?;

    tx.commit().map_err(|e| CheckinError::Db(e.to_string()))?;

    Ok(CheckinResponse {
        licence,
        server_time_ms: now_ms,
        escrow_needed,
    })
}
