use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use crate::auth::{
    check_mutating_admin_header, validate_session, verify_admin_login, AuthError, LoginPayload,
    LoginSuccess,
};
use crate::db::open_db;
use crate::ratelimit::{extract_client_ip, SlidingWindowLimiter};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone)]
pub struct AppState {
    pub db_path: PathBuf,
    pub server_secret: String,
    pub rate_limiter: Arc<SlidingWindowLimiter>,
}

pub async fn admin_mutating_header_middleware(
    request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    check_mutating_admin_header(request.method(), request.headers())?;
    Ok(next.run(request).await)
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/admin/login", post(admin_login_handler))
        .route("/v1/admin/me", get(admin_me_handler))
        .route("/v1/admin/test-mutation", post(admin_test_mutation_handler))
        .layer(middleware::from_fn(admin_mutating_header_middleware))
        .with_state(state)
}

async fn admin_login_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<LoginPayload>,
) -> Result<Response, AuthError> {
    check_mutating_admin_header(&Method::POST, &headers)?;

    let xff = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok());
    let peer = SocketAddr::from(([127, 0, 0, 1], 0));
    let client_ip = extract_client_ip(peer, xff);

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    if !state.rate_limiter.check_and_record(&client_ip, now_ms) {
        let resp = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "Rate limit exceeded"
            })),
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

async fn admin_me_handler(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let token = extract_session_token(&headers)?;
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = validate_session(&conn, &token, now_ms)?;

    let username: String = conn
        .query_row(
            "SELECT username FROM admins WHERE id = ?1",
            rusqlite::params![admin_id],
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
    check_mutating_admin_header(&Method::POST, &headers)?;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let token = extract_session_token(&headers)?;
    let conn = open_db(&state.db_path).map_err(AuthError::Db)?;
    let admin_id = validate_session(&conn, &token, now_ms)?;

    Ok((
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "mutation_permitted",
            "admin_id": admin_id
        })),
    )
        .into_response())
}

fn extract_session_token(headers: &HeaderMap) -> Result<String, AuthError> {
    let cookie_header = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .ok_or(AuthError::Unauthorized)?;

    for pair in cookie_header.split(';') {
        let mut parts = pair.trim().splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "admin_session" {
                return Ok(v.to_string());
            }
        }
    }

    Err(AuthError::Unauthorized)
}
