use rusqlite::{params, Connection, Result};
use crate::civil::{add_months, ist_day};
use serde::{Deserialize, Serialize};

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
}
