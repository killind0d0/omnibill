//! Migration 5: Discovery Hub & Sell Graph Schema
//!
//! Adds:
//! - brands table
//! - brand_id and is_critical to resources
//! - supplier_id and received_day to resource_lots
//! - cogs_paise and business_day to transaction_items (lot_id already exists per D0)
//! - sales_daily, sales_heat, inventory_daily rollups
//! - product_stats table

pub const MIGRATION_5_SQL: &str = r#"
-- 1. BRANDS TABLE
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  manufacturer TEXT
);

-- 2. RESOURCES EXTENSIONS
ALTER TABLE resources ADD COLUMN brand_id INTEGER REFERENCES brands(id);
ALTER TABLE resources ADD COLUMN is_critical INTEGER NOT NULL DEFAULT 0;

-- 3. RESOURCE LOTS EXTENSIONS
ALTER TABLE resource_lots ADD COLUMN supplier_id TEXT REFERENCES entities(id);
ALTER TABLE resource_lots ADD COLUMN received_day INTEGER NOT NULL DEFAULT 0;

-- 4. TRANSACTION ITEMS EXTENSIONS
-- Note: lot_id TEXT REFERENCES resource_lots(id) already exists in transaction_items from Migration 1.
ALTER TABLE transaction_items ADD COLUMN cogs_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaction_items ADD COLUMN business_day INTEGER NOT NULL DEFAULT 0;

-- 5. DAILY SALES ROLLUP
CREATE TABLE IF NOT EXISTS sales_daily (
  resource_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  qty_milli INTEGER NOT NULL,
  net_paise INTEGER NOT NULL,
  cogs_paise INTEGER NOT NULL,
  bills INTEGER NOT NULL,
  PRIMARY KEY (resource_id, day)
) WITHOUT ROWID;

-- 6. HOURLY SALES HEATMAP ROLLUP
CREATE TABLE IF NOT EXISTS sales_heat (
  day INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  bills INTEGER NOT NULL,
  net_paise INTEGER NOT NULL,
  PRIMARY KEY (day, hour)
) WITHOUT ROWID;

-- 7. DAILY INVENTORY ROLLUP
CREATE TABLE IF NOT EXISTS inventory_daily (
  resource_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  stock_milli INTEGER NOT NULL,
  value_paise INTEGER NOT NULL,
  PRIMARY KEY (resource_id, day)
) WITHOUT ROWID;

-- 8. PRODUCT STATS TABLE
CREATE TABLE IF NOT EXISTS product_stats (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id),
  vertical TEXT NOT NULL,
  is_active INTEGER NOT NULL,
  brand_id INTEGER,
  category_id INTEGER,
  tax_bp INTEGER NOT NULL,
  sell_paise INTEGER NOT NULL,
  avg_cost_paise INTEGER NOT NULL,
  margin_bp INTEGER NOT NULL DEFAULT 0,
  stock_milli INTEGER NOT NULL,
  reorder_milli INTEGER NOT NULL DEFAULT 0,
  max_stock_milli INTEGER NOT NULL DEFAULT 0,
  stock_value_paise INTEGER NOT NULL,
  first_received_day INTEGER NOT NULL DEFAULT 0,
  last_received_day INTEGER NOT NULL DEFAULT 0,
  last_supplier_id TEXT,
  earliest_expiry_day INTEGER NOT NULL DEFAULT 99999999,
  last_sold_day INTEGER NOT NULL DEFAULT 0,
  qty_7_milli INTEGER NOT NULL DEFAULT 0,
  qty_30_milli INTEGER NOT NULL DEFAULT 0,
  qty_90_milli INTEGER NOT NULL DEFAULT 0,
  rev_90_paise INTEGER NOT NULL DEFAULT 0,
  gp_90_paise INTEGER NOT NULL DEFAULT 0,
  runout_days_x10 INTEGER NOT NULL DEFAULT 999999,
  gmroi_bp INTEGER NOT NULL DEFAULT 0,
  abc_class INTEGER NOT NULL DEFAULT 3,
  stats_day INTEGER NOT NULL DEFAULT 0
);
"#;
