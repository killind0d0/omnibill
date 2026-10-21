//! Role permission customization IPC commands (Task L2C).

use rusqlite::Connection;

use super::guard::{AppAuthState, authorize};
use super::permissions::Permission;
use super::role_perms::{
    RolePermissionItem, get_role_permissions_impl, reset_role_permissions_impl,
    set_role_permission_impl,
};
use super::roles::Role;

// #[tauri::command]
pub fn get_role_permissions(
    state: &AppAuthState,
    conn: &Connection,
    token: Option<&str>,
    role: &str,
    now_ms: i64,
) -> Result<Vec<RolePermissionItem>, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "get_role_permissions",
        now_ms,
    )
    .map_err(|e| e.to_string())?;

    let parsed_role = Role::parse_role(role).ok_or_else(|| format!("Invalid role '{}'", role))?;

    get_role_permissions_impl(conn, parsed_role, &state.vertical).map_err(|e| e.to_string())
}

// #[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_role_permission(
    state: &AppAuthState,
    conn: &Connection,
    token: Option<&str>,
    role: &str,
    permission: &str,
    granted: bool,
    confirm: bool,
    now_ms: i64,
) -> Result<(), String> {
    let auth = authorize(
        &state.as_guard_context(),
        token,
        "set_role_permission",
        now_ms,
    )
    .map_err(|e| e.to_string())?;

    let user_id = auth.user_id.ok_or_else(|| "User ID missing".to_string())?;

    let parsed_role = Role::parse_role(role).ok_or_else(|| format!("Invalid role '{}'", role))?;

    let parsed_perm = Permission::parse_permission(permission)
        .ok_or_else(|| format!("Invalid permission '{}'", permission))?;

    let plan = "pro";

    set_role_permission_impl(
        conn,
        user_id,
        parsed_role,
        parsed_perm,
        granted,
        confirm,
        &state.vertical,
        plan,
        now_ms,
    )
    .map_err(|e| e.to_string())
}

// #[tauri::command]
pub fn reset_role_permissions(
    state: &AppAuthState,
    conn: &Connection,
    token: Option<&str>,
    role: &str,
    now_ms: i64,
) -> Result<(), String> {
    let auth = authorize(
        &state.as_guard_context(),
        token,
        "reset_role_permissions",
        now_ms,
    )
    .map_err(|e| e.to_string())?;

    let user_id = auth.user_id.ok_or_else(|| "User ID missing".to_string())?;

    let parsed_role = Role::parse_role(role).ok_or_else(|| format!("Invalid role '{}'", role))?;

    reset_role_permissions_impl(conn, user_id, parsed_role, &state.vertical, now_ms)
        .map_err(|e| e.to_string())
}
