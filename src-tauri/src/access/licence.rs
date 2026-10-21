//! Cryptographic licence format, Ed25519 signature verification,
//! operating mode computation (`Full`, `ReadOnly`, `Unlicensed`), and export/print policies.
//!
//! All time calculations are strictly parameter-driven; zero hidden clocks.
//! Zero floating-point arithmetic.

use base64::Engine;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::civil;
use super::policy::CLOCK_ROLLBACK_TOLERANCE_MIN;

/// Licence payload representation with strictly ordered fields.
/// Canonical serialization uses `serde_json::to_vec` on this struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicencePayload {
    pub v: u32,
    pub tenant_id: String,
    pub business_name: String,
    pub vertical: String,
    pub plan: String,
    pub features: Vec<String>,
    pub max_counters: u32,
    pub device_id: String,
    pub serial: u64,
    pub issued_ms: i64,
    pub valid_until_day: i64,
    pub offline_days: u32,
    pub grace_days: u32,
    pub status: String,
    pub export_permit_until_ms: i64,
    pub support_text: String,
}

/// Licence envelope containing the structured payload and its base64url Ed25519 signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Licence {
    pub payload: LicencePayload,
    pub sig: String,
    #[serde(skip)]
    pub raw_payload_bytes: Option<Vec<u8>>,
}

/// Specific reasons why OmniBill has entered read-only mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Reason {
    BadSignature,
    WrongDevice,
    WrongTenant,
    Suspended,
    ClockTampered,
    Expired,
    CheckinRequired,
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Reason::BadSignature => {
                write!(f, "Invalid cryptographic signature or tampered licence")
            }
            Reason::WrongDevice => write!(f, "Licence is registered to a different device"),
            Reason::WrongTenant => write!(f, "Licence tenant ID does not match local database"),
            Reason::Suspended => write!(f, "Subscription is currently suspended"),
            Reason::ClockTampered => write!(f, "System clock rollback detected"),
            Reason::Expired => write!(f, "Subscription has expired"),
            Reason::CheckinRequired => write!(f, "Periodic online check-in required"),
        }
    }
}

/// Operating mode of OmniBill determined from licence status and time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    Full,
    ReadOnly(Reason),
    Unlicensed,
}

/// Input parameters for evaluating system operating mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeInputs {
    pub now_ms: i64,
    pub last_checkin_ms: i64,
    pub device_id: String,
    pub tenant_id_in_db: String,
    pub max_seen_ms: i64,
}

/// Errors occurring during licence operations or verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LicenceError {
    BadSignature,
    ReserializationMismatch(String),
    InvalidVendorKey(String),
    Serialization(String),
    Parse(String),
    UnsupportedVersion(u32),
    InvalidPayload(String),
}

impl std::fmt::Display for LicenceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenceError::BadSignature => write!(f, "Invalid cryptographic signature"),
            LicenceError::ReserializationMismatch(msg) => {
                write!(f, "Payload re-serialization mismatch: {}", msg)
            }
            LicenceError::InvalidVendorKey(msg) => write!(f, "Invalid vendor public key: {}", msg),
            LicenceError::Serialization(msg) => write!(f, "Serialization error: {}", msg),
            LicenceError::Parse(msg) => write!(f, "Parse error: {}", msg),
            LicenceError::UnsupportedVersion(v) => write!(f, "Unsupported licence version: {}", v),
            LicenceError::InvalidPayload(msg) => write!(f, "Invalid payload: {}", msg),
        }
    }
}

impl std::error::Error for LicenceError {}

/// Extracts the raw JSON byte sequence of the `"payload"` field from a licence JSON string.
pub fn extract_raw_payload(json: &str) -> Option<&[u8]> {
    let bytes = json.as_bytes();
    let key = b"\"payload\"";
    let mut i = 0;
    while i + key.len() <= bytes.len() {
        if &bytes[i..i + key.len()] == key {
            i += key.len();
            while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b':') {
                i += 1;
            }
            if i >= bytes.len() {
                return None;
            }
            let start = i;
            if bytes[i] == b'{' {
                let mut depth = 0;
                let mut in_str = false;
                let mut escape = false;
                while i < bytes.len() {
                    let b = bytes[i];
                    if escape {
                        escape = false;
                    } else if b == b'\\' && in_str {
                        escape = true;
                    } else if b == b'"' {
                        in_str = !in_str;
                    } else if !in_str {
                        if b == b'{' {
                            depth += 1;
                        } else if b == b'}' {
                            depth -= 1;
                            if depth == 0 {
                                return Some(&bytes[start..=i]);
                            }
                        }
                    }
                    i += 1;
                }
                return None;
            }
        }
        i += 1;
    }
    None
}

impl Licence {
    pub fn new(payload: LicencePayload, sig: String) -> Self {
        Self {
            payload,
            sig,
            raw_payload_bytes: None,
        }
    }

    pub fn with_raw_bytes(payload: LicencePayload, sig: String, raw_bytes: Vec<u8>) -> Self {
        Self {
            payload,
            sig,
            raw_payload_bytes: Some(raw_bytes),
        }
    }

    /// Parses a Licence from JSON string, preserving the exact raw bytes of the payload for re-serialization validation.
    pub fn from_json(json_str: &str) -> Result<Self, LicenceError> {
        let mut licence: Licence =
            serde_json::from_str(json_str).map_err(|e| LicenceError::Parse(e.to_string()))?;
        if let Some(raw) = extract_raw_payload(json_str) {
            licence.raw_payload_bytes = Some(raw.to_vec());
        }
        Ok(licence)
    }

    /// Computes the canonical byte sequence of this licence payload.
    ///
    /// Requirements:
    /// - `features` must be sorted ascending and deduplicated.
    /// - Serialized via `serde_json::to_vec` with fixed struct field order.
    pub fn canonical_payload_bytes(&self) -> Result<Vec<u8>, LicenceError> {
        let mut sorted_features = self.payload.features.clone();
        sorted_features.sort();
        sorted_features.dedup();
        if self.payload.features != sorted_features {
            return Err(LicenceError::ReserializationMismatch(
                "Features array is not sorted ascending or contains duplicates".into(),
            ));
        }

        serde_json::to_vec(&self.payload).map_err(|e| LicenceError::Serialization(e.to_string()))
    }

    /// Verifies the cryptographic signature of the licence against the canonical representation
    /// of its payload using Ed25519.
    ///
    /// Security against tampering and smuggling:
    /// 1. Re-serialization verification: The parsed `LicencePayload` is re-serialized into its
    ///    canonical JSON byte sequence (`serde_json::to_vec`). If raw payload bytes were captured
    ///    upon deserialization, they must match this canonical byte sequence byte-for-byte. Any extra,
    ///    missing, re-ordered fields, or formatting variations are rejected as a re-serialization mismatch.
    /// 2. Feature list canonicalization: `features` must be strictly sorted ascending and de-duplicated.
    /// 3. Ed25519 signature verification: The signature (base64url decoded) is verified against
    ///    the canonical payload bytes using the provided verifying key.
    pub fn verify(&self, key: &VerifyingKey) -> Result<(), LicenceError> {
        if self.payload.v != 1 {
            return Err(LicenceError::UnsupportedVersion(self.payload.v));
        }

        if self.payload.support_text.chars().count() > 120 {
            return Err(LicenceError::InvalidPayload(
                "support_text exceeds 120 chars".into(),
            ));
        }

        let canonical_bytes = self.canonical_payload_bytes()?;

        if let Some(ref raw) = self.raw_payload_bytes
            && raw != &canonical_bytes
        {
            return Err(LicenceError::ReserializationMismatch(
                "Raw payload bytes differ from canonical re-serialization".into(),
            ));
        }

        let sig_bytes = URL_SAFE_NO_PAD
            .decode(&self.sig)
            .or_else(|_| URL_SAFE.decode(&self.sig))
            .map_err(|_| LicenceError::BadSignature)?;

        if sig_bytes.len() != 64 {
            return Err(LicenceError::BadSignature);
        }

        let sig = Signature::from_slice(&sig_bytes).map_err(|_| LicenceError::BadSignature)?;

        key.verify(&canonical_bytes, &sig)
            .map_err(|_| LicenceError::BadSignature)?;

        Ok(())
    }
}

/// Parses an Ed25519 verifying key from 32 raw bytes.
/// Rejects all-zero keys or keys with invalid byte length.
pub fn parse_verifying_key(bytes: &[u8]) -> Result<VerifyingKey, LicenceError> {
    if bytes.len() != 32 || bytes.iter().all(|&b| b == 0) {
        return Err(LicenceError::InvalidVendorKey(
            "Vendor public key is all zeros or invalid length".into(),
        ));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    VerifyingKey::from_bytes(&arr)
        .map_err(|e| LicenceError::InvalidVendorKey(format!("Unparsable vendor key: {}", e)))
}

/// Loads the embedded vendor public key.
/// If all zeros or unparsable, returns Err.
pub fn vendor_key() -> Result<VerifyingKey, LicenceError> {
    parse_verifying_key(include_bytes!("../../keys/vendor_public.bin"))
}

/// Computes the system operating mode based on licence verification, tenant/device matching,
/// clock integrity, subscription validity, and check-in timeliness.
///
/// Evaluation order:
/// 1. no licence -> `Unlicensed`
/// 2. bad signature or re-serialization mismatch -> `ReadOnly(BadSignature)`
/// 3. device_id mismatch -> `ReadOnly(WrongDevice)`
/// 4. tenant_id != tenant_id_in_db -> `ReadOnly(WrongTenant)`
/// 5. status == "suspended" -> `ReadOnly(Suspended)`
/// 6. now_ms + CLOCK_ROLLBACK_TOLERANCE_MIN*60_000 < max_seen_ms -> `ReadOnly(ClockTampered)`
/// 7. ist_day(now_ms) > valid_until_day + grace_days -> `ReadOnly(Expired)`
/// 8. now_ms > last_checkin_ms + offline_days*86_400_000 -> `ReadOnly(CheckinRequired)`
/// 9. else `Full`
pub fn compute_mode(licence: Option<&Licence>, key: &VerifyingKey, ctx: &ModeInputs) -> Mode {
    let licence = match licence {
        Some(l) => l,
        None => return Mode::Unlicensed,
    };

    if licence.verify(key).is_err() {
        return Mode::ReadOnly(Reason::BadSignature);
    }

    if licence.payload.device_id != ctx.device_id {
        return Mode::ReadOnly(Reason::WrongDevice);
    }

    if licence.payload.tenant_id != ctx.tenant_id_in_db {
        return Mode::ReadOnly(Reason::WrongTenant);
    }

    if licence.payload.status == "suspended" {
        return Mode::ReadOnly(Reason::Suspended);
    }

    let rollback_limit = ctx
        .now_ms
        .checked_add(
            CLOCK_ROLLBACK_TOLERANCE_MIN
                .checked_mul(60_000)
                .unwrap_or(600_000),
        )
        .unwrap_or(i64::MAX);
    if rollback_limit < ctx.max_seen_ms {
        return Mode::ReadOnly(Reason::ClockTampered);
    }

    let current_day = civil::ist_day(ctx.now_ms);
    let allowed_until_day = licence
        .payload
        .valid_until_day
        .checked_add(licence.payload.grace_days as i64)
        .unwrap_or(licence.payload.valid_until_day);
    if current_day > allowed_until_day {
        return Mode::ReadOnly(Reason::Expired);
    }

    let offline_window_ms = (licence.payload.offline_days as i64)
        .checked_mul(86_400_000)
        .unwrap_or(i64::MAX);
    let checkin_deadline = ctx
        .last_checkin_ms
        .checked_add(offline_window_ms)
        .unwrap_or(i64::MAX);
    if ctx.now_ms > checkin_deadline {
        return Mode::ReadOnly(Reason::CheckinRequired);
    }

    Mode::Full
}

/// Computes operating mode using the embedded vendor key, failing closed to `ReadOnly(BadSignature)`
/// if the key is all zeros or unparsable.
pub fn compute_mode_default(licence: Option<&Licence>, ctx: &ModeInputs) -> Mode {
    match vendor_key() {
        Ok(key) => compute_mode(licence, &key, ctx),
        Err(_) => Mode::ReadOnly(Reason::BadSignature),
    }
}

/// Evaluates whether export operations are allowed.
///
/// Returns true if:
/// - Mode is `Full` (the guard checks the specific export feature permission per command), OR
/// - The verified payload has `export_permit_until_ms > now_ms` (permit works even in
///   `ReadOnly(Expired|Suspended|CheckinRequired)` but NEVER when `BadSignature`, `WrongDevice`,
///   `WrongTenant`, `ClockTampered`, or `Unlicensed`).
pub fn export_allowed(
    licence: Option<&Licence>,
    key: &VerifyingKey,
    mode: &Mode,
    now_ms: i64,
) -> bool {
    if *mode == Mode::Full {
        return true;
    }

    match mode {
        Mode::ReadOnly(Reason::Expired)
        | Mode::ReadOnly(Reason::Suspended)
        | Mode::ReadOnly(Reason::CheckinRequired) => {}
        _ => return false,
    }

    let licence = match licence {
        Some(l) => l,
        None => return false,
    };

    if licence.verify(key).is_err() {
        return false;
    }

    licence.payload.export_permit_until_ms > now_ms
}

/// Evaluates whether printing is allowed.
/// Printing is strictly permitted only in `Mode::Full`; never in read-only or with permits.
pub fn print_allowed(mode: &Mode) -> bool {
    *mode == Mode::Full
}
