//! Auth IPC Commands for OmniBill
//!
//! Provides login, session validation, logout, and access state queries.

use crate::access::guard::{AppAuthState, authorize};
use crate::access::users::{
    AuthError, AuthenticatedUser, authenticate, change_password as user_change_password,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: AuthenticatedUser,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BootStateResponse {
    pub has_primary_owner: bool,
    pub vertical: String,
    pub plan: String,
}

// #[tauri::command]
pub fn login(
    state: &AppAuthState,
    conn: &Connection,
    username: &str,
    password: &str,
    now_ms: i64,
) -> Result<LoginResponse, String> {
    let auth_user = authenticate(conn, username, password, now_ms).map_err(|e| match e {
        AuthError::InvalidCredentials => "Invalid username or password".to_string(),
        AuthError::Locked { until_ms } => format!("Account locked until {}", until_ms),
        AuthError::Database(d) => format!("Database error: {}", d),
        _ => "Authentication error".to_string(),
    })?;

    let token = state
        .session_mgr
        .open(&auth_user, now_ms)
        .map_err(|e| e.to_string())?;

    Ok(LoginResponse {
        token,
        user: auth_user,
    })
}

// #[tauri::command]
pub fn get_boot_state(
    state: &AppAuthState,
    conn: &Connection,
) -> Result<BootStateResponse, String> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM app_users WHERE role = 'owner' AND is_active = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    Ok(BootStateResponse {
        has_primary_owner: count > 0,
        vertical: state.vertical.clone(),
        plan: "pro".to_string(),
    })
}

// #[tauri::command]
pub fn logout(state: &AppAuthState, token: Option<&str>, now_ms: i64) -> Result<(), String> {
    let _auth =
        authorize(&state.as_guard_context(), token, "logout", now_ms).map_err(|e| e.to_string())?;
    if let Some(t) = token {
        let _ = state.session_mgr.close(t);
    }
    Ok(())
}

// #[tauri::command]
pub fn change_password(
    state: &AppAuthState,
    conn: &mut Connection,
    token: Option<&str>,
    old_pw: &str,
    new_pw: &str,
    now_ms: i64,
) -> Result<(), String> {
    let auth = authorize(&state.as_guard_context(), token, "change_password", now_ms)
        .map_err(|e| e.to_string())?;

    let uid = auth.user_id.ok_or_else(|| "User ID missing".to_string())?;

    user_change_password(conn, uid, old_pw, new_pw, now_ms).map_err(|e| match e {
        AuthError::PasswordStrength(err) => err.to_string(),
        AuthError::InvalidCredentials => "Current password is incorrect".to_string(),
        _ => "Failed to change password".to_string(),
    })?;

    Ok(())
}

// #[tauri::command]
pub fn get_access_status(
    state: &AppAuthState,
    token: Option<&str>,
    now_ms: i64,
) -> Result<serde_json::Value, String> {
    let auth = authorize(
        &state.as_guard_context(),
        token,
        "get_access_status",
        now_ms,
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "user_id": auth.user_id,
        "username": auth.username,
        "role": auth.role,
        "vertical": state.vertical,
        "is_primary_owner": auth.is_primary_owner,
    }))
}
