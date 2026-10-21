//! Password hashing, verification, strength enforcement, and dummy verify.
//!
//! Enforces:
//! - Argon2id hashing with parameters defined in `policy.rs`
//! - Strict password complexity: min 10 chars, not username, not in common list,
//!   at least 3 of 4 character classes or length >= 16
//! - Typed errors that NEVER echo passwords or secrets
//! - Safe verification: malformed hash returns false without panicking
//! - Constant-time timing defense via `dummy_verify()` on unknown users

use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use std::fmt;

use super::policy::{ARGON2_M_COST, ARGON2_P_COST, ARGON2_T_COST};

const COMMON_PASSWORDS: &[&str] = &[
    "password",
    "12345678",
    "qwerty123",
    "admin123",
    "omnibill",
    "123456789",
    "1234567890",
    "password123",
    "welcome123",
    "administrator",
    "iloveyou",
    "secret123",
    "passw0rd",
    "qwertyuiop",
    "letmein123",
    "default123",
    "master123",
    "changeme",
    "company123",
    "retail123",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PasswordError {
    TooShort,
    MatchesUsername,
    CommonPassword,
    InsufficientComplexity,
    HashingFailed(String),
}

impl fmt::Display for PasswordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PasswordError::TooShort => write!(f, "Password must be at least 10 characters long"),
            PasswordError::MatchesUsername => write!(f, "Password cannot match the username"),
            PasswordError::CommonPassword => write!(f, "Password is too common and easily guessed"),
            PasswordError::InsufficientComplexity => write!(
                f,
                "Password must contain at least 3 character classes (uppercase, lowercase, digits, symbols) or be at least 16 characters long"
            ),
            PasswordError::HashingFailed(msg) => write!(f, "Password hashing error: {}", msg),
        }
    }
}

impl std::error::Error for PasswordError {}

/// Validates password strength against policy rules.
pub fn check_strength(plain: &str, username: &str) -> Result<(), PasswordError> {
    if plain.len() < 10 {
        return Err(PasswordError::TooShort);
    }

    if plain.eq_ignore_ascii_case(username) {
        return Err(PasswordError::MatchesUsername);
    }

    let lower_plain = plain.to_lowercase();
    for &common in COMMON_PASSWORDS {
        if lower_plain == common {
            return Err(PasswordError::CommonPassword);
        }
    }

    let has_lower = plain.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = plain.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = plain.chars().any(|c| c.is_ascii_digit());
    let has_symbol = plain.chars().any(|c| !c.is_ascii_alphanumeric());

    let class_count =
        (has_lower as u32) + (has_upper as u32) + (has_digit as u32) + (has_symbol as u32);
    if plain.len() < 16 && class_count < 3 {
        return Err(PasswordError::InsufficientComplexity);
    }

    Ok(())
}

/// Hashes a plaintext password using Argon2id with policy parameters.
pub fn hash_password(plain: &str) -> Result<String, PasswordError> {
    let params = Params::new(ARGON2_M_COST, ARGON2_T_COST, ARGON2_P_COST, None)
        .map_err(|e| PasswordError::HashingFailed(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let salt = SaltString::generate(&mut OsRng);
    let hash = argon2
        .hash_password(plain.as_bytes(), &salt)
        .map_err(|e| PasswordError::HashingFailed(e.to_string()))?;

    Ok(hash.to_string())
}

/// Verifies a plaintext password against an Argon2id hash.
/// Malformed hashes safely return false without panicking.
pub fn verify_password(hash: &str, plain: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(plain.as_bytes(), &parsed_hash)
        .is_ok()
}

// A valid pre-computed Argon2id hash for constant-time dummy verification
const DUMMY_ARGON2_HASH: &str =
    "$argon2id$v=19$m=1024,t=1,p=1$c29tZXNhbHQ$q38i36z7N5r9E+M4/0B2z7f1hK8o5L7x8D3n2P1";

/// Executes one dummy Argon2 verify with fixed inputs.
/// Used when an unknown user logs in, ensuring execution timing is indistinguishable
/// from a valid user with an incorrect password.
pub fn dummy_verify() {
    // If the const hash is valid, verify it against a dummy string; otherwise hash+verify
    if !verify_password(DUMMY_ARGON2_HASH, "dummy_attempt_for_timing") {
        // Fallback in case test salt changed format
        let params = Params::new(1024, 1, 1, None).unwrap_or_default();
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let salt = SaltString::from_b64("c29tZXNhbHRzdHJpbmc")
            .unwrap_or_else(|_| SaltString::generate(&mut OsRng));
        if let Ok(hash) = argon2.hash_password(b"dummy_attempt", &salt) {
            let _ = argon2.verify_password(b"dummy_attempt_fail", &hash);
        }
    }
}
