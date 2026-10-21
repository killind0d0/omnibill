use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UsageReportPayload {
    pub bills_24h: i64,
    pub active_users: i64,
    pub last_login_day: i64,
    pub counters_paired: i64,
    pub app_version: String,
}

impl UsageReportPayload {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.app_version.len() > 32 {
            return Err("app_version exceeds 32 chars");
        }
        if !self.app_version.is_ascii() {
            return Err("app_version contains non-ascii characters");
        }
        if self.bills_24h < 0 || self.active_users < 0 || self.counters_paired < 0 {
            return Err("numeric usage counts cannot be negative");
        }
        Ok(())
    }
}
