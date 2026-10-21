use crate::access::{AppAuthState, authorize};
use crate::database::open_connection;
pub use crate::discovery::commands::{
    GraphData, GraphKind, GraphParams, cmd_acknowledge_alert, cmd_day_summary_text,
    cmd_discover_facets, cmd_discover_products, cmd_export_discovery, cmd_generate_alerts,
    cmd_list_alerts, cmd_refresh_analytics, cmd_sell_graph,
};
use crate::posting::{
    PaymentInput, PostedPayment, PostedPurchase, PostedReturn, PostedSale, PostedSaleWithPayments,
    PurchaseInput, PurchaseReturnInput, SaleInput, SaleReturnInput, SaleWithPaymentsInput,
};
use crate::reports::{DayBookReport, Gstr1Report, StockSummaryReport, TrialBalanceReport};
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ============================================================================
// Data Types for Resources & Entities
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceRecord {
    pub id: String,
    pub sku_or_code: String,
    pub name: String,
    pub hsn_sac: String,
    pub tax_rate_bps: i64,
    pub base_price_paise: i64,
    pub cost_price_paise: i64,
    pub is_stock_tracked: bool,
    pub is_active: bool,
    pub current_stock_milli: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateResourceInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(alias = "skuOrCode", alias = "sku")]
    pub sku_or_code: String,
    pub name: String,
    #[serde(alias = "hsnSac", alias = "hsn")]
    pub hsn_sac: String,
    #[serde(alias = "taxRateBps")]
    pub tax_rate_bps: i64,
    #[serde(alias = "basePricePaise")]
    pub base_price_paise: i64,
    #[serde(default, alias = "costPricePaise")]
    pub cost_price_paise: Option<i64>,
    #[serde(default, alias = "isStockTracked")]
    pub is_stock_tracked: Option<bool>,
    #[serde(default, alias = "initialStockMilli")]
    pub initial_stock_milli: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityRecord {
    pub id: String,
    pub entity_code: String,
    pub entity_type: String,
    pub full_name: String,
    pub phone: Option<String>,
    pub gstin: Option<String>,
    pub state_code: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CreateEntityInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(alias = "entityCode")]
    pub entity_code: String,
    #[serde(alias = "entityType")]
    pub entity_type: String,
    #[serde(alias = "fullName", alias = "name")]
    pub full_name: String,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub gstin: Option<String>,
    #[serde(alias = "stateCode")]
    pub state_code: String,
}

// ============================================================================
// Database & Ledger Commands
// ============================================================================

/// Initializes the database at `db_path` by applying WAL pragmas and running migrations.
pub fn cmd_init_database(db_path: String) -> Result<i32, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::database::migrations::run_migrations(&mut conn, crate::database::migrations::MIGRATIONS)
        .map_err(|e| e.to_string())?;
    crate::database::migrations::get_user_version(&conn).map_err(|e| e.to_string())
}

/// Verifies ledger balance and immutability invariants.
pub fn cmd_verify_ledger(db_path: String) -> Result<Vec<String>, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    let discrepancies =
        crate::database::queries::verify_ledger(&conn).map_err(|e| e.to_string())?;
    Ok(discrepancies.into_iter().map(|d| d.to_string()).collect())
}

// ============================================================================
// Posting IPC Commands
// ============================================================================

/// Posts a sales transaction into SQLite atomically.
pub fn cmd_post_sale(db_path: String, input: SaleInput) -> Result<PostedSale, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_sale(&mut conn, &input).map_err(|e| e.to_string())
}

/// Posts a sales invoice and its tender payments together in a single atomic SQLite transaction.
pub fn cmd_post_sale_with_payments(
    db_path: String,
    input: SaleWithPaymentsInput,
) -> Result<PostedSaleWithPayments, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_sale_with_payments(&mut conn, &input).map_err(|e| e.to_string())
}

/// Posts a purchase transaction into SQLite atomically.
pub fn cmd_post_purchase(db_path: String, input: PurchaseInput) -> Result<PostedPurchase, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_purchase(&mut conn, &input).map_err(|e| e.to_string())
}

/// Posts a payment (receipt or voucher) into SQLite atomically.
pub fn cmd_post_payment(db_path: String, input: PaymentInput) -> Result<PostedPayment, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_payment(&mut conn, &input).map_err(|e| e.to_string())
}

/// Posts a sales return (credit note) into SQLite atomically.
pub fn cmd_post_sale_return(
    db_path: String,
    input: SaleReturnInput,
) -> Result<PostedReturn, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_sale_return(&mut conn, &input).map_err(|e| e.to_string())
}

/// Posts a purchase return (debit note) into SQLite atomically.
pub fn cmd_post_purchase_return(
    db_path: String,
    input: PurchaseReturnInput,
) -> Result<PostedReturn, String> {
    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::posting::post_purchase_return(&mut conn, &input).map_err(|e| e.to_string())
}

// ============================================================================
// Catalog & Entity IPC Commands
// ============================================================================

/// Retrieves all active and inactive resources along with aggregated current stock.
pub fn cmd_get_resources(db_path: String) -> Result<Vec<ResourceRecord>, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT r.id, r.sku_or_code, r.name, r.hsn_sac, r.tax_rate_bps,
                    r.base_price_paise, r.cost_price_paise, r.is_stock_tracked,
                    r.is_active, r.created_at,
                    COALESCE((SELECT SUM(sm.quantity_delta_milli) FROM stock_movements sm WHERE sm.resource_id = r.id), 0) AS current_stock_milli
             FROM resources r
             ORDER BY r.name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ResourceRecord {
                id: row.get(0)?,
                sku_or_code: row.get(1)?,
                name: row.get(2)?,
                hsn_sac: row.get(3)?,
                tax_rate_bps: row.get(4)?,
                base_price_paise: row.get(5)?,
                cost_price_paise: row.get(6)?,
                is_stock_tracked: row.get::<_, i64>(7)? != 0,
                is_active: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
                current_stock_milli: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Creates a new catalog resource. If initial stock is specified, seeds an initial lot and movement.
pub fn cmd_create_resource(
    db_path: String,
    input: CreateResourceInput,
) -> Result<ResourceRecord, String> {
    let trimmed_sku = input.sku_or_code.trim();
    if trimmed_sku.is_empty() {
        return Err("Resource SKU or code cannot be empty".to_string());
    }
    let trimmed_name = input.name.trim();
    if trimmed_name.is_empty() {
        return Err("Resource name cannot be empty".to_string());
    }
    if input.tax_rate_bps < 0 || input.tax_rate_bps > 10000 {
        return Err(format!(
            "Invalid tax rate: {} bps (must be 0..=10000)",
            input.tax_rate_bps
        ));
    }
    if input.base_price_paise < 0 {
        return Err(format!(
            "Invalid base price: {} paise (must be >= 0)",
            input.base_price_paise
        ));
    }
    if let Some(cost) = input.cost_price_paise
        && cost < 0
    {
        return Err(format!("Invalid cost price: {} paise (must be >= 0)", cost));
    }
    if let Some(qty) = input.initial_stock_milli
        && qty < 0
    {
        return Err(format!(
            "Invalid initial stock: {} milli (must be >= 0)",
            qty
        ));
    }

    let mut conn = open_connection(&db_path).map_err(|e| e.to_string())?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;

    let hex_val: String = tx
        .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let res_id = input.id.unwrap_or_else(|| format!("res_{}", hex_val));
    let cost_price = input.cost_price_paise.unwrap_or(0);
    let is_tracked = if input.is_stock_tracked.unwrap_or(true) {
        1
    } else {
        0
    };

    tx.execute(
        "INSERT INTO resources (
            id, sku_or_code, name, hsn_sac, tax_rate_bps,
            base_price_paise, cost_price_paise, is_stock_tracked, is_active
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
        params![
            &res_id,
            trimmed_sku,
            trimmed_name,
            input.hsn_sac.trim(),
            input.tax_rate_bps,
            input.base_price_paise,
            cost_price,
            is_tracked,
        ],
    )
    .map_err(|e| e.to_string())?;

    let mut current_stock = 0;
    if let Some(init_qty) = input.initial_stock_milli
        && init_qty > 0
        && is_tracked == 1
    {
        let lot_id = format!("lot_{}", hex_val);
        tx.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, mrp_paise)
             VALUES (?1, ?2, 'BATCH-INIT', ?3)",
            params![&lot_id, &res_id, input.base_price_paise],
        )
        .map_err(|e| e.to_string())?;

        let sm_id = format!("sm_{}", hex_val);
        tx.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES (?1, ?2, ?3, NULL, 'ADJUSTMENT', ?4)",
            params![&sm_id, &res_id, &lot_id, init_qty],
        )
        .map_err(|e| e.to_string())?;

        current_stock = init_qty;
    }

    let created_at: String = tx
        .query_row(
            "SELECT created_at FROM resources WHERE id = ?1",
            params![&res_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ResourceRecord {
        id: res_id,
        sku_or_code: trimmed_sku.to_string(),
        name: trimmed_name.to_string(),
        hsn_sac: input.hsn_sac.trim().to_string(),
        tax_rate_bps: input.tax_rate_bps,
        base_price_paise: input.base_price_paise,
        cost_price_paise: cost_price,
        is_stock_tracked: is_tracked != 0,
        is_active: true,
        current_stock_milli: current_stock,
        created_at,
    })
}

// ============================================================================
// Guarded IPC Commands (Batch 1: Database, Posting, Resources)
// ============================================================================

/// Guarded execution for database migrations command.
pub fn cmd_init_database_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    now_ms: i64,
) -> Result<i32, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_run_migrations",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_init_database(db_path)
}

/// Guarded execution for ledger verification command.
pub fn cmd_verify_ledger_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    now_ms: i64,
) -> Result<Vec<String>, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_verify_ledger",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_verify_ledger(db_path)
}

/// Guarded execution for sales posting.
pub fn cmd_post_sale_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: SaleInput,
    now_ms: i64,
) -> Result<PostedSale, String> {
    let _auth = authorize(&state.as_guard_context(), token, "cmd_post_sale", now_ms)
        .map_err(|e| e.to_string())?;
    cmd_post_sale(db_path, input)
}

/// Guarded execution for sales posting with payments.
pub fn cmd_post_sale_with_payments_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: SaleWithPaymentsInput,
    now_ms: i64,
) -> Result<PostedSaleWithPayments, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_post_sale_with_payments",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_post_sale_with_payments(db_path, input)
}

/// Guarded execution for purchase posting.
pub fn cmd_post_purchase_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: PurchaseInput,
    now_ms: i64,
) -> Result<PostedPurchase, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_post_purchase",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_post_purchase(db_path, input)
}

/// Guarded execution for payment posting.
pub fn cmd_post_payment_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: PaymentInput,
    now_ms: i64,
) -> Result<PostedPayment, String> {
    let _auth = authorize(&state.as_guard_context(), token, "cmd_post_payment", now_ms)
        .map_err(|e| e.to_string())?;
    cmd_post_payment(db_path, input)
}

/// Guarded execution for sales return posting.
pub fn cmd_post_sale_return_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: SaleReturnInput,
    now_ms: i64,
) -> Result<PostedReturn, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_post_sale_return",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_post_sale_return(db_path, input)
}

/// Guarded execution for purchase return posting.
pub fn cmd_post_purchase_return_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: PurchaseReturnInput,
    now_ms: i64,
) -> Result<PostedReturn, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_post_purchase_return",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_post_purchase_return(db_path, input)
}

/// Guarded execution for retrieving resources list.
pub fn cmd_get_resources_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    now_ms: i64,
) -> Result<Vec<ResourceRecord>, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_list_resources",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_get_resources(db_path)
}

/// Guarded execution for resource creation.
pub fn cmd_create_resource_guarded(
    state: &AppAuthState,
    token: Option<&str>,
    db_path: String,
    input: CreateResourceInput,
    now_ms: i64,
) -> Result<ResourceRecord, String> {
    let _auth = authorize(
        &state.as_guard_context(),
        token,
        "cmd_record_resource",
        now_ms,
    )
    .map_err(|e| e.to_string())?;
    cmd_create_resource(db_path, input)
}

/// Retrieves all registered entities (customers, suppliers, patients, students).
pub fn cmd_get_entities(db_path: String) -> Result<Vec<EntityRecord>, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, entity_code, entity_type, full_name, phone, gstin, state_code, is_active, created_at
             FROM entities
             ORDER BY full_name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(EntityRecord {
                id: row.get(0)?,
                entity_code: row.get(1)?,
                entity_type: row.get(2)?,
                full_name: row.get(3)?,
                phone: row.get(4)?,
                gstin: row.get(5)?,
                state_code: row.get(6)?,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Registers a new entity (customer or supplier) into the system.
pub fn cmd_create_entity(
    db_path: String,
    input: CreateEntityInput,
) -> Result<EntityRecord, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;

    let hex_val: String = conn
        .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let ent_id = input.id.unwrap_or_else(|| format!("ent_{}", hex_val));
    let normalized_type = input.entity_type.to_uppercase();

    conn.execute(
        "INSERT INTO entities (
            id, entity_code, entity_type, full_name, phone, gstin, state_code, is_active
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)",
        params![
            &ent_id,
            &input.entity_code,
            &normalized_type,
            &input.full_name,
            &input.phone,
            &input.gstin,
            &input.state_code,
        ],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM entities WHERE id = ?1",
            params![&ent_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(EntityRecord {
        id: ent_id,
        entity_code: input.entity_code,
        entity_type: normalized_type,
        full_name: input.full_name,
        phone: input.phone,
        gstin: input.gstin,
        state_code: input.state_code,
        is_active: true,
        created_at,
    })
}

// ============================================================================
// Accounting & Compliance Reports IPC Commands
// ============================================================================

/// Generates a full Trial Balance for the General Ledger.
pub fn cmd_get_trial_balance(db_path: String) -> Result<TrialBalanceReport, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::reports::get_trial_balance(&conn).map_err(|e| e.to_string())
}

/// Generates a Day Book report summarizing all transactions and vouchers for a given business date.
pub fn cmd_get_day_book(db_path: String, date: String) -> Result<DayBookReport, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::reports::get_day_book(&conn, &date).map_err(|e| e.to_string())
}

/// Generates a GSTR-1 outward supply summary for a given financial year and optional calendar month.
pub fn cmd_get_gstr1_summary(
    db_path: String,
    fy: String,
    month: Option<u32>,
) -> Result<Gstr1Report, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::reports::get_gstr1_summary(&conn, &fy, month).map_err(|e| e.to_string())
}

/// Generates an inventory stock valuation report across all resources and lots.
pub fn cmd_get_stock_summary(db_path: String) -> Result<StockSummaryReport, String> {
    let conn = open_connection(&db_path).map_err(|e| e.to_string())?;
    crate::reports::get_stock_summary(&conn).map_err(|e| e.to_string())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::posting::{
        LineInput, PaymentAllocationInput, PaymentMode, PriceMode, PurchaseLineInput,
    };
    use std::fs;

    fn setup_test_db(prefix: &str) -> (String, std::path::PathBuf) {
        let temp_dir = std::env::temp_dir();
        let rand_suffix = uuid::Uuid::new_v4().to_string();
        let db_path = temp_dir.join(format!("omnibill_cmd_{}_{}.db", prefix, rand_suffix));
        let path_str = db_path.to_str().unwrap().to_string();

        let _ = fs::remove_file(&db_path);

        // Run migrations via cmd_init_database
        let ver = cmd_init_database(path_str.clone()).expect("init db");
        assert!(ver >= 3, "Migrated version must be >= 3");

        // Seed basic business profile
        let conn = open_connection(&path_str).expect("open connection");
        conn.execute(
            "INSERT INTO business_profiles (id, legal_name, trade_name, gstin, state_code, phone, address_line1, city, postal_code)
             VALUES ('biz_1', 'OmniMart Corp', 'OmniMart', '27AABCU9603R1ZM', '27', '9876543210', 'Market Rd', 'Mumbai', '400001')",
            [],
        )
        .expect("seed biz");

        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_admin', 'admin', 'hash', 'Admin', 'ADMIN')",
            [],
        )
        .expect("seed user");

        (path_str, db_path)
    }

    fn cleanup_db(path: &std::path::Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn test_commands_resources_lifecycle() {
        let (db_path, file_path) = setup_test_db("res");

        // 1. Initial resources list should be empty
        let initial = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(initial.len(), 0);

        // 2. Create resource with initial stock
        let created = cmd_create_resource(
            db_path.clone(),
            CreateResourceInput {
                id: Some("res_widget".to_string()),
                sku_or_code: "WIDGET-01".to_string(),
                name: "Mechanical Widget".to_string(),
                hsn_sac: "8471".to_string(),
                tax_rate_bps: 1800,
                base_price_paise: 10000,
                cost_price_paise: Some(6000),
                is_stock_tracked: Some(true),
                initial_stock_milli: Some(50000), // 50 units
            },
        )
        .expect("create resource");

        assert_eq!(created.id, "res_widget");
        assert_eq!(created.sku_or_code, "WIDGET-01");
        assert_eq!(created.current_stock_milli, 50000);

        // 3. Query resources
        let list = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "res_widget");
        assert_eq!(list[0].current_stock_milli, 50000);

        cleanup_db(&file_path);
    }

    #[test]
    fn test_commands_entities_lifecycle() {
        let (db_path, file_path) = setup_test_db("ent");

        // 1. Create Customer
        let cust = cmd_create_entity(
            db_path.clone(),
            CreateEntityInput {
                id: Some("ent_c1".to_string()),
                entity_code: "CUST-001".to_string(),
                entity_type: "customer".to_string(), // tests case-normalization
                full_name: "Ramesh Sharma".to_string(),
                phone: Some("9876543210".to_string()),
                gstin: Some("27ABCDE1234F1Z5".to_string()),
                state_code: "27".to_string(),
            },
        )
        .expect("create customer");

        assert_eq!(cust.id, "ent_c1");
        assert_eq!(cust.entity_type, "CUSTOMER");

        // 2. Create Supplier
        let supp = cmd_create_entity(
            db_path.clone(),
            CreateEntityInput {
                id: None,
                entity_code: "SUPP-001".to_string(),
                entity_type: "SUPPLIER".to_string(),
                full_name: "Apex Supplies Ltd".to_string(),
                phone: Some("9123456789".to_string()),
                gstin: None,
                state_code: "27".to_string(),
            },
        )
        .expect("create supplier");

        assert!(supp.id.starts_with("ent_"));

        // 3. Query entities
        let list = cmd_get_entities(db_path.clone()).expect("get entities");
        assert_eq!(list.len(), 2);

        cleanup_db(&file_path);
    }

    #[test]
    fn test_commands_full_sales_and_payment_flow() {
        let (db_path, file_path) = setup_test_db("sales_flow");

        // 1. Setup resource and customer
        cmd_create_resource(
            db_path.clone(),
            CreateResourceInput {
                id: Some("res_item".to_string()),
                sku_or_code: "ITEM-101".to_string(),
                name: "Standard Item".to_string(),
                hsn_sac: "9988".to_string(),
                tax_rate_bps: 1800,
                base_price_paise: 10000,
                cost_price_paise: Some(5000),
                is_stock_tracked: Some(true),
                initial_stock_milli: Some(10000), // 10 units
            },
        )
        .expect("create resource");

        cmd_create_entity(
            db_path.clone(),
            CreateEntityInput {
                id: Some("ent_buyer".to_string()),
                entity_code: "BUYER-01".to_string(),
                entity_type: "CUSTOMER".to_string(),
                full_name: "Priya Patel".to_string(),
                phone: Some("9876500000".to_string()),
                gstin: None,
                state_code: "27".to_string(),
            },
        )
        .expect("create buyer");

        // 2. Post Sale
        let sale = cmd_post_sale(
            db_path.clone(),
            SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_buyer".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_item".to_string(),
                    quantity_milli: 2000, // 2 units
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("post sale");

        assert_eq!(sale.invoice_number, "INV/26-27/0001");
        assert_eq!(sale.totals.total_amount_paise, 23600); // 200 + 18% tax = 236.00

        // Stock should now be 8000 milli (8 units)
        let resources = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(resources[0].current_stock_milli, 8000);

        // 3. Post Payment Receipt
        let payment = cmd_post_payment(
            db_path.clone(),
            PaymentInput {
                entity_id: "ent_buyer".to_string(),
                payment_mode: PaymentMode::Upi,
                amount_paise: 23600,
                reference_number: Some("UPI-TX-123".to_string()),
                payment_date: "2026-04-15".to_string(),
                allocations: vec![PaymentAllocationInput {
                    transaction_id: sale.transaction_id.clone(),
                    amount_paise: 23600,
                }],
            },
        )
        .expect("post payment");

        assert_eq!(payment.amount_paise, 23600);
        assert_eq!(payment.allocated_paise, 23600);
        assert_eq!(payment.unallocated_paise, 0);

        // 4. Verify Ledger is balanced
        let discrepancies = cmd_verify_ledger(db_path.clone()).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "Ledger discrepancies: {:?}",
            discrepancies
        );

        // 5. Query Trial Balance
        let tb = cmd_get_trial_balance(db_path.clone()).expect("get trial balance");
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits_paise, tb.total_credits_paise);

        // 6. Query Day Book
        let day_book =
            cmd_get_day_book(db_path.clone(), "2026-04-15".to_string()).expect("get day book");
        assert_eq!(day_book.total_sales_paise, 23600);

        // 7. Query GSTR-1
        let gstr1 = cmd_get_gstr1_summary(db_path.clone(), "2026-27".to_string(), Some(4))
            .expect("gstr1 summary");
        assert_eq!(gstr1.total_taxable_paise, 20000);
        assert_eq!(gstr1.total_cgst_paise, 1800);
        assert_eq!(gstr1.total_sgst_paise, 1800);

        // 8. Query Stock Summary
        let stock = cmd_get_stock_summary(db_path.clone()).expect("stock summary");
        assert_eq!(stock.total_quantity_milli, 8000);

        cleanup_db(&file_path);
    }

    #[test]
    fn test_commands_purchase_and_return_flow() {
        let (db_path, file_path) = setup_test_db("purchase_flow");

        // Create supplier and item
        cmd_create_entity(
            db_path.clone(),
            CreateEntityInput {
                id: Some("ent_supp_1".to_string()),
                entity_code: "SUPP-01".to_string(),
                entity_type: "SUPPLIER".to_string(),
                full_name: "Apex Wholesalers".to_string(),
                phone: None,
                gstin: Some("27SUPPL9999Z1Z1".to_string()),
                state_code: "27".to_string(),
            },
        )
        .expect("create supplier");

        cmd_create_resource(
            db_path.clone(),
            CreateResourceInput {
                id: Some("res_raw".to_string()),
                sku_or_code: "RAW-01".to_string(),
                name: "Raw Material".to_string(),
                hsn_sac: "2501".to_string(),
                tax_rate_bps: 500,
                base_price_paise: 2000,
                cost_price_paise: Some(1500),
                is_stock_tracked: Some(true),
                initial_stock_milli: Some(0),
            },
        )
        .expect("create raw item");

        // 1. Post Purchase
        let purchase = cmd_post_purchase(
            db_path.clone(),
            PurchaseInput {
                invoice_date: "2026-04-20".to_string(),
                supplier_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                supplier: Some("ent_supp_1".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![PurchaseLineInput {
                    resource_id: "res_raw".to_string(),
                    batch_number: Some("BATCH-P1".to_string()),
                    expiry_date: None,
                    mrp_paise: Some(2500),
                    quantity_milli: 10000,  // 10 units
                    unit_price_paise: 1500, // 15.00
                    discount_paise: 0,
                    tax_rate_bps: 500,
                }],
            },
        )
        .expect("post purchase");

        assert_eq!(purchase.invoice_number, "PUR/26-27/0001");

        // Stock should now be 10000 milli
        let res_list = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(res_list[0].current_stock_milli, 10000);

        // 2. Post Purchase Return (debit note)
        let pret = cmd_post_purchase_return(
            db_path.clone(),
            PurchaseReturnInput {
                return_date: "2026-04-22".to_string(),
                original_transaction_id: purchase.transaction_id,
                reason: Some("Defective packaging".to_string()),
                lines: vec![LineInput {
                    resource_id: "res_raw".to_string(),
                    quantity_milli: 2000, // return 2 units
                    unit_price_paise: 1500,
                    discount_paise: 0,
                    tax_rate_bps: 500,
                }],
            },
        )
        .expect("post purchase return");

        assert!(pret.invoice_number.starts_with("DN/"));

        // Stock should now be 8000 milli
        let res_list_after = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(res_list_after[0].current_stock_milli, 8000);

        // Ledger check
        let discrepancies = cmd_verify_ledger(db_path.clone()).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "Discrepancies found: {:?}",
            discrepancies
        );

        cleanup_db(&file_path);
    }

    #[test]
    fn test_commands_sale_return_restores_stock_and_balances_ledger() {
        let (db_path, file_path) = setup_test_db("sale_return");

        cmd_create_entity(
            db_path.clone(),
            CreateEntityInput {
                id: Some("ent_ret_cust".to_string()),
                entity_code: "CUST-RET".to_string(),
                entity_type: "CUSTOMER".to_string(),
                full_name: "Anita Roy".to_string(),
                phone: None,
                gstin: None,
                state_code: "27".to_string(),
            },
        )
        .expect("create customer");

        cmd_create_resource(
            db_path.clone(),
            CreateResourceInput {
                id: Some("res_ret".to_string()),
                sku_or_code: "RET-ITEM".to_string(),
                name: "Returnable Item".to_string(),
                hsn_sac: "1122".to_string(),
                tax_rate_bps: 1200,
                base_price_paise: 5000,
                cost_price_paise: Some(3000),
                is_stock_tracked: Some(true),
                initial_stock_milli: Some(10000), // 10 units
            },
        )
        .expect("create item");

        // 1. Post Sale of 4 units
        let sale = cmd_post_sale(
            db_path.clone(),
            SaleInput {
                invoice_date: "2026-05-10".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_ret_cust".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_ret".to_string(),
                    quantity_milli: 4000,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 1200,
                }],
            },
        )
        .expect("post sale");

        // Stock after sale: 10000 - 4000 = 6000
        let res_mid = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(res_mid[0].current_stock_milli, 6000);

        // 2. Post Sale Return (Credit Note) for 2 units
        let sret = cmd_post_sale_return(
            db_path.clone(),
            SaleReturnInput {
                return_date: "2026-05-12".to_string(),
                original_transaction_id: sale.transaction_id,
                reason: Some("Customer exchange".to_string()),
                lines: vec![LineInput {
                    resource_id: "res_ret".to_string(),
                    quantity_milli: 2000,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 1200,
                }],
            },
        )
        .expect("post sale return");

        assert!(sret.invoice_number.starts_with("CN/"));

        // Stock after return should be restored by 2000 milli -> 8000 milli
        let res_final = cmd_get_resources(db_path.clone()).expect("get resources");
        assert_eq!(res_final[0].current_stock_milli, 8000);

        // Ledger check
        let discrepancies = cmd_verify_ledger(db_path.clone()).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "Discrepancies found: {:?}",
            discrepancies
        );

        cleanup_db(&file_path);
    }

    #[test]
    fn test_commands_error_handling_and_guards() {
        let (db_path, file_path) = setup_test_db("err_handling");

        // 1. Posting sale with empty lines must return Err
        let err_sale = cmd_post_sale(
            db_path.clone(),
            SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Exclusive,
                lines: vec![],
            },
        );
        assert!(err_sale.is_err(), "Empty lines must fail");

        // 2. Posting sale for nonexistent resource must return Err
        let err_res = cmd_post_sale(
            db_path.clone(),
            SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_does_not_exist".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 1000,
                    discount_paise: 0,
                    tax_rate_bps: 0,
                }],
            },
        );
        assert!(err_res.is_err(), "Nonexistent resource must fail");

        // 3. Invalid DB path returns Err
        let err_db = cmd_get_resources("/nonexistent/directory/db.sqlite".to_string());
        assert!(err_db.is_err());

        cleanup_db(&file_path);
    }
}
