use crate::auth::verify_password;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Debug, Deserialize)]
pub struct OwnerResetPayload {
    pub tenant_id: String,
    pub device_id: String,
    pub device_secret: String,
    #[serde(alias = "reset_token")]
    pub temp_password: String,
}

#[derive(Debug, Serialize)]
pub struct OwnerResetResponse {
    pub ok: bool,
}

pub fn handle_owner_reset(
    conn: &mut Connection,
    payload: &OwnerResetPayload,
    now_ms: i64,
) -> Result<OwnerResetResponse, String> {
    let generic_error = "Owner reset verification failed";

    let tx = conn.transaction().map_err(|_| generic_error.to_string())?;

    // 1. Authenticate device
    let device_row: Option<(Vec<u8>, i64)> = tx
        .query_row(
            "SELECT secret_hash, revoked FROM devices WHERE id = ?1 AND tenant_id = ?2",
            params![payload.device_id, payload.tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let (stored_secret_hash, revoked) = match device_row {
        Some(d) => d,
        None => return Err(generic_error.into()),
    };

    if revoked != 0 {
        return Err(generic_error.into());
    }

    let mut secret_bytes = Vec::new();
    let sec_str = payload.device_secret.trim();
    if sec_str.len() % 2 == 0 {
        for i in (0..sec_str.len()).step_by(2) {
            if let Ok(b) = u8::from_str_radix(&sec_str[i..i + 2], 16) {
                secret_bytes.push(b);
            } else {
                return Err(generic_error.into());
            }
        }
    } else {
        return Err(generic_error.into());
    }

    let mut hasher = Sha256::new();
    hasher.update(&secret_bytes);
    let computed_hash: [u8; 32] = hasher.finalize().into();

    if stored_secret_hash.ct_eq(&computed_hash).unwrap_u8() != 1 {
        return Err(generic_error.into());
    }

    // 2. Fetch newest unused, unexpired owner reset token
    let token_row: Option<(i64, String, i64, i64)> = tx
        .query_row(
            "SELECT id, temp_password_hash, expires_ms, used_ms
             FROM owner_reset_tokens
             WHERE tenant_id = ?1 AND used_ms = 0 AND expires_ms > ?2
             ORDER BY id DESC LIMIT 1",
            params![payload.tenant_id, now_ms],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();

    let (token_id, pw_hash, _expires_ms, used_ms) = match token_row {
        Some(t) => t,
        None => return Err(generic_error.into()),
    };

    if used_ms > 0 {
        return Err(generic_error.into());
    }

    if !verify_password(&payload.temp_password, &pw_hash) {
        return Err(generic_error.into());
    }

    // 3. Mark token as used
    tx.execute(
        "UPDATE owner_reset_tokens SET used_ms = ?1 WHERE id = ?2",
        params![now_ms, token_id],
    )
    .map_err(|_| generic_error.to_string())?;

    crate::db::append_audit(
        &tx,
        None,
        "tenant.owner_reset_consumed",
        Some(&payload.tenant_id),
        &format!("Owner reset consumed by device {}", payload.device_id),
        now_ms,
    )
    .map_err(|_| generic_error.to_string())?;

    tx.commit().map_err(|_| generic_error.to_string())?;

    Ok(OwnerResetResponse { ok: true })
}
