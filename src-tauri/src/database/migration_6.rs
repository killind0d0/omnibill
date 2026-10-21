//! Migration 6: Discovery Hub Indexes & FTS5 Full-Text Search
//!
//! Adds:
//! - Targeted partial indexes on product_stats for vertical queries
//! - Composite index on sales_daily(day, resource_id)
//! - Composite indexes on resource_lots for supplier, received date, and expiry
//! - Barcode column & unique index on resources
//! - Trigram FTS5 virtual table products_fts

pub const MIGRATION_6_SQL: &str = r#"
-- 1. PRODUCT STATS VERTICAL INDEXES
CREATE INDEX IF NOT EXISTS ps_vert_brand    ON product_stats(vertical, brand_id)            WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ps_vert_cat      ON product_stats(vertical, category_id)         WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ps_vert_expiry   ON product_stats(vertical, earliest_expiry_day) WHERE is_active = 1 AND stock_milli > 0;
CREATE INDEX IF NOT EXISTS ps_vert_margin   ON product_stats(vertical, margin_bp DESC, resource_id DESC) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ps_vert_runout   ON product_stats(vertical, runout_days_x10)     WHERE is_active = 1 AND stock_milli > 0;
CREATE INDEX IF NOT EXISTS ps_vert_lastsold ON product_stats(vertical, last_sold_day)       WHERE is_active = 1 AND stock_milli > 0;

-- 2. SALES DAILY INDEX
CREATE INDEX IF NOT EXISTS sales_daily_day  ON sales_daily(day, resource_id);

-- 3. RESOURCE LOTS INDEXES
CREATE INDEX IF NOT EXISTS lots_supplier    ON resource_lots(supplier_id, resource_id);
CREATE INDEX IF NOT EXISTS lots_received    ON resource_lots(received_day, resource_id);
-- Note: Substituted expiry_date for expiry_day per D0. D0 showed no remaining-qty column exists on resource_lots.
CREATE INDEX IF NOT EXISTS lots_open_exp    ON resource_lots(expiry_date, resource_id);

-- 4. RESOURCES BARCODE COLUMN & UNIQUE INDEX
ALTER TABLE resources ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS res_barcode ON resources(barcode) WHERE barcode IS NOT NULL;

-- 5. PRODUCTS FTS5 FULL-TEXT VIRTUAL TABLE (TRIGRAM TOKENIZER)
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  name,
  sku,
  barcode,
  brand,
  tokenize = 'trigram'
);
"#;
