//! SQLite storage for licence data, device credentials, and monotonic clock state.
//! Backed by the `app_state` key-value table.

use ed25519_dalek::VerifyingKey;
use rusqlite::{Connection, OptionalExtension, params};

use super::clock_guard::advance_max_seen;
use super::licence::{Licence, LicenceError, ModeInputs};

#[derive(Debug)]
pub enum LicenceStoreError {
    Database(rusqlite::Error),
    Licence(LicenceError),
    Serialization(serde_json::Error),
    InvalidData(String),
}

impl std::fmt::Display for LicenceStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenceStoreError::Database(e) => write!(f, "Database error: {}", e),
            LicenceStoreError::Licence(e) => write!(f, "Licence verification error: {}", e),
            LicenceStoreError::Serialization(e) => write!(f, "Serialization error: {}", e),
            LicenceStoreError::InvalidData(msg) => write!(f, "Invalid data in app_state: {}", msg),
        }
    }
}

impl std::error::Error for LicenceStoreError {}

impl From<rusqlite::Error> for LicenceStoreError {
    fn from(e: rusqlite::Error) -> Self {
        LicenceStoreError::Database(e)
    }
}

impl From<LicenceError> for LicenceStoreError {
    fn from(e: LicenceError) -> Self {
        LicenceStoreError::Licence(e)
    }
}

impl From<serde_json::Error> for LicenceStoreError {
    fn from(e: serde_json::Error) -> Self {
        LicenceStoreError::Serialization(e)
    }
}

/// Loads the currently stored licence from `app_state`, if any.
pub fn load(conn: &Connection) -> Result<Option<Licence>, LicenceStoreError> {
    let mut stmt = conn.prepare("SELECT value FROM app_state WHERE key = 'licence_json'")?;
    let val: Option<String> = stmt.query_row([], |row| row.get(0)).optional()?;

    match val {
        Some(json_str) => {
            let licence = Licence::from_json(&json_str)?;
            Ok(Some(licence))
        }
        None => Ok(None),
    }
}

/// Saves a licence to `app_state` ONLY after its cryptographic signature is verified against the vendor key.
pub fn save(conn: &Connection, licence: &Licence) -> Result<(), LicenceStoreError> {
    let key = super::licence::vendor_key()?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    save_with_key(conn, licence, &key, now_ms)
}

/// Saves a licence to `app_state` ONLY after its cryptographic signature is verified against the provided key.
pub fn save_with_key(
    conn: &Connection,
    licence: &Licence,
    key: &VerifyingKey,
    now_ms: i64,
) -> Result<(), LicenceStoreError> {
    licence.verify(key)?;

    let json_str = serde_json::to_string(licence)?;
    let serial_str = licence.payload.serial.to_string();

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('licence_json', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![json_str, now_ms],
    )?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('licence_serial', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![serial_str, now_ms],
    )?;

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('tenant_id', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![licence.payload.tenant_id, now_ms],
    )?;

    Ok(())
}

/// Updates the monotonic max seen timestamp in `app_state`.
pub fn touch_max_seen(conn: &Connection, now_ms: i64) -> Result<i64, LicenceStoreError> {
    let mut stmt = conn.prepare("SELECT value FROM app_state WHERE key = 'max_seen_ms'")?;
    let prev_str: Option<String> = stmt.query_row([], |row| row.get(0)).optional()?;

    let prev: i64 = prev_str.and_then(|s| s.parse().ok()).unwrap_or(0);
    let new_max = advance_max_seen(prev, now_ms);

    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('max_seen_ms', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![new_max.to_string(), now_ms],
    )?;

    Ok(new_max)
}

/// Reads the current mode inputs from `app_state` using current system time.
pub fn read_inputs(conn: &Connection) -> Result<ModeInputs, LicenceStoreError> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    read_inputs_at(conn, now_ms)
}

/// Reads the current mode inputs from `app_state` for a specified timestamp.
pub fn read_inputs_at(conn: &Connection, now_ms: i64) -> Result<ModeInputs, LicenceStoreError> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM app_state WHERE key IN ('last_checkin_ms', 'device_id', 'tenant_id', 'max_seen_ms')",
    )?;

    let mut last_checkin_ms: i64 = 0;
    let mut device_id = String::new();
    let mut tenant_id_in_db = String::new();
    let mut max_seen_ms: i64 = 0;

    let rows = stmt.query_map([], |row| {
        let k: String = row.get(0)?;
        let v: String = row.get(1)?;
        Ok((k, v))
    })?;

    for item in rows {
        let (k, v) = item?;
        match k.as_str() {
            "last_checkin_ms" => last_checkin_ms = v.parse().unwrap_or(0),
            "device_id" => device_id = v,
            "tenant_id" => tenant_id_in_db = v,
            "max_seen_ms" => max_seen_ms = v.parse().unwrap_or(0),
            _ => {}
        }
    }

    Ok(ModeInputs {
        now_ms,
        last_checkin_ms,
        device_id,
        tenant_id_in_db,
        max_seen_ms,
    })
}

/// Sets the device ID in `app_state`.
pub fn set_device_id(
    conn: &Connection,
    device_id: &str,
    now_ms: i64,
) -> Result<(), LicenceStoreError> {
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('device_id', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![device_id, now_ms],
    )?;
    Ok(())
}

/// Sets the tenant ID in `app_state`.
pub fn set_tenant_id(
    conn: &Connection,
    tenant_id: &str,
    now_ms: i64,
) -> Result<(), LicenceStoreError> {
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('tenant_id', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![tenant_id, now_ms],
    )?;
    Ok(())
}

/// Sets the last check-in timestamp in `app_state`.
pub fn set_last_checkin_ms(
    conn: &Connection,
    last_checkin: i64,
    now_ms: i64,
) -> Result<(), LicenceStoreError> {
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('last_checkin_ms', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
        params![last_checkin.to_string(), now_ms],
    )?;
    Ok(())
}
