//! Migration 8: Local Auth Schema (Users and App State)
//!
//! Provides schema for:
//! - app_users: Local users, credentials, role-based access, and lifecycle state.
//!   (Substituted table name `app_users` for `users` due to L0 legacy conflict).
//! - app_state: Local application state key-value store.

pub const MIGRATION_8_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(username) BETWEEN 3 AND 40),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','co_owner','manager','cashier','stock_clerk','accountant','pharmacist','front_desk','lab_tech','bursar','clerk')),
  is_primary_owner INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_owner IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until_ms INTEGER NOT NULL DEFAULT 0,
  last_login_ms INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES app_users(id),
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  CHECK ((role = 'owner') = (is_primary_owner = 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_one_primary ON app_users(is_primary_owner) WHERE is_primary_owner = 1;
CREATE UNIQUE INDEX IF NOT EXISTS users_one_coowner ON app_users(role) WHERE role = 'co_owner';

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
) WITHOUT ROWID;
"#;
