use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use ed25519_dalek::SigningKey;
use rusqlite::params;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::activate::{handle_activation, ActivatePayload};
use crate::auth::{
    check_mutating_admin_header, invalidate_session, validate_session, verify_admin_login,
    AuthError, LoginPayload, LoginSuccess,
};
use crate::checkin::{handle_checkin, CheckinPayload};
use crate::db::{open_db, verify_chain};
use crate::owner_reset::{handle_owner_reset, OwnerResetPayload};
use crate::payments::{mark_paid, MarkPaidPayload};
use crate::ratelimit::{extract_client_ip, SlidingWindowLimiter};
use crate::settings::set_support_text;
use crate::tenants::{
    create_tenant, generate_temp_password, get_tenant, list_tenants, CreateTenantPayload,
    OWNER_RESET_VALID_HOURS,
};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub server_secret: String,
    pub webhook_secret: Option<String>,
    pub signing_key: Arc<SigningKey>,
    pub rate_limiter: Arc<SlidingWindowLimiter>,
    pub signaling: Arc<crate::signaling::SignalingHub>,
}

impl AppState {
    pub fn new(
        db_path: PathBuf,
        server_secret: String,
        signing_key: Arc<SigningKey>,
        rate_limiter: Arc<SlidingWindowLimiter>,
    ) -> Self {
        Self {
            db_path,
            server_secret,
            webhook_secret: None,
            signing_key,
            rate_limiter,
            signaling: crate::signaling::SignalingHub::new(),
        }
    }
}

pub async fn admin_mutating_header_middleware(
    request: axum::extract::Request,
    next: Next,
) -> Result<Response, AuthError> {
    let path = request.uri().path();
    // Enforce mutating header check on all mutating admin routes and test mutation
    if path.starts_with("/v1/admin") {
        check_mutating_admin_header(request.method(), request.headers())?;
    }
    Ok(next.run(request).await)
}

pub fn create_router(state: Arc<AppState>) -> Router {
    let mut router = Router::new()
        // Client endpoints
        .route("/v1/activate", post(activate_handler))
        .route("/v1/checkin", post(checkin_handler))
        .route("/v1/owner-reset", post(owner_reset_handler))
        // Payment Webhook endpoints
        .route("/v1/webhooks/payment", post(payment_webhook_handler))
        .route("/v1/webhooks/razorpay", post(payment_webhook_handler))
        // WebRTC Remote Support Signaling
        .route("/v1/support/ws/{pin}", get(signaling_ws_pin_handler))
        .route("/v1/support/ws", get(signaling_ws_query_handler))
        .route("/v1/support/session", post(support_create_session_handler))
        .route("/v1/support/session/{pin}", get(support_get_session_handler))
        // Admin auth endpoints
        .route("/v1/admin/login", post(admin_login_handler))
        .route("/v1/admin/logout", post(admin_logout_handler))
        .route("/v1/admin/me", get(admin_me_handler))
        .route("/v1/admin/test-mutation", post(admin_test_mutation_handler))
        // Admin tenant management
        .route("/v1/admin/tenants", post(admin_create_tenant_handler))
        .route("/v1/admin/tenants", get(admin_list_tenants_handler))
        .route("/v1/admin/tenants/{id}", get(admin_get_tenant_handler))
        .route("/v1/admin/tenants/{id}", patch(admin_edit_tenant_handler))
        .route("/v1/admin/tenants/{id}/suspend", post(admin_suspend_tenant_handler))
        .route("/v1/admin/tenants/{id}/resume", post(admin_resume_tenant_handler))
        .route("/v1/admin/tenants/{id}/reset-devices", post(admin_reset_devices_handler))
        .route("/v1/admin/tenants/{id}/devices/{device_id}/revoke", post(admin_revoke_device_handler))
        .route("/v1/admin/tenants/{id}/reset-owner", post(admin_reset_owner_handler))
        .route("/v1/admin/tenants/{id}/owner-reset-token", post(admin_reset_owner_handler))
        .route("/v1/admin/tenants/{id}/export-permit", post(admin_export_permit_handler))
        .route("/v1/admin/tenants/{id}/mark-paid", post(admin_mark_paid_handler))
        .route("/v1/admin/tenants/{id}/escrow", post(admin_download_escrow_handler))
        // Settings, usage & audit
        .route("/v1/admin/settings/support-text", get(admin_get_support_text_handler))
        .route("/v1/admin/settings/support-text", post(admin_set_support_text_handler))
        .route("/v1/admin/support-text", get(admin_get_support_text_handler))
        .route("/v1/admin/support-text", post(admin_set_support_text_handler))
        .route("/v1/admin/usage", get(admin_list_usage_handler))
        .route("/v1/admin/audit", get(admin_list_audit_handler))
        .route("/v1/admin/audit/verify", get(admin_verify_audit_handler))
        // Middlewares
        .layer(middleware::from_fn(admin_mutating_header_middleware))
        .layer(DefaultBodyLimit::max(16 * 1024)) // 16 KB everywhere
        .with_state(state);

    let dist_dir = std::env::var("OMNIBILL_WEB_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("control-plane/web/dist"));

    if dist_dir.exists() {
        let index_file = dist_dir.join("index.html");
        if index_file.exists() {
            router = router.fallback_service(
                ServeDir::new(&dist_dir).fallback(ServeFile::new(index_file)),
            );
        } else {
            router = router.fallback_service(ServeDir::new(&dist_dir));
        }
    }

    router
}

const DEFAULT_PEER: std::net::SocketAddr =
    std::net::SocketAddr::V4(std::net::SocketAddrV4::new(std::net::Ipv4Addr::new(127, 0, 0, 1), 0));

fn get_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn extract_admin_session(conn: &rusqlite::Connection, headers: &HeaderMap, now_ms: i64) -> Result<i64, AuthError> {
    let cookie_header = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .ok_or(AuthError::Unauthorized)?;

    for pair in cookie_header.split(';') {
        let mut parts = pair.trim().splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "admin_session" {
                return validate_session(conn, v, now_ms);
            }
        }
    }

    Err(AuthError::Unauthorized)
}

// ----------------------------------------------------------------------------
// Client Handlers
// ----------------------------------------------------------------------------

async fn activate_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ActivatePayload>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let now_ms = get_now_ms();
    let client_ip = extract_client_ip(
        DEFAULT_PEER,
        headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );

    // IP rate limit: 10/hour
    if !state.rate_limiter.check_and_record(&format!("activate:{}", client_ip), now_ms) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        ));
    }

    let mut conn = open_db(&state.db_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    match handle_activation(&mut conn, &state.signing_key, &payload, now_ms) {
        Ok(resp) => Ok((StatusCode::OK, Json(resp)).into_response()),
        Err(crate::activate::ActivateError::Unauthorized | crate::activate::ActivateError::BootstrapConsumed) => Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Invalid tenant code or password" })),
        )),
        Err(crate::activate::ActivateError::DeviceAlreadyExists) => Err((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": "Tenant already activated on another device" })),
        )),
        Err(crate::activate::ActivateError::InvalidEscrow) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Invalid escrow blob" })),
        )),
        Err(crate::activate::ActivateError::Db(e)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        )),
    }
}

async fn checkin_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CheckinPayload>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let now_ms = get_now_ms();

    // Device rate limit: 60/hour
    if !state.rate_limiter.check_and_record(&format!("checkin:{}", payload.device_id), now_ms) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        ));
    }

    let mut conn = open_db(&state.db_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    match handle_checkin(&mut conn, &state.signing_key, &payload, now_ms) {
        Ok(resp) => Ok((StatusCode::OK, Json(resp)).into_response()),
        Err(crate::checkin::CheckinError::Revoked) => Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "revoked" })),
        )),
        Err(crate::checkin::CheckinError::Unauthorized) => Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Unauthorized" })),
        )),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        )),
    }
}

async fn owner_reset_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<OwnerResetPayload>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let now_ms = get_now_ms();
    let client_ip = extract_client_ip(
        DEFAULT_PEER,
        headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );

    if !state.rate_limiter.check_and_record(&format!("owner_reset_ip:{}", client_ip), now_ms)
        || !state.rate_limiter.check_and_record(&format!("owner_reset_dev:{}", payload.device_id), now_ms)
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        ));
    }

    let mut conn = open_db(&state.db_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    match handle_owner_reset(&mut conn, &payload, now_ms) {
        Ok(resp) => Ok((StatusCode::OK, Json(resp)).into_response()),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )),
    }
}

// ----------------------------------------------------------------------------
// Admin Auth Handlers
// ----------------------------------------------------------------------------

async fn admin_login_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<LoginPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let client_ip = extract_client_ip(
        DEFAULT_PEER,
        headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );

    if !state.rate_limiter.check_and_record(&format!("admin_login:{}", client_ip), now_ms) {
        let resp = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        )
            .into_response();
        return Ok(resp);
    }

    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let (admin_id, token_hex) =
        verify_admin_login(&conn, &payload, &state.server_secret, now_ms)?;

    let cookie = format!(
        "admin_session={}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800",
        token_hex
    );

    let mut response = (
        StatusCode::OK,
        Json(LoginSuccess {
            success: true,
            admin_id,
            username: payload.username,
        }),
    )
        .into_response();

    response.headers_mut().insert(
        header::SET_COOKIE,
        cookie
            .parse()
            .map_err(|_| AuthError::Crypto("Cookie parse error".into()))?,
    );

    Ok(response)
}

async fn admin_logout_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    if let Some(cookie_header) = headers.get(header::COOKIE).and_then(|h| h.to_str().ok()) {
        for pair in cookie_header.split(';') {
            let mut parts = pair.trim().splitn(2, '=');
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                if k == "admin_session" {
                    let _ = invalidate_session(&conn, v);
                }
            }
        }
    }

    let cookie = "admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
    let mut response = (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response();
    if let Ok(c) = cookie.parse() {
        response.headers_mut().insert(header::SET_COOKIE, c);
    }
    Ok(response)
}

async fn admin_me_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    let username: String = conn
        .query_row(
            "SELECT username FROM admins WHERE id = ?1",
            params![admin_id],
            |r| r.get(0),
        )
        .map_err(AuthError::Db)?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "admin_id": admin_id,
            "username": username
        })),
    )
        .into_response())
}

async fn admin_test_mutation_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "mutation_permitted",
            "admin_id": admin_id
        })),
    )
        .into_response())
}

// ----------------------------------------------------------------------------
// Admin Tenant Management Handlers
// ----------------------------------------------------------------------------

async fn admin_create_tenant_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CreateTenantPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let mut conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    match create_tenant(&mut conn, &payload, admin_id, now_ms) {
        Ok(resp) => Ok((StatusCode::CREATED, Json(resp)).into_response()),
        Err(e) => Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response()),
    }
}

async fn admin_list_tenants_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;

    let list = list_tenants(&conn, now_ms).map_err(AuthError::Db)?;
    Ok((StatusCode::OK, Json(list)).into_response())
}

async fn admin_get_tenant_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;

    match get_tenant(&conn, &tenant_id, now_ms) {
        Ok(tenant) => Ok((StatusCode::OK, Json(tenant)).into_response()),
        Err(e) => Ok((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response()),
    }
}

#[derive(Debug, Deserialize)]
pub struct EditTenantPayload {
    pub plan: Option<String>,
    pub max_counters: Option<u32>,
    pub offline_days: Option<u32>,
    pub notes: Option<String>,
}

async fn admin_edit_tenant_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
    Json(payload): Json<EditTenantPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    let current: Option<(String, u32, u32, String)> = conn
        .query_row(
            "SELECT plan, max_counters, offline_days, notes FROM tenants WHERE id = ?1",
            params![tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();

    let (mut plan, mut max_counters, mut offline_days, mut notes) = match current {
        Some(c) => c,
        None => {
            return Ok((
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Tenant not found" })),
            )
                .into_response())
        }
    };

    if let Some(p) = payload.plan {
        if p == "basic" || p == "pro" {
            plan = p;
        }
    }
    if let Some(mc) = payload.max_counters {
        max_counters = mc.clamp(1, 50);
    }
    if let Some(od) = payload.offline_days {
        offline_days = od.clamp(1, 14);
    }
    if let Some(n) = payload.notes {
        notes = n;
    }

    if plan == "basic" {
        max_counters = 1;
    }

    conn.execute(
        "UPDATE tenants SET plan = ?1, max_counters = ?2, offline_days = ?3, notes = ?4 WHERE id = ?5",
        params![plan, max_counters, offline_days, notes, tenant_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.edit",
        Some(&tenant_id),
        &format!("Edited tenant: plan={}, max_counters={}, offline_days={}", plan, max_counters, offline_days),
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response())
}

async fn admin_suspend_tenant_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    conn.execute(
        "UPDATE tenants SET status = 'suspended' WHERE id = ?1",
        params![tenant_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.suspend",
        Some(&tenant_id),
        "Tenant suspended",
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "suspended" }))).into_response())
}

async fn admin_resume_tenant_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    conn.execute(
        "UPDATE tenants SET status = 'active' WHERE id = ?1",
        params![tenant_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.resume",
        Some(&tenant_id),
        "Tenant resumed",
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "active" }))).into_response())
}

async fn admin_reset_devices_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    conn.execute(
        "UPDATE devices SET revoked = 1 WHERE tenant_id = ?1",
        params![tenant_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.devices_revoked",
        Some(&tenant_id),
        "All devices revoked for tenant",
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response())
}

async fn admin_revoke_device_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((tenant_id, device_id)): Path<(String, String)>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    conn.execute(
        "UPDATE devices SET revoked = 1 WHERE tenant_id = ?1 AND id = ?2",
        params![tenant_id, device_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "device.revoke",
        Some(&tenant_id),
        &format!("Revoked device {}", device_id),
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "revoked": true }))).into_response())
}

async fn admin_reset_owner_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    let temp_password = generate_temp_password();
    let temp_pw_hash = crate::auth::hash_password(&temp_password)?;
    let expires_ms = now_ms + OWNER_RESET_VALID_HOURS * 3600 * 1000;

    conn.execute(
        "INSERT INTO owner_reset_tokens (tenant_id, temp_password_hash, expires_ms, used_ms, created_ms)
         VALUES (?1, ?2, ?3, 0, ?4)",
        params![tenant_id, temp_pw_hash, expires_ms, now_ms],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.owner_reset_issued",
        Some(&tenant_id),
        &format!("Issued owner reset valid for {} hours", OWNER_RESET_VALID_HOURS),
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "reset_token": temp_password,
            "temp_password": temp_password,
            "expires_ms": expires_ms
        })),
    )
        .into_response())
}

#[derive(Debug, Deserialize)]
pub struct ExportPermitPayload {
    pub hours: i64,
}

async fn admin_export_permit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
    Json(payload): Json<ExportPermitPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    let hours = payload.hours.clamp(1, 72);
    let permit_until_ms = now_ms + hours * 3600 * 1000;

    conn.execute(
        "UPDATE tenants SET export_permit_until_ms = ?1 WHERE id = ?2",
        params![permit_until_ms, tenant_id],
    )
    .map_err(AuthError::Db)?;

    crate::db::append_audit(
        &conn,
        Some(admin_id),
        "tenant.export_permit_issued",
        Some(&tenant_id),
        &format!("Issued export permit for {} hours (until {})", hours, permit_until_ms),
        now_ms,
    )
    .map_err(AuthError::Db)?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "export_permit_until_ms": permit_until_ms
        })),
    )
        .into_response())
}

async fn admin_mark_paid_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
    Json(payload): Json<MarkPaidPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let mut conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    match mark_paid(&mut conn, &tenant_id, &payload, admin_id, now_ms) {
        Ok(resp) => Ok((StatusCode::OK, Json(resp)).into_response()),
        Err(e) => Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response()),
    }
}

#[derive(Debug, Deserialize)]
pub struct EscrowDownloadPayload {
    pub totp: String,
}

async fn admin_download_escrow_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(tenant_id): Path<String>,
    Json(payload): Json<EscrowDownloadPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    // Fresh TOTP validation
    let (username, totp_enc, last_totp_step): (String, Vec<u8>, i64) = conn
        .query_row(
            "SELECT username, totp_secret_enc, last_totp_step FROM admins WHERE id = ?1",
            params![admin_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(AuthError::Db)?;

    let secret_raw = crate::auth::decrypt_totp_secret(&totp_enc, &state.server_secret)?;
    let totp = crate::auth::build_totp(&secret_raw, &username)?;
    let now_secs = (now_ms / 1000) as u64;

    match totp.check(payload.totp.trim(), now_secs) {
        Some(matched_step) => {
            let step_i64 = matched_step as i64;
            if step_i64 <= last_totp_step {
                return Err(AuthError::TotpReplay);
            }
            conn.execute(
                "UPDATE admins SET last_totp_step = ?1 WHERE id = ?2",
                params![step_i64, admin_id],
            )
            .map_err(AuthError::Db)?;
        }
        None => return Err(AuthError::Invalid2Fa),
    }

    let escrow_blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT dek_escrow FROM devices WHERE tenant_id = ?1 AND dek_escrow IS NOT NULL LIMIT 1",
            params![tenant_id],
            |r| r.get(0),
        )
        .ok();

    match escrow_blob {
        Some(blob) => {
            let b64 = BASE64.encode(&blob);
            crate::db::append_audit(
                &conn,
                Some(admin_id),
                "escrow.download",
                Some(&tenant_id),
                "Downloaded escrow blob",
                now_ms,
            )
            .map_err(AuthError::Db)?;

            Ok((
                StatusCode::OK,
                Json(serde_json::json!({
                    "tenant_id": tenant_id,
                    "blob_b64": b64
                })),
            )
                .into_response())
        }
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "No escrow blob uploaded for this tenant" })),
        )
            .into_response()),
    }
}

#[derive(Debug, Deserialize)]
pub struct SupportTextPayload {
    pub text: String,
}

async fn admin_get_support_text_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;
    let text = crate::settings::get_support_text(&conn);
    Ok((StatusCode::OK, Json(serde_json::json!({ "text": text }))).into_response())
}

async fn admin_set_support_text_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<SupportTextPayload>,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = extract_admin_session(&conn, &headers, now_ms)?;

    match set_support_text(&conn, &payload.text, admin_id, now_ms) {
        Ok(()) => Ok((StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()),
        Err(e) => Ok((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
            .into_response()),
    }
}

async fn admin_list_usage_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, tenant_id, device_id, day, bills_24h, active_users, last_login_day, counters_paired, received_ms
             FROM usage_reports ORDER BY id DESC LIMIT 500",
        )
        .map_err(AuthError::Db)?;

    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "tenant_id": r.get::<_, String>(1)?,
                "device_id": r.get::<_, String>(2)?,
                "day": r.get::<_, i64>(3)?,
                "bills_24h": r.get::<_, i64>(4)?,
                "active_users": r.get::<_, i64>(5)?,
                "last_login_day": r.get::<_, i64>(6)?,
                "counters_paired": r.get::<_, i64>(7)?,
                "received_ms": r.get::<_, i64>(8)?,
            }))
        })
        .map_err(AuthError::Db)?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(AuthError::Db)?);
    }

    Ok((StatusCode::OK, Json(items)).into_response())
}

async fn admin_list_audit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, ts_ms, admin_id, action, tenant_id, detail
             FROM admin_audit ORDER BY id DESC LIMIT 500",
        )
        .map_err(AuthError::Db)?;

    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "ts_ms": r.get::<_, i64>(1)?,
                "admin_id": r.get::<_, Option<i64>>(2)?,
                "action": r.get::<_, String>(3)?,
                "tenant_id": r.get::<_, Option<String>>(4)?,
                "detail": r.get::<_, String>(5)?,
            }))
        })
        .map_err(AuthError::Db)?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(AuthError::Db)?);
    }

    Ok((StatusCode::OK, Json(items)).into_response())
}

async fn admin_verify_audit_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = get_now_ms();
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let _ = extract_admin_session(&conn, &headers, now_ms)?;

    match verify_chain(&conn) {
        Ok(()) => Ok((
            StatusCode::OK,
            Json(serde_json::json!({ "verified": true })),
        )
            .into_response()),
        Err(bad_id) => Ok((
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "verified": false, "first_bad_id": bad_id })),
        )
            .into_response()),
    }
}

// ----------------------------------------------------------------------------
// Payment Webhook Handlers
// ----------------------------------------------------------------------------

async fn payment_webhook_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut payload): Json<crate::payments::PaymentWebhookPayload>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let now_ms = get_now_ms();
    let client_ip = extract_client_ip(
        DEFAULT_PEER,
        headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );

    // Rate limit: 60/min
    if !state
        .rate_limiter
        .check_and_record(&format!("webhook:{}", client_ip), now_ms)
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        ));
    }

    // Signature fallback from headers: X-Razorpay-Signature or X-Signature
    if payload.signature.trim().is_empty() {
        if let Some(sig_hdr) = headers
            .get("x-razorpay-signature")
            .or_else(|| headers.get("x-signature"))
            .and_then(|v| v.to_str().ok())
        {
            payload.signature = sig_hdr.to_string();
        }
    }

    let secret = state
        .webhook_secret
        .clone()
        .or_else(|| std::env::var("OMNIBILL_WEBHOOK_SECRET").ok())
        .unwrap_or_else(|| state.server_secret.clone());

    let mut conn = open_db(&state.db_path).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;

    match crate::payments::process_payment_webhook(
        &mut conn,
        &state.signing_key,
        &payload,
        &secret,
        now_ms,
    ) {
        Ok(res) => Ok((StatusCode::OK, Json(res)).into_response()),
        Err(err) => {
            if err.contains("Invalid payment signature") {
                Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": err })),
                ))
            } else if err.contains("Tenant not found") {
                Err((
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": err })),
                ))
            } else {
                Err((
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": err })),
                ))
            }
        }
    }
}

// ----------------------------------------------------------------------------
// WebRTC Remote Support Signaling Handlers
// ----------------------------------------------------------------------------

async fn support_create_session_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let now_ms = get_now_ms();
    let client_ip = extract_client_ip(
        DEFAULT_PEER,
        headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );

    if !state
        .rate_limiter
        .check_and_record(&format!("support_create:{}", client_ip), now_ms)
    {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "Rate limit exceeded" })),
        ));
    }

    let pin = state.signaling.create_session().await;
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "pin": pin,
            "timeout_seconds": 1800
        })),
    )
        .into_response())
}

async fn support_get_session_handler(
    State(state): State<Arc<AppState>>,
    Path(pin): Path<String>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let clean_pin = pin.trim().to_uppercase();
    if let Some(peer_count) = state.signaling.room_peer_count(&clean_pin).await {
        Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "pin": clean_pin,
                "active": true,
                "peer_count": peer_count
            })),
        )
            .into_response())
    } else {
        Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "pin": clean_pin,
                "active": false,
                "error": "Room not found or expired"
            })),
        ))
    }
}

async fn signaling_ws_pin_handler(
    ws: WebSocketUpgrade,
    Path(pin): Path<String>,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| {
        crate::signaling::handle_socket(socket, state.signaling.clone(), Some(pin))
    })
}

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub pin: Option<String>,
}

async fn signaling_ws_query_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| {
        crate::signaling::handle_socket(socket, state.signaling.clone(), query.pin)
    })
}
