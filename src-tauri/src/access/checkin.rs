//! Client Periodic Check-in Subsystem (Task L4C).
//!
//! Enforces:
//! - Collection of usage metrics via read-only queries (bills_24h, active_users, last_login_day, counters_paired, app_version).
//! - Strict 5-field golden payload serialization without leaking business or customer data.
//! - Cryptographic verification of renewed/refreshed licence before storage.
//! - Anti-replay: rejects licences with older serial than currently stored.
//! - Clock skew compensation: aligns `last_checkin_ms` with server time when local time drifts > 24 h.
//! - Monotonic clock advance via `touch_max_seen`.
//! - Background scheduler with exponential backoff.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::VerifyingKey;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::civil::ist_day;
use super::dbkey::DbKey;
use super::escrow::{is_escrow_configured, seal_dek, ESCROW_PUBLIC_KEY};
use super::licence::{vendor_key, Licence, LicenceError};
use super::licence_store::{save_with_key, set_last_checkin_ms, touch_max_seen};
use super::transport::{CheckinRequest, ControlPlane, ControlPlaneError, UsageReport};

#[derive(Debug)]
pub enum CheckinError {
    NotActivated,
    Transport(ControlPlaneError),
    LicenceVerification(LicenceError),
    OlderSerialReplay(u64, u64),
    WrongTenant(String, String),
    Db(rusqlite::Error),
}

impl std::fmt::Display for CheckinError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CheckinError::NotActivated => {
                write!(f, "Client not activated: missing tenant or device credentials")
            }
            CheckinError::Transport(e) => write!(f, "Transport/Control Plane error: {}", e),
            CheckinError::LicenceVerification(e) => write!(f, "Licence verification failed: {}", e),
            CheckinError::OlderSerialReplay(got, stored) => {
                write!(
                    f,
                    "Replay detected: received licence serial {} is older than stored serial {}",
                    got, stored
                )
            }
            CheckinError::WrongTenant(got, stored) => {
                write!(
                    f,
                    "Tenant mismatch: received licence for '{}' but local database is '{}'",
                    got, stored
                )
            }
            CheckinError::Db(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for CheckinError {}

impl From<ControlPlaneError> for CheckinError {
    fn from(e: ControlPlaneError) -> Self {
        CheckinError::Transport(e)
    }
}

impl From<LicenceError> for CheckinError {
    fn from(e: LicenceError) -> Self {
        CheckinError::LicenceVerification(e)
    }
}

impl From<rusqlite::Error> for CheckinError {
    fn from(e: rusqlite::Error) -> Self {
        CheckinError::Db(e)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckinResult {
    pub success: bool,
    pub licence: Licence,
    pub clock_skew: bool,
}

/// Collects usage metrics using strictly read-only queries.
///
/// Fields:
/// - `bills_24h`: count of sale documents in the last 24 h from `transactions`.
/// - `active_users`: count of users with `last_login_ms` within the last 30 days.
/// - `last_login_day`: civil day in IST of the most recent user login.
/// - `counters_paired`: 0 (until multi-counter host support is implemented).
/// - `app_version`: client software version.
pub fn collect_usage(conn: &Connection, now_ms: i64) -> UsageReport {
    // 1. bills_24h from transactions
    let since_secs = (now_ms - 86_400_000) / 1000;
    let bills_24h: i64 = conn
        .query_row(
            "SELECT count(*) FROM transactions WHERE created_at >= datetime(?1, 'unixepoch')",
            params![since_secs],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // 2. active_users (logged in within 30 days)
    let thirty_days_ms = now_ms - (30 * 86_400_000);
    let active_users: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE last_login_ms >= ?1",
            params![thirty_days_ms],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // 3. last_login_day
    let max_login_ms: Option<i64> = conn
        .query_row("SELECT max(last_login_ms) FROM app_users", [], |r| r.get(0))
        .ok();
    let last_login_day = match max_login_ms {
        Some(ms) if ms > 0 => ist_day(ms),
        _ => 0,
    };

    UsageReport {
        bills_24h,
        active_users,
        last_login_day,
        counters_paired: 0,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Performs a check-in with the Control Plane using the given transport.
pub fn checkin<T: ControlPlane>(
    conn: &Connection,
    transport: &T,
    db_key: Option<&DbKey>,
    verifying_key_override: Option<&VerifyingKey>,
    now_ms: i64,
) -> Result<CheckinResult, CheckinError> {
    let key = match verifying_key_override {
        Some(k) => *k,
        None => vendor_key().map_err(CheckinError::LicenceVerification)?,
    };

    // 1. Load device credentials from app_state
    let mut stmt = conn.prepare(
        "SELECT key, value FROM app_state WHERE key IN ('tenant_id', 'device_id', 'device_secret', 'licence_serial', 'escrow_needed')",
    )?;

    let mut tenant_id = String::new();
    let mut device_id = String::new();
    let mut device_secret = String::new();
    let mut stored_serial: u64 = 0;
    let mut escrow_needed = false;

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
            "licence_serial" => stored_serial = v.parse().unwrap_or(0),
            "escrow_needed" => escrow_needed = v == "1",
            _ => {}
        }
    }

    if tenant_id.is_empty() || device_id.is_empty() || device_secret.is_empty() {
        return Err(CheckinError::NotActivated);
    }

    // 2. Prepare usage report
    let usage = collect_usage(conn, now_ms);

    // 3. Attach escrow if server previously requested it
    let dek_escrow_b64 = if escrow_needed && is_escrow_configured() {
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

    let req = CheckinRequest {
        tenant_id: tenant_id.clone(),
        device_id,
        device_secret,
        licence_serial: stored_serial,
        usage,
        dek_escrow_b64,
    };

    // 4. Send request to server
    let resp = transport.checkin(&req)?;

    // 5. Verify licence signature
    resp.licence.verify(&key)?;

    // 6. Anti-replay: reject licence whose serial is lower than stored
    if resp.licence.payload.serial < stored_serial {
        return Err(CheckinError::OlderSerialReplay(
            resp.licence.payload.serial,
            stored_serial,
        ));
    }

    // 7. Verify tenant_id matches
    if !resp.licence.payload.tenant_id.eq_ignore_ascii_case(&tenant_id) {
        return Err(CheckinError::WrongTenant(
            resp.licence.payload.tenant_id.clone(),
            tenant_id,
        ));
    }

    // 8. Save updated licence
    save_with_key(conn, &resp.licence, &key, now_ms)
        .map_err(|e| CheckinError::LicenceVerification(LicenceError::Serialization(e.to_string())))?;

    // 9. Update escrow_needed flag in app_state
    let new_escrow_needed_str = if resp.escrow_needed { "1" } else { "0" };
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('escrow_needed', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![new_escrow_needed_str, now_ms],
    )?;

    // 10. Clock drift compensation
    let time_diff = (now_ms - resp.server_time_ms).abs();
    let clock_skew = time_diff > 24 * 3600 * 1000;
    let effective_last_checkin = if clock_skew {
        resp.server_time_ms
    } else {
        now_ms
    };

    set_last_checkin_ms(conn, effective_last_checkin, now_ms)
        .map_err(|e| CheckinError::Db(rusqlite::Error::ToSqlConversionFailure(Box::new(e))))?;

    // 11. Advance monotonic max_seen timestamp
    let _ = touch_max_seen(conn, now_ms);

    Ok(CheckinResult {
        success: true,
        licence: resp.licence,
        clock_skew,
    })
}

/// Periodic background check-in scheduler.
pub struct CheckinScheduler {
    stop_signal: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl CheckinScheduler {
    pub fn start<P: AsRef<Path>>(db_path: P) -> Self {
        let path = db_path.as_ref().to_path_buf();
        let stop_signal = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop_signal);

        let handle = std::thread::spawn(move || {
            let mut backoff_secs = 60; // 1 min initial backoff
            while !stop_clone.load(Ordering::Relaxed) {
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);

                let success = match rusqlite::Connection::open(&path) {
                    Ok(conn) => {
                        match super::transport::ReqwestControlPlane::default_from_env() {
                            Ok(transport) => {
                                checkin(&conn, &transport, None, None, now_ms).is_ok()
                            }
                            Err(_) => false,
                        }
                    }
                    Err(_) => false,
                };

                let sleep_secs = if success {
                    backoff_secs = 60;
                    6 * 3600 // 6 hours
                } else {
                    let s = backoff_secs;
                    backoff_secs = (backoff_secs * 2).min(3600); // Exponential backoff capped at 1h
                    s
                };

                for _ in 0..sleep_secs {
                    if stop_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            }
        });

        Self {
            stop_signal,
            handle: Some(handle),
        }
    }

    pub fn stop(&mut self) {
        self.stop_signal.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for CheckinScheduler {
    fn drop(&mut self) {
        self.stop();
    }
}
