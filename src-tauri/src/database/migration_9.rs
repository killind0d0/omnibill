//! Migration 9: Role Permissions Table (Task L2C)
//!
//! Stores owner-customized permission overrides per role.
//! No rows = built-in defaults.
//! `owner` and `co_owner` are never stored (always hold everything valid for vertical).

pub const MIGRATION_9_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL CHECK(role IN ('manager','cashier','stock_clerk','accountant','pharmacist','front_desk','lab_tech','bursar','clerk')),
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK(granted IN (0,1)),
  updated_ms INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES app_users(id),
  PRIMARY KEY (role, permission)
) WITHOUT ROWID;
"#;
