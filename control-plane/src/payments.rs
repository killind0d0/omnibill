use rusqlite::{params, Connection, Result};
use crate::civil::{add_months, ist_day};
use ed25519_dalek::SigningKey;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseAmountError {
    #[error("Amount text is empty")]
    Empty,
    #[error("Negative amounts are not permitted")]
    Negative,
    #[error("Invalid character in amount text")]
    InvalidCharacter,
    #[error("Multiple decimal points in amount text")]
    MultipleDecimals,
    #[error("Too many decimal places (maximum 2 allowed)")]
    TooManyDecimals,
    #[error("Integer overflow parsing amount")]
    Overflow,
}

/// Parses a rupee amount string into integer paise without any floating-point arithmetic.
///
/// Accepts:
/// - "4999" -> 499900
/// - "4999.5" -> 499950
/// - "4999.50" -> 499950
/// - ".5" -> 50
///
/// Rejects:
/// - "49.999" (too many decimals)
/// - "abc" (invalid characters)
/// - negatives ("-100")
/// - empty strings
pub fn parse_rupees_to_paise(input: &str) -> Result<i64, ParseAmountError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(ParseAmountError::Empty);
    }

    if s.starts_with('-') {
        return Err(ParseAmountError::Negative);
    }

    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() > 2 {
        return Err(ParseAmountError::MultipleDecimals);
    }

    let (rupees_str, paise_str) = if parts.len() == 2 {
        (parts[0], Some(parts[1]))
    } else {
        (parts[0], None)
    };

    let rupees: i64 = if rupees_str.is_empty() {
        0
    } else {
        if !rupees_str.chars().all(|c| c.is_ascii_digit()) {
            return Err(ParseAmountError::InvalidCharacter);
        }
        rupees_str
            .parse::<i64>()
            .map_err(|_| ParseAmountError::Overflow)?
    };

    let paise: i64 = match paise_str {
        Some(p) => {
            if p.is_empty() {
                0
            } else if p.len() == 1 {
                let b = p.as_bytes()[0];
                if !b.is_ascii_digit() {
                    return Err(ParseAmountError::InvalidCharacter);
                }
                ((b - b'0') as i64) * 10
            } else if p.len() == 2 {
                let b0 = p.as_bytes()[0];
                let b1 = p.as_bytes()[1];
                if !b0.is_ascii_digit() || !b1.is_ascii_digit() {
                    return Err(ParseAmountError::InvalidCharacter);
                }
                ((b0 - b'0') as i64) * 10 + ((b1 - b'0') as i64)
            } else {
                return Err(ParseAmountError::TooManyDecimals);
            }
        }
        None => 0,
    };

    rupees
        .checked_mul(100)
        .and_then(|r| r.checked_add(paise))
        .ok_or(ParseAmountError::Overflow)
}

#[derive(Debug, Deserialize)]
pub struct MarkPaidPayload {
    pub months: i64,
    #[serde(alias = "amount_rupees")]
    pub amount_rupees_text: String,
    pub paid_day: Option<i64>,
    pub note: Option<String>,
    pub resume: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct MarkPaidResponse {
    pub payment_id: i64,
    pub old_valid_until_day: i64,
    pub new_valid_until_day: i64,
    pub amount_paise: i64,
    pub status: String,
}

pub fn mark_paid(
    conn: &mut Connection,
    tenant_id: &str,
    payload: &MarkPaidPayload,
    admin_id: i64,
    now_ms: i64,
) -> Result<MarkPaidResponse, String> {
    if payload.months < 1 || payload.months > 36 {
        return Err("months must be between 1 and 36".into());
    }

    let amount_paise = parse_rupees_to_paise(&payload.amount_rupees_text)
        .map_err(|e| format!("Invalid amount: {}", e))?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let (old_valid_until, current_status): (i64, String) = tx
        .query_row(
            "SELECT valid_until_day, status FROM tenants WHERE id = ?1",
            params![tenant_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("Tenant not found: {}", e))?;

    let today_day = ist_day(now_ms);
    let paid_day = payload.paid_day.unwrap_or(today_day);

    let base_day = old_valid_until.max(today_day - 1);
    let new_valid_until_day = add_months(base_day, payload.months);

    let note_str = payload.note.as_deref().unwrap_or("");

    tx.execute(
        "INSERT INTO payments (tenant_id, amount_paise, paid_day, months, old_valid_until_day, new_valid_until_day, note, admin_id, created_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            tenant_id,
            amount_paise,
            paid_day,
            payload.months,
            old_valid_until,
            new_valid_until_day,
            note_str,
            admin_id,
            now_ms
        ],
    ).map_err(|e| e.to_string())?;
    let payment_id = tx.last_insert_rowid();

    let new_status = if payload.resume.unwrap_or(false) && current_status == "suspended" {
        "active".to_string()
    } else {
        current_status
    };

    tx.execute(
        "UPDATE tenants SET valid_until_day = ?1, status = ?2 WHERE id = ?3",
        params![new_valid_until_day, new_status, tenant_id],
    ).map_err(|e| e.to_string())?;

    crate::db::append_audit(
        &tx,
        Some(admin_id),
        "tenant.mark_paid",
        Some(tenant_id),
        &format!(
            "Payment {} recorded: {} paise, {} months, extended from {} to {}",
            payment_id, amount_paise, payload.months, old_valid_until, new_valid_until_day
        ),
        now_ms,
    ).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(MarkPaidResponse {
        payment_id,
        old_valid_until_day: old_valid_until,
        new_valid_until_day,
        amount_paise,
        status: new_status,
    })
}

/// Computes the HMAC-SHA256 signature for a payment gateway transaction.
/// In standard gateways like Razorpay, the signed string is "order_id|payment_id".
pub fn compute_payment_signature(order_id: &str, payment_id: &str, secret: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC supports arbitrary length keys");
    let data = if order_id.is_empty() {
        payment_id.to_string()
    } else {
        format!("{}|{}", order_id, payment_id)
    };
    mac.update(data.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Verifies HMAC-SHA256 payment signature using constant-time comparison.
pub fn verify_payment_signature(
    order_id: &str,
    payment_id: &str,
    signature: &str,
    secret: &str,
) -> bool {
    let sig_clean = signature.trim();
    if secret.is_empty() || sig_clean.is_empty() {
        return false;
    }
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let data = if order_id.is_empty() {
        payment_id.to_string()
    } else {
        format!("{}|{}", order_id, payment_id)
    };
    mac.update(data.as_bytes());
    if let Ok(sig_bytes) = hex::decode(sig_clean) {
        mac.verify_slice(&sig_bytes).is_ok()
    } else {
        false
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentWebhookPayload {
    #[serde(default, alias = "razorpay_order_id")]
    pub order_id: String,
    #[serde(default, alias = "razorpay_payment_id")]
    pub payment_id: String,
    #[serde(default, alias = "razorpay_signature")]
    pub signature: String,
    pub tenant_id: String,
    #[serde(default)]
    pub months: Option<i64>,
    #[serde(default, alias = "amount_rupees")]
    pub amount_rupees_text: Option<String>,
    #[serde(default)]
    pub amount_paise: Option<i64>,
    #[serde(default)]
    pub amount: Option<serde_json::Value>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentWebhookResult {
    pub payment_id: i64,
    pub tenant_id: String,
    pub amount_paise: i64,
    pub old_valid_until_day: i64,
    pub new_valid_until_day: i64,
    pub status: String,
    pub licence: crate::licence::Licence,
}

/// Processes an automated payment gateway webhook atomically:
/// 1. Verifies HMAC-SHA256 signature against webhook secret.
/// 2. Parses amount strictly as integer paise with zero floats.
/// 3. Records payment transaction in `payments` ledger.
/// 4. Extends `valid_until_day = add_months(current.max(today - 1), months)` and sets `status = 'active'`.
/// 5. Appends immutable audit entry to `admin_audit`.
/// 6. Re-issues cryptographically signed Ed25519 license token with updated expiry and serial.
pub fn process_payment_webhook(
    conn: &mut Connection,
    signing_key: &SigningKey,
    payload: &PaymentWebhookPayload,
    secret: &str,
    now_ms: i64,
) -> std::result::Result<PaymentWebhookResult, String> {
    if !verify_payment_signature(&payload.order_id, &payload.payment_id, &payload.signature, secret) {
        return Err("Invalid payment signature".into());
    }

    let months = payload.months.unwrap_or(1);
    if months < 1 || months > 36 {
        return Err("months must be between 1 and 36".into());
    }

    let amount_paise = if let Some(paise) = payload.amount_paise {
        if paise < 0 {
            return Err("Negative amounts are not permitted".into());
        }
        paise
    } else if let Some(ref rupees_text) = payload.amount_rupees_text {
        parse_rupees_to_paise(rupees_text).map_err(|e| format!("Invalid amount: {}", e))?
    } else if let Some(ref val) = payload.amount {
        match val {
            serde_json::Value::Number(num) => {
                if let Some(i) = num.as_i64() {
                    if i < 0 {
                        return Err("Negative amounts are not permitted".into());
                    }
                    i
                } else {
                    return Err("Invalid amount number".into());
                }
            }
            serde_json::Value::String(s) => {
                parse_rupees_to_paise(s).map_err(|e| format!("Invalid amount: {}", e))?
            }
            _ => return Err("Invalid amount format".into()),
        }
    } else {
        return Err("Missing payment amount".into());
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let tenant_row: Option<(String, String, String, i64, String, u32, u32, u32, i64, u64)> = tx
        .query_row(
            "SELECT business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial
             FROM tenants WHERE id = ?1",
            params![payload.tenant_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .ok();

    let (
        business_name,
        vertical,
        plan,
        old_valid_until,
        _current_status,
        max_counters_row,
        offline_days,
        grace_days,
        export_permit_until_ms,
        next_serial,
    ) = match tenant_row {
        Some(row) => row,
        None => return Err(format!("Tenant not found: {}", payload.tenant_id)),
    };

    let today_day = ist_day(now_ms);
    let base_day = old_valid_until.max(today_day - 1);
    let new_valid_until_day = add_months(base_day, months);

    let note_str = match &payload.note {
        Some(n) if !n.is_empty() => n.clone(),
        _ => format!("Webhook: order={}, payment={}", payload.order_id, payload.payment_id),
    };

    tx.execute(
        "INSERT INTO payments (tenant_id, amount_paise, paid_day, months, old_valid_until_day, new_valid_until_day, note, admin_id, created_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            payload.tenant_id,
            amount_paise,
            today_day,
            months,
            old_valid_until,
            new_valid_until_day,
            note_str,
            0i64,
            now_ms
        ],
    ).map_err(|e| e.to_string())?;
    let payment_id = tx.last_insert_rowid();

    let new_serial = next_serial + 1;
    tx.execute(
        "UPDATE tenants SET valid_until_day = ?1, status = 'active', next_serial = ?2 WHERE id = ?3",
        params![new_valid_until_day, new_serial, payload.tenant_id],
    ).map_err(|e| e.to_string())?;

    crate::db::append_audit(
        &tx,
        None,
        "payment.webhook",
        Some(&payload.tenant_id),
        &format!(
            "Webhook payment {} recorded: order={}, payment={}, {} paise, {} months, valid_until extended from {} to {}",
            payment_id, payload.order_id, payload.payment_id, amount_paise, months, old_valid_until, new_valid_until_day
        ),
        now_ms,
    ).map_err(|e| e.to_string())?;

    let device_id = if let Some(ref did) = payload.device_id {
        if !did.is_empty() {
            did.clone()
        } else {
            tx.query_row(
                "SELECT id FROM devices WHERE tenant_id = ?1 AND revoked = 0 ORDER BY activated_ms ASC LIMIT 1",
                params![payload.tenant_id],
                |r| r.get(0),
            ).unwrap_or_else(|_| "".to_string())
        }
    } else {
        tx.query_row(
            "SELECT id FROM devices WHERE tenant_id = ?1 AND revoked = 0 ORDER BY activated_ms ASC LIMIT 1",
            params![payload.tenant_id],
            |r| r.get(0),
        ).unwrap_or_else(|_| "".to_string())
    };

    let max_counters = if plan == "basic" { 1 } else { max_counters_row };
    let features = crate::licence::features_for(&plan);
    let support_text = crate::settings::get_support_text(&tx);

    let licence_payload = crate::licence::LicencePayload {
        v: 1,
        tenant_id: payload.tenant_id.clone(),
        business_name,
        vertical,
        plan,
        features,
        max_counters,
        device_id,
        serial: next_serial,
        issued_ms: now_ms,
        valid_until_day: new_valid_until_day,
        offline_days,
        grace_days,
        status: "active".to_string(),
        export_permit_until_ms,
        support_text,
    };

    let licence = crate::licence::sign_licence(signing_key, licence_payload)
        .map_err(|e| format!("Failed to sign licence: {}", e))?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(PaymentWebhookResult {
        payment_id,
        tenant_id: payload.tenant_id.clone(),
        amount_paise,
        old_valid_until_day: old_valid_until,
        new_valid_until_day,
        status: "active".to_string(),
        licence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rupees_to_paise() {
        assert_eq!(parse_rupees_to_paise("4999"), Ok(499900));
        assert_eq!(parse_rupees_to_paise("4999.5"), Ok(499950));
        assert_eq!(parse_rupees_to_paise("4999.50"), Ok(499950));
        assert_eq!(parse_rupees_to_paise(".5"), Ok(50));
        assert_eq!(parse_rupees_to_paise("0.5"), Ok(50));
        assert_eq!(parse_rupees_to_paise("0.05"), Ok(5));
        assert_eq!(parse_rupees_to_paise("100.00"), Ok(10000));

        assert_eq!(parse_rupees_to_paise("49.999"), Err(ParseAmountError::TooManyDecimals));
        assert_eq!(parse_rupees_to_paise("abc"), Err(ParseAmountError::InvalidCharacter));
        assert_eq!(parse_rupees_to_paise("-100"), Err(ParseAmountError::Negative));
        assert_eq!(parse_rupees_to_paise(""), Err(ParseAmountError::Empty));
        assert_eq!(parse_rupees_to_paise("   "), Err(ParseAmountError::Empty));
        assert_eq!(parse_rupees_to_paise("1.2.3"), Err(ParseAmountError::MultipleDecimals));
    }

    #[test]
    fn test_payment_signature_verification() {
        let secret = "rzp_secret_key_123456";
        let order_id = "order_EKmFuoKf43rIvE";
        let payment_id = "pay_EKmG1234567890";
        let sig = compute_payment_signature(order_id, payment_id, secret);

        assert!(verify_payment_signature(order_id, payment_id, &sig, secret));

        // Wrong secret fails
        assert!(!verify_payment_signature(order_id, payment_id, &sig, "wrong_secret"));

        // Tampered order_id fails
        assert!(!verify_payment_signature("order_tampered", payment_id, &sig, secret));

        // Tampered payment_id fails
        assert!(!verify_payment_signature(order_id, "pay_tampered", &sig, secret));

        // Tampered signature fails
        assert!(!verify_payment_signature(order_id, payment_id, "bad_signature_hex", secret));

        // Empty parameters
        assert!(!verify_payment_signature(order_id, payment_id, "", secret));
        assert!(!verify_payment_signature(order_id, payment_id, &sig, ""));
    }

    #[test]
    fn test_process_payment_webhook_flow() {
        use crate::db::{init_schema, open_in_memory, verify_chain};
        use rand::rngs::OsRng;

        let mut conn = open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut rng = OsRng;
        let signing_key = SigningKey::generate(&mut rng);

        let now_ms = 1_700_000_000_000i64;
        let today = ist_day(now_ms);

        // Insert a tenant
        conn.execute(
            "INSERT INTO tenants (id, business_name, vertical, plan, valid_until_day, status, max_counters, offline_days, grace_days, export_permit_until_ms, next_serial, created_ms, notes)
             VALUES ('t1', 'Super Store', 'retail', 'pro', ?1, 'suspended', 3, 5, 0, 0, 1, ?2, '')",
            params![today - 10, now_ms],
        ).unwrap();

        let secret = "whsec_test_secret";
        let order_id = "order_12345";
        let payment_id = "pay_67890";
        let sig = compute_payment_signature(order_id, payment_id, secret);

        let payload = PaymentWebhookPayload {
            order_id: order_id.to_string(),
            payment_id: payment_id.to_string(),
            signature: sig,
            tenant_id: "t1".to_string(),
            months: Some(3),
            amount_rupees_text: Some("4999.00".to_string()),
            amount_paise: None,
            amount: None,
            note: Some("Quarterly renewal".to_string()),
            device_id: None,
        };

        let result = process_payment_webhook(&mut conn, &signing_key, &payload, secret, now_ms).unwrap();
        assert_eq!(result.tenant_id, "t1");
        assert_eq!(result.amount_paise, 499900);
        assert_eq!(result.status, "active");
        assert_eq!(result.old_valid_until_day, today - 10);
        assert_eq!(result.new_valid_until_day, add_months(today - 1, 3));
        assert_eq!(result.licence.payload.valid_until_day, add_months(today - 1, 3));
        assert_eq!(result.licence.payload.status, "active");

        // Verify database state
        let (valid_until, status): (i64, String) = conn
            .query_row("SELECT valid_until_day, status FROM tenants WHERE id = 't1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(status, "active");
        assert_eq!(valid_until, add_months(today - 1, 3));

        // Verify audit chain
        assert!(verify_chain(&conn).is_ok());
    }
}
