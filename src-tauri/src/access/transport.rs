//! Transport abstraction for communicating with the OmniBill Control Plane.
//!
//! Exposes the `ControlPlane` trait so unit and integration tests can use mock transports
//! without network I/O. Production uses `ReqwestControlPlane` with rustls.

use serde::{Deserialize, Serialize};
use super::licence::Licence;
use super::server_url::get_control_plane_url;

#[derive(Debug)]
pub enum ControlPlaneError {
    Network(String),
    Server(u16, String),
    Serialization(String),
    Config(String),
}

impl std::fmt::Display for ControlPlaneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ControlPlaneError::Network(s) => write!(f, "Network/transport error: {}", s),
            ControlPlaneError::Server(code, s) => write!(f, "Server error ({}): {}", code, s),
            ControlPlaneError::Serialization(s) => write!(f, "Serialization error: {}", s),
            ControlPlaneError::Config(s) => write!(f, "URL configuration error: {}", s),
        }
    }
}

impl std::error::Error for ControlPlaneError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivateRequest {
    pub tenant_code: String,
    pub owner_username: String,
    pub temp_password: String,
    pub device_id: String,
    pub app_version: String,
    pub dek_escrow_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivateResponse {
    pub licence: Licence,
    pub device_secret: String,
    pub tenant_id: String,
    pub vertical: String,
    pub owner_username: String,
    pub escrow_needed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UsageReport {
    pub bills_24h: i64,
    pub active_users: i64,
    pub last_login_day: i64,
    pub counters_paired: i64,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckinRequest {
    pub tenant_id: String,
    pub device_id: String,
    pub device_secret: String,
    pub licence_serial: u64,
    pub usage: UsageReport,
    pub dek_escrow_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckinResponse {
    pub licence: Licence,
    pub server_time_ms: i64,
    pub escrow_needed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerResetRequest {
    pub tenant_id: String,
    pub device_id: String,
    pub device_secret: String,
    pub reset_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OwnerResetResponse {
    pub ok: bool,
}

/// Abstract transport trait for control-plane communication.
pub trait ControlPlane: Send + Sync {
    fn activate(&self, req: &ActivateRequest) -> Result<ActivateResponse, ControlPlaneError>;
    fn checkin(&self, req: &CheckinRequest) -> Result<CheckinResponse, ControlPlaneError>;
    fn owner_reset(&self, req: &OwnerResetRequest) -> Result<OwnerResetResponse, ControlPlaneError>;
}

/// Production implementation backed by `reqwest::blocking::Client`.
pub struct ReqwestControlPlane {
    client: reqwest::blocking::Client,
    base_url: String,
}

impl ReqwestControlPlane {
    pub fn new(base_url: String) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        Self { client, base_url }
    }

    pub fn default_from_env() -> Result<Self, ControlPlaneError> {
        let base_url = get_control_plane_url().map_err(|e| ControlPlaneError::Config(e.to_string()))?;
        Ok(Self::new(base_url.to_string()))
    }
}

impl ControlPlane for ReqwestControlPlane {
    fn activate(&self, req: &ActivateRequest) -> Result<ActivateResponse, ControlPlaneError> {
        let url = format!("{}/v1/activate", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .json(req)
            .send()
            .map_err(|e| ControlPlaneError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().unwrap_or_default();
            return Err(ControlPlaneError::Server(status.as_u16(), body));
        }

        resp.json::<ActivateResponse>()
            .map_err(|e| ControlPlaneError::Serialization(e.to_string()))
    }

    fn checkin(&self, req: &CheckinRequest) -> Result<CheckinResponse, ControlPlaneError> {
        let url = format!("{}/v1/checkin", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .json(req)
            .send()
            .map_err(|e| ControlPlaneError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().unwrap_or_default();
            return Err(ControlPlaneError::Server(status.as_u16(), body));
        }

        resp.json::<CheckinResponse>()
            .map_err(|e| ControlPlaneError::Serialization(e.to_string()))
    }

    fn owner_reset(&self, req: &OwnerResetRequest) -> Result<OwnerResetResponse, ControlPlaneError> {
        let url = format!("{}/v1/owner-reset", self.base_url.trim_end_matches('/'));
        let resp = self
            .client
            .post(&url)
            .json(req)
            .send()
            .map_err(|e| ControlPlaneError::Network(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().unwrap_or_default();
            return Err(ControlPlaneError::Server(status.as_u16(), body));
        }

        resp.json::<OwnerResetResponse>()
            .map_err(|e| ControlPlaneError::Serialization(e.to_string()))
    }
}
