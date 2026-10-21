use crate::civil::ist_day;
use rand::rngs::OsRng;
use rand::RngCore;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

pub const OWNER_RESET_VALID_HOURS: i64 = 72;
pub const UNAMBIGUOUS_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

pub fn generate_temp_password() -> String {
    let mut rng = OsRng;
    let mut s = String::with_capacity(12);
    for _ in 0..12 {
        let idx = (rng.next_u32() as usize) % UNAMBIGUOUS_ALPHABET.len();
        s.push(UNAMBIGUOUS_ALPHABET[idx] as char);
    }
    s
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TenantSummary {
    pub id: String,
    pub business_name: String,
    pub vertical: String,
    pub plan: String,
    pub valid_until_day: i64,
    pub status: String,
    pub computed_status: String,
    pub max_counters: u32,
    pub offline_days: u32,
    pub grace_days: u32,
    pub export_permit_until_ms: i64,
    pub created_ms: i64,
    pub notes: String,
    pub active_devices: i64,
    pub last_checkin_ms: i64,
}

pub fn compute_tenant_status(
    status: &str,
    valid_until_day: i64,
    active_devices: i64,
    last_checkin_ms: i64,
    now_ms: i64,
) -> String {
    if status == "suspended" {
        return "suspended".into();
    }
    if active_devices == 0 {
        return "not_activated".into();
    }
    let today_day = ist_day(now_ms);
    if now_ms - last_checkin_ms > 3 * 86_400_000 {
        return "no_checkin_3d".into();
    }
    if today_day > valid_until_day {
        return "expired".into();
    }
    if valid_until_day - today_day <= 7 {
        return "expiring".into();
    }
    "active".into()
}

#[derive(Debug, Deserialize)]
pub struct CreateTenantPayload {
    pub business_name: String,
    pub vertical: String,
    pub plan: String,
    pub valid_until_day: i64,
    pub max_counters: Option<u32>,
    pub offline_days: Option<u32>,
    pub grace_days: Option<u32>,
    pub notes: Option<String>,
    pub owner_username: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateTenantResponse {
    pub tenant_id: String,
    pub owner_username: String,
    pub temp_password: String,
}

pub fn create_tenant(
    conn: &mut Connection,
    payload: &CreateTenantPayload,
    admin_id: i64,
    now_ms: i64,
) -> Result<CreateTenantResponse, String> {
    let tenant_id = uuid::Uuid::new_v4().to_string();
    let temp_password = generate_temp_password();
    let temp_pw_hash = crate::auth::hash_password(&temp_password).map_err(|e| e.to_string())?;

    let owner_username = payload
        .owner_username
        .clone()
        .unwrap_or_else(|| "owner".to_string());

    let max_counters = if payload.plan == "basic" {
        1
    } else {
        payload.max_counters.unwrap_or(3).clamp(1, 50)
    };

    let offline_days = payload.offline_days.unwrap_or(3).clamp(1, 14);
    let grace_days = payload.grace_days.unwrap_or(0);
    let notes = payload.notes.as_deref().unwrap_or("");

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO tenants (id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial, created_ms, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, 0, 1, ?9, ?10)",
        params![
            tenant_id,
            payload.business_name,
            payload.vertical,
            payload.plan,
            payload.valid_until_day,
            max_counters,
            offline_days,
            grace_days,
            now_ms,
            notes
        ],
    ).map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO tenant_owner_bootstrap (tenant_id, owner_username, temp_password_hash, consumed_ms)
         VALUES (?1, ?2, ?3, 0)",
        params![tenant_id, owner_username, temp_pw_hash],
    ).map_err(|e| e.to_string())?;

    crate::db::append_audit(
        &tx,
        Some(admin_id),
        "tenant.create",
        Some(&tenant_id),
        &format!("Created tenant '{}' ({})", payload.business_name, payload.vertical),
        now_ms,
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(CreateTenantResponse {
        tenant_id,
        owner_username,
        temp_password,
    })
}

pub fn list_tenants(conn: &Connection, now_ms: i64) -> Result<Vec<TenantSummary>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.business_name, t.vertical, t.plan, t.valid_until_day, t.status,
                t.max_counters, t.offline_days, t.grace_days, t.export_permit_until_ms,
                t.created_ms, t.notes,
                (SELECT count(*) FROM devices d WHERE d.tenant_id = t.id AND d.revoked = 0) as active_devs,
                COALESCE((SELECT max(last_checkin_ms) FROM devices d WHERE d.tenant_id = t.id AND d.revoked = 0), 0) as last_chk
         FROM tenants t ORDER BY t.created_ms DESC",
    )?;

    let rows = stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        let business_name: String = r.get(1)?;
        let vertical: String = r.get(2)?;
        let plan: String = r.get(3)?;
        let valid_until_day: i64 = r.get(4)?;
        let status: String = r.get(5)?;
        let max_counters: u32 = r.get(6)?;
        let offline_days: u32 = r.get(7)?;
        let grace_days: u32 = r.get(8)?;
        let export_permit_until_ms: i64 = r.get(9)?;
        let created_ms: i64 = r.get(10)?;
        let notes: String = r.get(11)?;
        let active_devices: i64 = r.get(12)?;
        let last_checkin_ms: i64 = r.get(13)?;

        let computed_status = compute_tenant_status(
            &status,
            valid_until_day,
            active_devices,
            last_checkin_ms,
            now_ms,
        );

        Ok(TenantSummary {
            id,
            business_name,
            vertical,
            plan,
            valid_until_day,
            status,
            computed_status,
            max_counters,
            offline_days,
            grace_days,
            export_permit_until_ms,
            created_ms,
            notes,
            active_devices,
            last_checkin_ms,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

pub fn get_tenant(conn: &Connection, tenant_id: &str, now_ms: i64) -> Result<TenantSummary, String> {
    conn.query_row(
        "SELECT t.id, t.business_name, t.vertical, t.plan, t.valid_until_day, t.status,
                t.max_counters, t.offline_days, t.grace_days, t.export_permit_until_ms,
                t.created_ms, t.notes,
                (SELECT count(*) FROM devices d WHERE d.tenant_id = t.id AND d.revoked = 0) as active_devs,
                COALESCE((SELECT max(last_checkin_ms) FROM devices d WHERE d.tenant_id = t.id AND d.revoked = 0), 0) as last_chk
         FROM tenants t WHERE t.id = ?1",
        params![tenant_id],
        |r| {
            let id: String = r.get(0)?;
            let business_name: String = r.get(1)?;
            let vertical: String = r.get(2)?;
            let plan: String = r.get(3)?;
            let valid_until_day: i64 = r.get(4)?;
            let status: String = r.get(5)?;
            let max_counters: u32 = r.get(6)?;
            let offline_days: u32 = r.get(7)?;
            let grace_days: u32 = r.get(8)?;
            let export_permit_until_ms: i64 = r.get(9)?;
            let created_ms: i64 = r.get(10)?;
            let notes: String = r.get(11)?;
            let active_devices: i64 = r.get(12)?;
            let last_checkin_ms: i64 = r.get(13)?;

            let computed_status = compute_tenant_status(
                &status,
                valid_until_day,
                active_devices,
                last_checkin_ms,
                now_ms,
            );

            Ok(TenantSummary {
                id,
                business_name,
                vertical,
                plan,
                valid_until_day,
                status,
                computed_status,
                max_counters,
                offline_days,
                grace_days,
                export_permit_until_ms,
                created_ms,
                notes,
                active_devices,
                last_checkin_ms,
            })
        },
    ).map_err(|e| format!("Tenant not found: {}", e))
}
