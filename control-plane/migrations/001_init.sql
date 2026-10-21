CREATE TABLE admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret_enc BLOB NOT NULL,
  last_totp_step INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until_ms INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL
);

CREATE TABLE admin_recovery_codes (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  code_hash TEXT NOT NULL,
  used_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE admin_sessions (
  id_hash BLOB PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  created_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
);

CREATE TABLE server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  vertical TEXT NOT NULL CHECK(vertical IN ('retail','wholesale','hospital','school')),
  plan TEXT NOT NULL CHECK(plan IN ('basic','pro')),
  valid_until_day INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  max_counters INTEGER NOT NULL DEFAULT 1 CHECK(max_counters BETWEEN 1 AND 50),
  offline_days INTEGER NOT NULL DEFAULT 3,
  grace_days INTEGER NOT NULL DEFAULT 0,
  export_permit_until_ms INTEGER NOT NULL DEFAULT 0,
  next_serial INTEGER NOT NULL DEFAULT 1,
  created_ms INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE tenant_owner_bootstrap (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  owner_username TEXT NOT NULL,
  temp_password_hash TEXT NOT NULL,
  consumed_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE owner_reset_tokens (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  temp_password_hash TEXT NOT NULL,
  expires_ms INTEGER NOT NULL,
  used_ms INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  secret_hash BLOB NOT NULL,
  activated_ms INTEGER NOT NULL,
  last_checkin_ms INTEGER NOT NULL DEFAULT 0,
  app_version TEXT NOT NULL DEFAULT '',
  revoked INTEGER NOT NULL DEFAULT 0,
  dek_escrow BLOB
);

CREATE TABLE usage_reports (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  bills_24h INTEGER NOT NULL,
  active_users INTEGER NOT NULL,
  last_login_day INTEGER NOT NULL,
  counters_paired INTEGER NOT NULL DEFAULT 0,
  received_ms INTEGER NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0),
  paid_day INTEGER NOT NULL,
  months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 36),
  old_valid_until_day INTEGER NOT NULL,
  new_valid_until_day INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  admin_id INTEGER NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  admin_id INTEGER,
  action TEXT NOT NULL,
  tenant_id TEXT,
  detail TEXT NOT NULL,
  prev_hash BLOB NOT NULL,
  hash BLOB NOT NULL
);

CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN
    SELECT RAISE(ABORT, 'admin_audit is append-only');
END;

CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit
BEGIN
    SELECT RAISE(ABORT, 'admin_audit is append-only');
END;
