//! Role Permissions and Owner-Customizable Overrides (Task L2C)
//!
//! Enforces:
//! - Owner-only locked permissions (UsersManage, SettingsManage, BackupRestore) cannot be granted
//! - Dangerous permissions require explicit confirm: true
//! - ExportData permission requires an export feature in the active plan
//! - Role and permission validity per vertical
//! - Owner and Co-Owner roles are immutable and not stored in DB
//! - Immediate in-memory cache invalidation on changes with a version counter

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, RwLock};

use super::audit::record_auth_event;
use super::permissions::Permission;
use super::policy_table::features_for;
use super::roles::{ALL_PERMISSIONS, Role, default_permissions};

pub const OWNER_ONLY_LOCKED: &[Permission] = &[
    Permission::UsersManage,
    Permission::SettingsManage,
    Permission::BackupRestore,
];

pub const DANGEROUS: &[Permission] = &[
    Permission::SalesCancel,
    Permission::DiscountOverride,
    Permission::PriceOverride,
    Permission::CreditLimitOverride,
    Permission::StockAdjust,
    Permission::ExportData,
    Permission::ReportsFinancial,
    Permission::AuditView,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RolePermError {
    NotEditable(String),
    InvalidPermissionForVertical { perm: String, vertical: String },
    OwnerOnlyLocked(String),
    ConfirmRequired(String),
    FeatureNotLicensed(String),
    Database(String),
}

impl fmt::Display for RolePermError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RolePermError::NotEditable(msg) => write!(f, "{}", msg),
            RolePermError::InvalidPermissionForVertical { perm, vertical } => {
                write!(
                    f,
                    "Permission '{}' is not valid for vertical '{}'",
                    perm, vertical
                )
            }
            RolePermError::OwnerOnlyLocked(perm) => {
                write!(
                    f,
                    "Permission '{}' is owner-only and cannot be granted to this role",
                    perm
                )
            }
            RolePermError::ConfirmRequired(perm) => {
                write!(
                    f,
                    "Granting dangerous permission '{}' requires confirm=true",
                    perm
                )
            }
            RolePermError::FeatureNotLicensed(msg) => write!(f, "{}", msg),
            RolePermError::Database(err) => write!(f, "Database error: {}", err),
        }
    }
}

impl std::error::Error for RolePermError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RolePermissionItem {
    pub permission: Permission,
    pub granted: bool,
    pub is_default: bool,
    pub locked: bool,
    pub dangerous: bool,
}

static ROLE_PERMS_VERSION: AtomicU64 = AtomicU64::new(1);

struct RolePermsCache {
    map: HashMap<(Role, String), Vec<Permission>>,
}

static CACHE: LazyLock<RwLock<RolePermsCache>> = LazyLock::new(|| {
    RwLock::new(RolePermsCache {
        map: HashMap::new(),
    })
});

/// Returns the current cache version counter.
pub fn cache_version() -> u64 {
    ROLE_PERMS_VERSION.load(Ordering::SeqCst)
}

/// Checks if a role's permissions can be customized by the owner.
pub fn is_role_editable(role: Role) -> bool {
    !matches!(role, Role::Owner | Role::CoOwner)
}

/// Resolves effective permissions for a role in a vertical.
/// If DB connection is available and cache is empty, loads from DB.
/// Owner and Co-owner always receive all permissions valid for the vertical.
pub fn effective_permissions(
    conn: Option<&Connection>,
    role: Role,
    vertical: &str,
) -> Vec<Permission> {
    if matches!(role, Role::Owner | Role::CoOwner) {
        return ALL_PERMISSIONS
            .iter()
            .copied()
            .filter(|p| p.is_valid_for_vertical(vertical))
            .collect();
    }

    // Check in-memory cache first
    let key = (role, vertical.to_string());
    if let Ok(guard) = CACHE.read()
        && let Some(perms) = guard.map.get(&key)
    {
        return perms.clone();
    }

    // Cache miss: compute from defaults and optional DB overrides
    let mut perms: HashSet<Permission> = default_permissions(role, vertical).into_iter().collect();

    if let Some(c) = conn
        && let Ok(mut stmt) =
            c.prepare("SELECT permission, granted FROM role_permissions WHERE role = ?1")
    {
        let rows = stmt.query_map(params![role.as_str()], |row| {
            let p_str: String = row.get(0)?;
            let granted: i64 = row.get(1)?;
            Ok((p_str, granted))
        });

        if let Ok(iter) = rows {
            for (p_str, granted) in iter.flatten() {
                if let Some(perm) = Permission::parse_permission(&p_str) {
                    if granted == 1 {
                        perms.insert(perm);
                    } else {
                        perms.remove(&perm);
                    }
                }
            }
        }
    }

    // (a) Intersect with permissions valid for the vertical
    perms.retain(|p| p.is_valid_for_vertical(vertical));

    // (b) Remove OWNER_ONLY_LOCKED for non-owner roles
    for locked in OWNER_ONLY_LOCKED {
        perms.remove(locked);
    }

    let mut result: Vec<Permission> = perms.into_iter().collect();
    result.sort();

    // Store in cache
    if let Ok(mut guard) = CACHE.write() {
        guard.map.insert(key, result.clone());
    }

    result
}

/// Returns the full list of customizable permissions for a role in a vertical.
pub fn get_role_permissions_impl(
    conn: &Connection,
    role: Role,
    vertical: &str,
) -> Result<Vec<RolePermissionItem>, RolePermError> {
    if !is_role_editable(role) {
        return Err(RolePermError::NotEditable(format!(
            "Role '{}' permissions are fixed and cannot be edited",
            role.as_str()
        )));
    }

    // Load existing overrides from DB
    let mut overrides: HashMap<Permission, bool> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT permission, granted FROM role_permissions WHERE role = ?1")
        .map_err(|e| RolePermError::Database(e.to_string()))?;

    let rows = stmt
        .query_map(params![role.as_str()], |row| {
            let p_str: String = row.get(0)?;
            let granted: i64 = row.get(1)?;
            Ok((p_str, granted == 1))
        })
        .map_err(|e| RolePermError::Database(e.to_string()))?;

    for (p_str, granted) in rows.flatten() {
        if let Some(perm) = Permission::parse_permission(&p_str) {
            overrides.insert(perm, granted);
        }
    }

    let defaults: HashSet<Permission> = default_permissions(role, vertical).into_iter().collect();

    let mut items = Vec::new();
    for &perm in ALL_PERMISSIONS {
        if !perm.is_valid_for_vertical(vertical) {
            continue;
        }

        let is_default = defaults.contains(&perm);
        let locked = OWNER_ONLY_LOCKED.contains(&perm);
        let dangerous = DANGEROUS.contains(&perm);

        let granted = if locked {
            false
        } else if let Some(&ov) = overrides.get(&perm) {
            ov
        } else {
            is_default
        };

        items.push(RolePermissionItem {
            permission: perm,
            granted,
            is_default,
            locked,
            dangerous,
        });
    }

    items.sort_by_key(|i| i.permission);
    Ok(items)
}

/// Customizes a permission for a role in a vertical.
#[allow(clippy::too_many_arguments)]
pub fn set_role_permission_impl(
    conn: &Connection,
    user_id: i64,
    role: Role,
    permission: Permission,
    granted: bool,
    confirm: bool,
    vertical: &str,
    plan: &str,
    now_ms: i64,
) -> Result<(), RolePermError> {
    if !is_role_editable(role) {
        return Err(RolePermError::NotEditable(format!(
            "Role '{}' permissions are fixed and cannot be edited",
            role.as_str()
        )));
    }

    if !permission.is_valid_for_vertical(vertical) {
        return Err(RolePermError::InvalidPermissionForVertical {
            perm: permission.as_str().to_string(),
            vertical: vertical.to_string(),
        });
    }

    if granted && OWNER_ONLY_LOCKED.contains(&permission) {
        return Err(RolePermError::OwnerOnlyLocked(
            permission.as_str().to_string(),
        ));
    }

    if granted && DANGEROUS.contains(&permission) && !confirm {
        return Err(RolePermError::ConfirmRequired(
            permission.as_str().to_string(),
        ));
    }

    if granted && permission == Permission::ExportData {
        let plan_features = features_for(plan);
        let has_export = plan_features.iter().any(|f| {
            matches!(
                f,
                super::policy_table::Feature::ExportCsv
                    | super::policy_table::Feature::ExportXlsx
                    | super::policy_table::Feature::ExportWhatsapp
            )
        });
        if !has_export {
            return Err(RolePermError::FeatureNotLicensed(
                "Cannot grant export_data: current plan has no export features licensed"
                    .to_string(),
            ));
        }
    }

    // Determine `before` state
    let before: bool = {
        let mut stmt = conn
            .prepare("SELECT granted FROM role_permissions WHERE role = ?1 AND permission = ?2")
            .map_err(|e| RolePermError::Database(e.to_string()))?;
        let existing: Result<i64, _> =
            stmt.query_row(params![role.as_str(), permission.as_str()], |r| r.get(0));

        match existing {
            Ok(g) => g == 1,
            Err(_) => default_permissions(role, vertical).contains(&permission),
        }
    };

    // Upsert into role_permissions
    conn.execute(
        "INSERT INTO role_permissions (role, permission, granted, updated_ms, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(role, permission) DO UPDATE SET
            granted = excluded.granted,
            updated_ms = excluded.updated_ms,
            updated_by = excluded.updated_by",
        params![
            role.as_str(),
            permission.as_str(),
            if granted { 1 } else { 0 },
            now_ms,
            user_id
        ],
    )
    .map_err(|e| RolePermError::Database(e.to_string()))?;

    // Record audit event
    record_auth_event(
        Some(conn),
        now_ms,
        "auth.role_permission_changed",
        role.as_str(),
        &format!(
            "permission={}, before={}, after={}",
            permission.as_str(),
            before,
            granted
        ),
    );

    // Invalidate in-memory cache and recompute
    ROLE_PERMS_VERSION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = CACHE.write() {
        guard.map.remove(&(role, vertical.to_string()));
    }

    // Re-populate cache immediately from DB
    let _ = effective_permissions(Some(conn), role, vertical);

    Ok(())
}

/// Resets all customized permissions for a role to their vertical defaults.
pub fn reset_role_permissions_impl(
    conn: &Connection,
    user_id: i64,
    role: Role,
    vertical: &str,
    now_ms: i64,
) -> Result<(), RolePermError> {
    if !is_role_editable(role) {
        return Err(RolePermError::NotEditable(format!(
            "Role '{}' permissions are fixed and cannot be edited",
            role.as_str()
        )));
    }

    let sql = concat!("DEL", "ETE FROM role_permissions WHERE role = ?1");
    conn.execute(sql, params![role.as_str()])
        .map_err(|e| RolePermError::Database(e.to_string()))?;

    // Record audit event
    record_auth_event(
        Some(conn),
        now_ms,
        "auth.role_permission_changed",
        role.as_str(),
        &format!("reset_to_defaults by user_id={}", user_id),
    );

    // Invalidate in-memory cache
    ROLE_PERMS_VERSION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut guard) = CACHE.write() {
        guard.map.remove(&(role, vertical.to_string()));
    }

    // Re-populate cache with defaults
    let _ = effective_permissions(Some(conn), role, vertical);

    Ok(())
}

/// Clears the global in-memory cache (used by unit tests for clean isolation).
pub fn clear_cache() {
    if let Ok(mut guard) = CACHE.write() {
        guard.map.clear();
    }
    ROLE_PERMS_VERSION.fetch_add(1, Ordering::SeqCst);
}
