//! In-memory Session Manager for OmniBill.
//!
//! Stores active sessions in memory, indexed by the SHA-256 hash of their
//! random 256-bit URL-safe Base64 token.
//!
//! Enforces:
//! - Random token generation via `rand::rngs::OsRng` (never weak PRNG or time)
//! - Zero storage of raw tokens in memory or database (only SHA-256 digest is retained)
//! - Idle timeout (default: 15 minutes) with activity refresh
//! - Absolute session lifetime limit (default: 12 hours)
//! - Targeted single-session termination and bulk user invalidation

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use super::policy::{SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES};
use super::users::AuthenticatedUser;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub token_hash: [u8; 32],
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_primary_owner: bool,
    pub must_change_password: bool,
    pub created_ms: i64,
    pub last_seen_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    InvalidSession,
    IdleTimeout,
    AbsoluteTimeout,
    LockError,
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SessionError::InvalidSession => write!(f, "Invalid session token"),
            SessionError::IdleTimeout => write!(f, "Session expired due to inactivity"),
            SessionError::AbsoluteTimeout => write!(f, "Session expired due to maximum lifetime"),
            SessionError::LockError => write!(f, "Internal lock contention error"),
        }
    }
}

impl std::error::Error for SessionError {}

/// Computes SHA-256 digest of a token string.
pub fn hash_token(token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.finalize().into()
}

pub struct SessionManager {
    sessions: Mutex<HashMap<[u8; 32], Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Opens a new session for the given user, returning the raw URL-safe Base64 token.
    /// Only the SHA-256 hash of the token is retained in memory.
    pub fn open(&self, user: &AuthenticatedUser, now_ms: i64) -> Result<String, SessionError> {
        let mut raw_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut raw_bytes);
        let token = URL_SAFE_NO_PAD.encode(raw_bytes);
        let token_hash = hash_token(&token);

        let session = Session {
            token_hash,
            user_id: user.id,
            username: user.username.clone(),
            display_name: user.display_name.clone(),
            role: user.role.clone(),
            is_primary_owner: user.is_primary_owner,
            must_change_password: user.must_change_password,
            created_ms: now_ms,
            last_seen_ms: now_ms,
        };

        let mut lock = self.sessions.lock().map_err(|_| SessionError::LockError)?;
        lock.insert(token_hash, session);

        Ok(token)
    }

    /// Validates an incoming session token, enforcing idle and absolute limits.
    /// Refreshes the idle timestamp on successful validation.
    pub fn validate(&self, token: &str, now_ms: i64) -> Result<Session, SessionError> {
        let token_hash = hash_token(token);
        let mut lock = self.sessions.lock().map_err(|_| SessionError::LockError)?;

        let session = match lock.get_mut(&token_hash) {
            Some(s) => s,
            None => return Err(SessionError::InvalidSession),
        };

        let idle_limit_ms = SESSION_IDLE_MINUTES * 60_000;
        let abs_limit_ms = SESSION_ABSOLUTE_HOURS * 3_600_000;

        // Check idle limit
        if now_ms.saturating_sub(session.last_seen_ms) > idle_limit_ms {
            lock.remove(&token_hash);
            return Err(SessionError::IdleTimeout);
        }

        // Check absolute limit
        if now_ms.saturating_sub(session.created_ms) > abs_limit_ms {
            lock.remove(&token_hash);
            return Err(SessionError::AbsoluteTimeout);
        }

        // Refresh idle timer
        session.last_seen_ms = now_ms;
        Ok(session.clone())
    }

    /// Closes a single active session by token.
    pub fn close(&self, token: &str) -> Result<(), SessionError> {
        let token_hash = hash_token(token);
        let mut lock = self.sessions.lock().map_err(|_| SessionError::LockError)?;
        lock.remove(&token_hash);
        Ok(())
    }

    /// Closes all active sessions belonging to the specified user ID.
    pub fn close_all_for_user(&self, user_id: i64) -> Result<usize, SessionError> {
        let mut lock = self.sessions.lock().map_err(|_| SessionError::LockError)?;
        let before_count = lock.len();
        lock.retain(|_, s| s.user_id != user_id);
        Ok(before_count.saturating_sub(lock.len()))
    }

    /// Returns the count of currently active sessions.
    pub fn active_count(&self) -> Result<usize, SessionError> {
        let lock = self.sessions.lock().map_err(|_| SessionError::LockError)?;
        Ok(lock.len())
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}
