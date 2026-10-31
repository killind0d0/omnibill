use argon2::password_hash::rand_core::OsRng as ArgonRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use crypto_box::aead::generic_array::GenericArray;
use crypto_box::aead::{Aead, AeadCore};
use crypto_box::{SalsaBox, SecretKey};
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use totp_rs::{Algorithm, Builder, Secret, Totp};

pub const SESSION_IDLE_TIMEOUT_MS: i64 = 30 * 60 * 1000; // 30 minutes
pub const LOCKOUT_THRESHOLD: i64 = 5;
pub const LOCKOUT_DURATION_MS: i64 = 15 * 60 * 1000; // 15 minutes
pub const RECOVERY_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Password hashing error: {0}")]
    PasswordHash(String),
    #[error("Invalid username or password")]
    InvalidCredentials,
    #[error("Account is locked out until timestamp {0}")]
    LockedOut(i64),
    #[error("Invalid TOTP code or recovery code")]
    Invalid2Fa,
    #[error("TOTP code has already been used (replay detected)")]
    TotpReplay,
    #[error("Missing TOTP code or recovery code")]
    Missing2Fa,
    #[error("TOTP configuration error: {0}")]
    Totp(String),
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Unauthorized: valid admin session required")]
    Unauthorized,
    #[error("Forbidden: missing or invalid X-OmniBill-Admin header")]
    MissingAdminHeader,
    #[error("Admin already exists (use --allow-second to bypass)")]
    AdminAlreadyExists,
    #[error("Admin user not found")]
    AdminNotFound,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            AuthError::InvalidCredentials => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::Invalid2Fa => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::TotpReplay => (StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::Missing2Fa => (StatusCode::BAD_REQUEST, self.to_string()),
            AuthError::LockedOut(_) => (StatusCode::FORBIDDEN, self.to_string()),
            AuthError::MissingAdminHeader => (StatusCode::FORBIDDEN, self.to_string()),
            AuthError::AdminAlreadyExists => (StatusCode::CONFLICT, self.to_string()),
            AuthError::AdminNotFound => (StatusCode::NOT_FOUND, self.to_string()),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            ),
        };

        let body = Json(serde_json::json!({
            "error": msg
        }));
        (status, body).into_response()
    }
}

pub fn hash_password(password: &str) -> Result<String, AuthError> {
    let salt = SaltString::generate(&mut ArgonRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AuthError::PasswordHash(e.to_string()))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn generate_recovery_code() -> String {
    let mut rng = OsRng;
    let mut code = String::with_capacity(14);
    for i in 0..12 {
        if i == 4 || i == 8 {
            code.push('-');
        }
        let idx = (rng.next_u32() as usize) % RECOVERY_ALPHABET.len();
        code.push(RECOVERY_ALPHABET[idx] as char);
    }
    code
}

pub fn derive_secret_box(server_secret: &str) -> SalsaBox {
    let mut hasher = Sha256::new();
    hasher.update(b"omnibill-control-plane-totp-kdf:");
    hasher.update(server_secret.as_bytes());
    let key_bytes: [u8; 32] = hasher.finalize().into();

    let sk = SecretKey::from(key_bytes);
    let pk = sk.public_key();
    SalsaBox::new(&pk, &sk)
}

pub fn encrypt_totp_secret(secret_bytes: &[u8], server_secret: &str) -> Result<Vec<u8>, AuthError> {
    let sbox = derive_secret_box(server_secret);
    let nonce = SalsaBox::generate_nonce(&mut OsRng);
    let ciphertext = sbox
        .encrypt(&nonce, secret_bytes)
        .map_err(|e| AuthError::Crypto(e.to_string()))?;

    let mut out = Vec::with_capacity(nonce.len() + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_totp_secret(blob: &[u8], server_secret: &str) -> Result<Vec<u8>, AuthError> {
    if blob.len() < 24 {
        return Err(AuthError::Crypto("Ciphertext too short".into()));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(24);
    let nonce = GenericArray::from_slice(nonce_bytes);

    let sbox = derive_secret_box(server_secret);
    sbox.decrypt(nonce, ciphertext)
        .map_err(|e| AuthError::Crypto(e.to_string()))
}

pub fn build_totp(secret_bytes: &[u8], username: &str) -> Result<Totp, AuthError> {
    let secret = Secret::new(secret_bytes.to_vec().into_boxed_slice());
    Builder::new()
        .with_algorithm(Algorithm::SHA1)
        .with_digits(6)
        .with_skew(1)
        .with_step_duration(30)
        .with_issuer("OmniBill".into())
        .with_account_name(username)
        .with_secret(secret)
        .build()
        .map_err(|e| AuthError::Totp(e.to_string()))
}

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
    #[serde(default, alias = "totp_code")]
    pub totp: Option<String>,
    #[serde(default)]
    pub recovery_code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginSuccess {
    pub success: bool,
    pub admin_id: i64,
    pub username: String,
}

pub struct CreatedAdmin {
    pub admin_id: i64,
    pub totp_uri: String,
    pub recovery_codes: [String; 8],
}

pub fn create_admin(
    conn: &Connection,
    username: &str,
    password: &str,
    server_secret: &str,
    now_ms: i64,
    allow_second: bool,
) -> Result<CreatedAdmin, AuthError> {
    let existing_count: i64 = conn.query_row("SELECT count(*) FROM admins", [], |r| r.get(0))?;
    if existing_count > 0 && !allow_second {
        return Err(AuthError::AdminAlreadyExists);
    }

    let mut totp_secret_raw = [0u8; 20];
    OsRng.fill_bytes(&mut totp_secret_raw);

    let totp = build_totp(&totp_secret_raw, username)?;
    let totp_uri = totp.to_url().map_err(|e| AuthError::Totp(e.to_string()))?;

    let totp_secret_enc = encrypt_totp_secret(&totp_secret_raw, server_secret)?;
    let pw_hash = hash_password(password)?;

    conn.execute(
        "INSERT INTO admins (username, password_hash, totp_secret_enc, last_totp_step, failed_attempts, locked_until_ms, created_ms)
         VALUES (?1, ?2, ?3, 0, 0, 0, ?4)",
        params![username, pw_hash, totp_secret_enc, now_ms],
    )?;
    let admin_id = conn.last_insert_rowid();

    let mut codes = Vec::with_capacity(8);
    for _ in 0..8 {
        let code = generate_recovery_code();
        let code_hash = hash_password(&code)?;
        conn.execute(
            "INSERT INTO admin_recovery_codes (admin_id, code_hash, used_ms) VALUES (?1, ?2, 0)",
            params![admin_id, code_hash],
        )?;
        codes.push(code);
    }

    crate::db::append_audit(
        conn,
        Some(admin_id),
        "admin.create",
        None,
        &format!("Created super-user admin {}", username),
        now_ms,
    )?;

    let recovery_arr: [String; 8] = codes
        .try_into()
        .map_err(|_| AuthError::Crypto("Recovery codes len error".into()))?;

    Ok(CreatedAdmin {
        admin_id,
        totp_uri,
        recovery_codes: recovery_arr,
    })
}

pub fn reset_admin_totp(
    conn: &Connection,
    username: &str,
    server_secret: &str,
    now_ms: i64,
) -> Result<CreatedAdmin, AuthError> {
    let admin_id: i64 = match conn.query_row(
        "SELECT id FROM admins WHERE username = ?1",
        params![username],
        |r| r.get(0),
    ) {
        Ok(id) => id,
        Err(_) => return Err(AuthError::AdminNotFound),
    };

    let mut totp_secret_raw = [0u8; 20];
    OsRng.fill_bytes(&mut totp_secret_raw);

    let totp = build_totp(&totp_secret_raw, username)?;
    let totp_uri = totp.to_url().map_err(|e| AuthError::Totp(e.to_string()))?;

    let totp_secret_enc = encrypt_totp_secret(&totp_secret_raw, server_secret)?;

    conn.execute(
        "UPDATE admins SET totp_secret_enc = ?1, last_totp_step = 0, failed_attempts = 0, locked_until_ms = 0 WHERE id = ?2",
        params![totp_secret_enc, admin_id],
    )?;

    conn.execute(
        "DELETE FROM admin_recovery_codes WHERE admin_id = ?1",
        params![admin_id],
    )?;

    let mut codes = Vec::with_capacity(8);
    for _ in 0..8 {
        let code = generate_recovery_code();
        let code_hash = hash_password(&code)?;
        conn.execute(
            "INSERT INTO admin_recovery_codes (admin_id, code_hash, used_ms) VALUES (?1, ?2, 0)",
            params![admin_id, code_hash],
        )?;
        codes.push(code);
    }

    crate::db::append_audit(
        conn,
        Some(admin_id),
        "admin.totp_reset",
        None,
        &format!("Reset TOTP and recovery codes for admin {}", username),
        now_ms,
    )?;

    let recovery_arr: [String; 8] = codes
        .try_into()
        .map_err(|_| AuthError::Crypto("Recovery codes len error".into()))?;

    Ok(CreatedAdmin {
        admin_id,
        totp_uri,
        recovery_codes: recovery_arr,
    })
}

pub fn verify_admin_login(
    conn: &Connection,
    payload: &LoginPayload,
    server_secret: &str,
    now_ms: i64,
) -> Result<(i64, String), AuthError> {
    let admin_row: Option<(i64, String, Vec<u8>, i64, i64, i64)> = conn
        .query_row(
            "SELECT id, password_hash, totp_secret_enc, last_totp_step, failed_attempts, locked_until_ms
             FROM admins WHERE username = ?1",
            params![payload.username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .ok();

    let (admin_id, pw_hash, totp_enc, last_totp_step, failed_attempts, locked_until_ms) =
        match admin_row {
            Some(row) => row,
            None => return Err(AuthError::InvalidCredentials),
        };

    // Lockout check
    if locked_until_ms > now_ms {
        return Err(AuthError::LockedOut(locked_until_ms));
    }

    let register_failure = |conn: &Connection| -> Result<(), AuthError> {
        let new_failed = failed_attempts + 1;
        let new_locked = if new_failed >= LOCKOUT_THRESHOLD {
            now_ms + LOCKOUT_DURATION_MS
        } else {
            0
        };
        conn.execute(
            "UPDATE admins SET failed_attempts = ?1, locked_until_ms = ?2 WHERE id = ?3",
            params![new_failed, new_locked, admin_id],
        )?;
        Ok(())
    };

    // Verify primary password
    if !verify_password(&payload.password, &pw_hash) {
        let _ = register_failure(conn);
        return Err(AuthError::InvalidCredentials);
    }

    // Verify 2FA (optional: recovery code or TOTP if provided)
    let has_recovery = payload.recovery_code.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let has_totp = payload.totp.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let requires_2fa = has_recovery || has_totp;

    let mut authenticated = !requires_2fa;
    let mut new_last_totp_step = last_totp_step;

    if let Some(recovery_code) = &payload.recovery_code {
        let trimmed_code = recovery_code.trim();
        if !trimmed_code.is_empty() {
            let mut stmt = conn.prepare(
                "SELECT id, code_hash FROM admin_recovery_codes WHERE admin_id = ?1 AND used_ms = 0",
            )?;
            let rows = stmt.query_map(params![admin_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;

            let mut matched_id = None;
            for r in rows {
                if let Ok((code_id, hash)) = r {
                    if verify_password(trimmed_code, &hash) {
                        matched_id = Some(code_id);
                        break;
                    }
                }
            }

            if let Some(code_id) = matched_id {
                conn.execute(
                    "UPDATE admin_recovery_codes SET used_ms = ?1 WHERE id = ?2",
                    params![now_ms, code_id],
                )?;
                crate::db::append_audit(
                    conn,
                    Some(admin_id),
                    "admin.recovery_code_used",
                    None,
                    &format!("Recovery code used by admin {}", payload.username),
                    now_ms,
                )?;
                authenticated = true;
            } else {
                let _ = register_failure(conn);
                return Err(AuthError::Invalid2Fa);
            }
        }
    }

    if !authenticated && has_totp {
        if let Some(token) = &payload.totp {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                let secret_raw = decrypt_totp_secret(&totp_enc, server_secret)?;
                let totp = build_totp(&secret_raw, &payload.username)?;
                let now_secs = (now_ms / 1000) as u64;

                match totp.check(trimmed, now_secs) {
                    Some(matched_step) => {
                        let step_i64 = matched_step as i64;
                        if step_i64 <= last_totp_step {
                            let _ = register_failure(conn);
                            return Err(AuthError::TotpReplay);
                        }
                        new_last_totp_step = step_i64;
                        authenticated = true;
                    }
                    None => {
                        let _ = register_failure(conn);
                        return Err(AuthError::Invalid2Fa);
                    }
                }
            }
        }
    }

    if !authenticated {
        return Err(AuthError::Missing2Fa);
    }

    // Success: reset failed attempts & lockout, update last_totp_step
    conn.execute(
        "UPDATE admins SET failed_attempts = 0, locked_until_ms = 0, last_totp_step = ?1 WHERE id = ?2",
        params![new_last_totp_step, admin_id],
    )?;

    // Create session token: 32 random bytes
    let mut token_bytes = [0u8; 32];
    OsRng.fill_bytes(&mut token_bytes);
    let mut token_hex = String::with_capacity(64);
    for b in token_bytes {
        let _ = write!(&mut token_hex, "{:02x}", b);
    }

    let mut hasher = Sha256::new();
    hasher.update(token_hex.as_bytes());
    let token_hash: [u8; 32] = hasher.finalize().into();

    conn.execute(
        "INSERT INTO admin_sessions (id_hash, admin_id, created_ms, last_seen_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![token_hash.as_slice(), admin_id, now_ms, now_ms],
    )?;

    Ok((admin_id, token_hex))
}

pub fn validate_session(
    conn: &Connection,
    token_hex: &str,
    now_ms: i64,
) -> Result<i64, AuthError> {
    let mut hasher = Sha256::new();
    hasher.update(token_hex.trim().as_bytes());
    let token_hash: [u8; 32] = hasher.finalize().into();

    let session: Option<(i64, i64)> = conn
        .query_row(
            "SELECT admin_id, last_seen_ms FROM admin_sessions WHERE id_hash = ?1",
            params![token_hash.as_slice()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let (admin_id, last_seen_ms) = match session {
        Some(s) => s,
        None => return Err(AuthError::Unauthorized),
    };

    if now_ms - last_seen_ms > SESSION_IDLE_TIMEOUT_MS {
        let _ = conn.execute(
            "DELETE FROM admin_sessions WHERE id_hash = ?1",
            params![token_hash.as_slice()],
        );
        return Err(AuthError::Unauthorized);
    }

    // Update last_seen_ms
    let _ = conn.execute(
        "UPDATE admin_sessions SET last_seen_ms = ?1 WHERE id_hash = ?2",
        params![now_ms, token_hash.as_slice()],
    );

    Ok(admin_id)
}

pub fn invalidate_session(conn: &Connection, token_hex: &str) -> Result<(), AuthError> {
    let mut hasher = Sha256::new();
    hasher.update(token_hex.trim().as_bytes());
    let token_hash: [u8; 32] = hasher.finalize().into();
    let _ = conn.execute(
        "DELETE FROM admin_sessions WHERE id_hash = ?1",
        params![token_hash.as_slice()],
    );
    Ok(())
}

pub fn check_mutating_admin_header(method: &Method, headers: &HeaderMap) -> Result<(), AuthError> {
    if method == Method::POST
        || method == Method::PUT
        || method == Method::PATCH
        || method == Method::DELETE
    {
        match headers.get("X-OmniBill-Admin") {
            Some(v) if v == "1" => Ok(()),
            _ => Err(AuthError::MissingAdminHeader),
        }
    } else {
        Ok(())
    }
}
