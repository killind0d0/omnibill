//! Auth Audit Event Logger.
//!
//! Records and exposes access-control audit events:
//! - auth.login_ok
//! - auth.login_fail (username only; "unknown" if user absent; never passwords)
//! - auth.locked
//! - auth.logout
//! - auth.password_changed
//! - auth.user_created
//! - auth.user_deactivated
//! - auth.role_changed
//! - auth.password_reset
//! - auth.owner_reset

use rusqlite::Connection;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthAuditEvent {
    pub event_type: String,
    pub username: String,
    pub detail: String,
    pub timestamp_ms: i64,
}

static AUDIT_LOG: Mutex<Vec<AuthAuditEvent>> = Mutex::new(Vec::new());

/// Records an access control audit event.
/// Plaintext passwords, tokens, and secret data are strictly prohibited.
pub fn record_auth_event(
    _conn: Option<&Connection>,
    now_ms: i64,
    event_type: &str,
    username: &str,
    detail: &str,
) {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.push(AuthAuditEvent {
            event_type: event_type.to_string(),
            username: username.to_string(),
            detail: detail.to_string(),
            timestamp_ms: now_ms,
        });
    }
}

/// Returns a clone of all recorded audit events (useful for tests and verification).
pub fn get_audit_events() -> Vec<AuthAuditEvent> {
    AUDIT_LOG.lock().map(|l| l.clone()).unwrap_or_default()
}

/// Clears in-memory audit events.
pub fn clear_audit_events() {
    if let Ok(mut log) = AUDIT_LOG.lock() {
        log.clear();
    }
}
