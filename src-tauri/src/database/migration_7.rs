//! Migration 7: Inventory Risk & Day-Close Alerts Table
//!
//! Stores derived alert events:
//! - expiry: items expiring within 30 days
//! - stockout: items depleting in < 7 days
//! - dead: items inactive >= 90 days with positive stock (excluding critical drugs)
//! - below_reorder: items with stock <= reorder threshold

pub const MIGRATION_7_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('expiry','stockout','dead','below_reorder')),
  resource_id TEXT NOT NULL,
  severity INTEGER NOT NULL,
  value_paise INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL,
  acknowledged_day INTEGER,
  UNIQUE(day, kind, resource_id)
);

CREATE INDEX IF NOT EXISTS alerts_day_ack ON alerts(day, acknowledged_day);
"#;
