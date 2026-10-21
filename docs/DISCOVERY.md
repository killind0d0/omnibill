# OmniBill: Discovery Hub & Sell Graph Architecture

OmniBill features an offline-first inventory discovery, filtering, and business intelligence analytics engine built for retail, wholesale, and hospital operations.

## 1. Architectural Principles

- **Zero Floating-Point Operations**: All monetary calculations are performed in `i64` paise, inventory quantities in `i64` milli-units, margins in basis points (`1 bp = 0.01%`, `10000 bp = 100%`), and runout durations in tenths of a day (`runout_days_x10`). Rounding uses the shared half-up arithmetic helper `div_round_half_up(num: i128, den: i128)`.
- **Derived Rollups**: Analytical tables (`sales_daily`, `sales_heat`, `inventory_daily`, `product_stats`, and `alerts`) are strictly derived materialized aggregates maintained transactionally during POS sales/returns/cancellations. The underlying double-entry ledger remains the immutable source of truth.
- **Keyset Cursor Pagination**: Product browsing uses base64url keyset cursors rather than high-offset SQL paging to ensure sub-millisecond query performance on catalogs with up to 50,000+ active resources.
- **Pure SVG Visualization**: Sell Graph dashboards use custom zero-dependency SVG chart components (`BarChart`, `ScatterPlot`, `AreaChart`, `Heatmap`, `Donut`) with nice-tick scaling and tooltip popovers.

---

## 2. Database Schema Summary

### Tables
- **`brands`**: Master brands table (`id`, `name`, `code`, `is_active`).
- **`resources` (Extensions)**: Augmented with `brand_id`, `is_critical`, `lead_time_days`, and unique barcode indexing.
- **`sales_daily`**: Daily sales rollup by resource and business day (`resource_id`, `day`, `qty_milli`, `net_paise`, `cogs_paise`, `bills`).
- **`sales_heat`**: Hourly sales heatmap (`day`, `hour`, `bills`, `net_paise`).
- **`inventory_daily`**: End-of-day closing stock snapshot for inventory valuation and GMROI computation (`resource_id`, `day`, `stock_milli`, `cost_price_paise`, `stock_value_paise`).
- **`product_stats`**: High-speed materialized discovery table containing velocity, margin, stock value, runout forecasts, GMROI, and ABC classifications.
- **`alerts`**: Risk and day-close alert tracking (`id`, `day`, `kind`, `resource_id`, `severity`, `value_paise`, `detail`, `acknowledged_day`).
- **`products_fts`**: SQLite FTS5 virtual table using the trigram tokenizer for instant substring and typo-tolerant search across SKU, name, barcode, and brand.

---

## 3. Mathematical Formulas (Float-Free Integer Math)

All formulas execute in `i128` before final rounding:

1. **Margin (`margin_bp`)**:
   $$\text{margin\_bp} = \text{div\_round\_half\_up}\left((\text{sell\_paise} - \text{cost\_paise}) \times 10000, \text{sell\_paise}\right)$$

2. **Runout Forecast (`runout_days_x10`)**:
   $$\text{runout\_days\_x10} = \text{div\_round\_half\_up}\left(\text{stock\_milli} \times \text{effective\_days} \times 10, \text{qty\_window\_milli}\right)$$
   *(Sentinel `999999` denotes infinite runout / zero velocity)*.

3. **GMROI (`gmroi_bp`)**:
   $$\text{gmroi\_bp} = \text{div\_round\_half\_up}\left(\text{gp\_paise} \times 10000, \text{avg\_inventory\_paise}\right)$$

4. **Annualized GMROI (`gmroi_annual_bp`)**:
   $$\text{gmroi\_annual\_bp} = \text{div\_round\_half\_up}\left(\text{gp\_paise} \times 365 \times 10000, \text{avg\_inventory\_paise} \times \text{window\_days}\right)$$

5. **ABC Classification**:
   Cumulative revenue ranking:
   - **Class A (Top 70%)**: Highest revenue drivers.
   - **Class B (Next 20%)**: Moderate performers (70% - 90%).
   - **Class C (Bottom 10%)**: Long-tail items (> 90%).

6. **Civil Date Conversion**:
   Howard Hinnant's integer civil-from-days algorithm converts business day integers (offsets from `1970-01-01`) to `(year, month, day)` and `weekday` without leap-year tables or float conversions.

---

## 4. Operational Runbook

### Rebuilding Rollups
In the event of database maintenance, restore, or migration reconciliation, all derived rollup tables can be rebuilt directly from posted transactions and ledger entries:

```rust
use omnibill_core::discovery::rollup::rebuild_rollups;

let mut conn = open_connection("omnibill.db")?;
let report = rebuild_rollups(&mut conn)?;
println!("Rebuilt {} sales daily rows and {} heat cells", report.sales_daily_rows, report.sales_heat_rows);
```

### Refreshing Analytics Stats
To refresh 30-day velocity, runout days, ABC classes, and GMROI:

```rust
use omnibill_core::discovery::refresh::refresh_stats;

let mut conn = open_connection("omnibill.db")?;
let today = 20747; // Current civil day offset
let report = refresh_stats(&mut conn, today)?;
```

### Running Seeding and Benchmark Tests
To seed a 50,000 product benchmark database with 500,000 transaction lines:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --release --bin seed_bench -- --lines 500000 --out /tmp/omnibill_bench.db
```

To run performance verification on the seeded benchmark:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --release --bin seed_bench -- --verify-only --out /tmp/omnibill_bench.db
```

### Running the Full Regression Verification Script
```bash
bash scripts/verify-discovery.sh
```
