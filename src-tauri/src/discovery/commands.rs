use crate::access::{AppAuthState, authorize};
use crate::discovery::alerts::{
    AlertItem, GenerateAlertsReport, acknowledge_alert, generate_alerts, list_alerts,
};
use crate::discovery::export::{day_summary_text, export_discovery};
use crate::discovery::facets::{Facets, discover_facets};
use crate::discovery::graph::{
    CategoryTrendPoint, DeadStockItem, ExpiryRiskItem, HeatmapCell, MarginVelocityPoint, MetricBy,
    SlowMoverItem, StockoutItem, TopMoverItem, TrendBucket, category_trend, dead_stock,
    expiry_risk, hourly_heatmap, margin_vs_velocity, slow_movers, stockout_forecast, top_movers,
    wholesale_reorder_interval,
};
use crate::discovery::pool::ReadOnlyPool;
use crate::discovery::query::{DiscoveryPage, DiscoveryQuery, discover_products};
use crate::discovery::refresh::{RefreshReport, refresh_stats};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

static REFRESH_DEBOUNCE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphKind {
    TopMovers,
    SlowMovers,
    DeadStock,
    MarginVsVelocity,
    CategoryTrend,
    HourlyHeatmap,
    StockoutForecast,
    ExpiryRisk,
    WholesaleReorder,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphParams {
    pub today: Option<i64>,
    pub window_days: Option<i64>,
    pub threshold_days: Option<i64>,
    pub limit: Option<u32>,
    pub by: Option<MetricBy>,
    pub from_day: Option<i64>,
    pub to_day: Option<i64>,
    pub bucket: Option<TrendBucket>,
    pub customer_id: Option<String>,
    pub resource_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
pub enum GraphData {
    TopMovers(Vec<TopMoverItem>),
    SlowMovers(Vec<SlowMoverItem>),
    DeadStock(Vec<DeadStockItem>),
    MarginVsVelocity(Vec<MarginVelocityPoint>),
    CategoryTrend(Vec<CategoryTrendPoint>),
    HourlyHeatmap(Vec<HeatmapCell>),
    StockoutForecast(Vec<StockoutItem>),
    ExpiryRisk(Vec<ExpiryRiskItem>),
    WholesaleReorder(Option<i64>),
}

/// Executes product discovery query on a read-only pooled connection.
pub fn cmd_discover_products(
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
) -> Result<DiscoveryPage, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let today = crate::discovery::clock::business_day(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    );
    discover_products(&conn, &vert, today, &query).map_err(|e| e.to_string())
}

/// Computes facet counts on a read-only pooled connection.
pub fn cmd_discover_facets(
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
) -> Result<Facets, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let today = crate::discovery::clock::business_day(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    );
    discover_facets(&conn, &vert, today, &query).map_err(|e| e.to_string())
}

/// Computes sell graph analytics on a read-only pooled connection.
pub fn cmd_sell_graph(
    db_path: &str,
    kind: GraphKind,
    params: GraphParams,
    vertical: Option<String>,
) -> Result<GraphData, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let today = params.today.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });

    match kind {
        GraphKind::TopMovers => {
            let window = params.window_days.unwrap_or(30);
            let limit = params.limit.unwrap_or(10);
            let by = params.by.unwrap_or(MetricBy::Revenue);
            let data =
                top_movers(&conn, &vert, today, window, limit, by).map_err(|e| e.to_string())?;
            Ok(GraphData::TopMovers(data))
        }
        GraphKind::SlowMovers => {
            let window = params.window_days.unwrap_or(30);
            let limit = params.limit.unwrap_or(10);
            let data =
                slow_movers(&conn, &vert, today, window, limit).map_err(|e| e.to_string())?;
            Ok(GraphData::SlowMovers(data))
        }
        GraphKind::DeadStock => {
            let threshold = params.threshold_days.unwrap_or(30);
            let limit = params.limit.unwrap_or(50);
            let data =
                dead_stock(&conn, &vert, today, threshold, limit).map_err(|e| e.to_string())?;
            Ok(GraphData::DeadStock(data))
        }
        GraphKind::MarginVsVelocity => {
            let limit = params.limit.unwrap_or(500);
            let data = margin_vs_velocity(&conn, &vert, limit).map_err(|e| e.to_string())?;
            Ok(GraphData::MarginVsVelocity(data))
        }
        GraphKind::CategoryTrend => {
            let from = params.from_day.unwrap_or(today - 30);
            let to = params.to_day.unwrap_or(today);
            let bucket = params.bucket.unwrap_or(TrendBucket::Day);
            let data = category_trend(&conn, &vert, from, to, bucket).map_err(|e| e.to_string())?;
            Ok(GraphData::CategoryTrend(data))
        }
        GraphKind::HourlyHeatmap => {
            let from = params.from_day.unwrap_or(today - 30);
            let to = params.to_day.unwrap_or(today);
            let data = hourly_heatmap(&conn, from, to).map_err(|e| e.to_string())?;
            Ok(GraphData::HourlyHeatmap(data))
        }
        GraphKind::StockoutForecast => {
            let limit = params.limit.unwrap_or(50);
            let data = stockout_forecast(&conn, &vert, limit).map_err(|e| e.to_string())?;
            Ok(GraphData::StockoutForecast(data))
        }
        GraphKind::ExpiryRisk => {
            let data = expiry_risk(&conn, &vert, today).map_err(|e| e.to_string())?;
            Ok(GraphData::ExpiryRisk(data))
        }
        GraphKind::WholesaleReorder => {
            let cust_id = params
                .customer_id
                .ok_or_else(|| "Missing customer_id for WholesaleReorder".to_string())?;
            let res_id = params
                .resource_id
                .ok_or_else(|| "Missing resource_id for WholesaleReorder".to_string())?;
            let data =
                wholesale_reorder_interval(&conn, &cust_id, &res_id).map_err(|e| e.to_string())?;
            Ok(GraphData::WholesaleReorder(data))
        }
    }
}

/// Refreshes product statistics on write connection with debounce.
pub fn cmd_refresh_analytics(db_path: &str, today: Option<i64>) -> Result<RefreshReport, String> {
    let _lock = REFRESH_DEBOUNCE
        .lock()
        .map_err(|_| "Failed to acquire refresh lock".to_string())?;

    let mut conn = crate::database::open_connection(db_path).map_err(|e| e.to_string())?;
    let t = today.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });
    refresh_stats(&mut conn, t).map_err(|e| e.to_string())
}

// ============================================================================
// Guarded IPC Discovery Commands (Batch 2: Discovery Hub & Sell Graph)
// ============================================================================

/// Guarded execution for product discovery.
// #[tauri::command]
pub fn cmd_discover_products_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
    now_ms: i64,
) -> Result<DiscoveryPage, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_discover_products",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_discover_products(db_path, query, vertical)
}

/// Guarded execution for facet discovery.
// #[tauri::command]
pub fn cmd_discover_facets_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
    now_ms: i64,
) -> Result<Facets, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_discover_facets",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_discover_facets(db_path, query, vertical)
}

/// Guarded execution for sell graph data.
// #[tauri::command]
pub fn cmd_sell_graph_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    kind: GraphKind,
    params: GraphParams,
    vertical: Option<String>,
    now_ms: i64,
) -> Result<GraphData, String> {
    let _auth = authorize(&state.as_guard_context(), token, "cmd_sell_graph", now_ms)
        .map_err(|e| e.to_string())?;
    cmd_sell_graph(db_path, kind, params, vertical)
}

/// Guarded execution for analytics refresh.
// #[tauri::command]
pub fn cmd_refresh_analytics_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    today: Option<i64>,
    now_ms: i64,
) -> Result<RefreshReport, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_refresh_analytics",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_refresh_analytics(db_path, today)
}

/// Guarded execution for analytics rebuild.
// #[tauri::command]
pub fn cmd_rebuild_analytics_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    now_ms: i64,
) -> Result<crate::discovery::rollup::RebuildReport, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_rebuild_analytics",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    let conn = crate::database::open_connection(db_path).map_err(|e| e.to_string())?;
    crate::discovery::rollup::rebuild_rollups(&conn).map_err(|e| e.to_string())
}

/// Guarded execution for getting a single product's detail from discovery.
// #[tauri::command]
pub fn cmd_get_product_detail_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    resource_id: &str,
    vertical: Option<String>,
    now_ms: i64,
) -> Result<Option<crate::discovery::query::ProductDiscoveryItem>, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_get_product_detail",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    let q = DiscoveryQuery {
        text: Some(resource_id.to_string()),
        limit: 1,
        ..Default::default()
    };
    let page = cmd_discover_products(db_path, q, vertical)?;
    Ok(page.items.into_iter().next())
}

/// Generates day-close and risk alerts.
pub fn cmd_generate_alerts(
    db_path: &str,
    vertical: Option<String>,
    today: Option<i64>,
) -> Result<GenerateAlertsReport, String> {
    let conn = crate::database::open_connection(db_path).map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let t = today.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });
    generate_alerts(&conn, &vert, t).map_err(|e| e.to_string())
}

/// Lists alerts.
pub fn cmd_list_alerts(
    db_path: &str,
    include_acknowledged: bool,
) -> Result<Vec<AlertItem>, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    list_alerts(&conn, include_acknowledged).map_err(|e| e.to_string())
}

/// Acknowledges an alert.
pub fn cmd_acknowledge_alert(
    db_path: &str,
    alert_id: i64,
    today: Option<i64>,
) -> Result<(), String> {
    let conn = crate::database::open_connection(db_path).map_err(|e| e.to_string())?;
    let t = today.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });
    acknowledge_alert(&conn, alert_id, t).map_err(|e| e.to_string())
}

/// Exports discovery query results to a CSV file.
pub fn cmd_export_discovery(
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
    today: Option<i64>,
    out_dir: Option<String>,
) -> Result<String, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let t = today.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });
    let path = export_discovery(&conn, &query, &vert, t, out_dir.as_deref())?;
    Ok(path.to_string_lossy().to_string())
}

/// Generates a WhatsApp-ready day summary plain text.
pub fn cmd_day_summary_text(
    db_path: &str,
    vertical: Option<String>,
    day: Option<i64>,
) -> Result<String, String> {
    let pool = ReadOnlyPool::new(db_path).map_err(|e| e.to_string())?;
    let conn = pool.acquire().map_err(|e| e.to_string())?;
    let vert = vertical.unwrap_or_else(|| "retail".to_string());
    let t = day.unwrap_or_else(|| {
        crate::discovery::clock::business_day(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        )
    });
    day_summary_text(&conn, &vert, t).map_err(|e| e.to_string())
}

// ============================================================================
// Guarded IPC Alert & Export Commands (Batch 3: Alerts & Exports)
// ============================================================================

/// Guarded execution for generating alerts.
// #[tauri::command]
pub fn cmd_generate_alerts_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    vertical: Option<String>,
    today: Option<i64>,
    now_ms: i64,
) -> Result<GenerateAlertsReport, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_generate_alerts",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_generate_alerts(db_path, vertical, today)
}

/// Guarded execution for listing alerts.
// #[tauri::command]
pub fn cmd_list_alerts_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    include_acknowledged: bool,
    now_ms: i64,
) -> Result<Vec<AlertItem>, String> {
    let _auth = authorize(&state.as_guard_context(), token, "cmd_list_alerts", now_ms)
        .map_err(|e| e.to_string())?;
    cmd_list_alerts(db_path, include_acknowledged)
}

/// Guarded execution for acknowledging an alert.
// #[tauri::command]
pub fn cmd_acknowledge_alert_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    alert_id: i64,
    today: Option<i64>,
    now_ms: i64,
) -> Result<(), String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_acknowledge_alert",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_acknowledge_alert(db_path, alert_id, today)
}

/// Guarded execution for discovery export (CSV).
#[allow(clippy::too_many_arguments)]
// #[tauri::command]
pub fn cmd_export_discovery_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    query: DiscoveryQuery,
    vertical: Option<String>,
    today: Option<i64>,
    out_dir: Option<String>,
    now_ms: i64,
) -> Result<String, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_export_discovery",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_export_discovery(db_path, query, vertical, today, out_dir)
}

/// Guarded execution for day summary text export (WhatsApp text).
// #[tauri::command]
pub fn cmd_day_summary_text_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: &str,
    vertical: Option<String>,
    day: Option<i64>,
    now_ms: i64,
) -> Result<String, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_day_summary_text",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_day_summary_text(db_path, vertical, day)
}
