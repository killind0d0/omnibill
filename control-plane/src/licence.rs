use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicencePayload {
    pub v: u32,
    pub tenant_id: String,
    pub business_name: String,
    pub vertical: String,
    pub plan: String,
    pub features: Vec<String>,
    pub max_counters: u32,
    pub device_id: String,
    pub serial: u64,
    pub issued_ms: i64,
    pub valid_until_day: i64,
    pub offline_days: u32,
    pub grace_days: u32,
    pub status: String,
    pub export_permit_until_ms: i64,
    pub support_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Licence {
    pub payload: LicencePayload,
    pub sig: String,
}

pub fn features_for(plan: &str) -> Vec<String> {
    let mut feats = match plan {
        "basic" => vec![
            "billing",
            "products",
            "customers",
            "basic_reports",
            "day_close",
            "backup",
            "export_csv",
        ],
        "pro" => vec![
            "billing",
            "products",
            "customers",
            "basic_reports",
            "day_close",
            "backup",
            "export_csv",
            "export_xlsx",
            "export_whatsapp",
            "discovery_hub",
            "sell_graph",
            "alerts",
            "custom_receipts",
            "multi_counter",
        ],
        _ => Vec::new(),
    }
    .into_iter()
    .map(String::from)
    .collect::<Vec<String>>();

    // Strict canonical order: sorted ascending and deduplicated
    feats.sort();
    feats.dedup();
    feats
}

pub fn sign_licence(
    signing_key: &SigningKey,
    mut payload: LicencePayload,
) -> Result<Licence, serde_json::Error> {
    // Canonicalize features array: sorted and deduplicated
    payload.features.sort();
    payload.features.dedup();

    let canonical_bytes = serde_json::to_vec(&payload)?;
    let signature = signing_key.sign(&canonical_bytes);
    let sig_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());

    Ok(Licence {
        payload,
        sig: sig_b64,
    })
}
