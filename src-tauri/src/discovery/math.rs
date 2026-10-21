#![deny(clippy::float_arithmetic)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    DivByZero,
}

impl std::fmt::Display for MathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MathError::Overflow => write!(f, "Integer math overflow"),
            MathError::DivByZero => write!(f, "Division by zero"),
        }
    }
}

impl std::error::Error for MathError {}

pub const SENTINEL_RUNOUT_DAYS_X10: i64 = 999_999;

/// Divides `num` by `den` and rounds half away from zero.
///
/// Rule:
/// `den > 0` is required.
/// For non-negative numerator (`num >= 0`): `(num + den / 2) / den`
/// For negative numerator (`num < 0`): `(num - den / 2) / den`
/// Rounds half values away from zero (for example, 5/2 rounds to 3, -5/2 rounds to -3).
/// Returns `MathError::DivByZero` if `den <= 0`.
/// Returns `MathError::Overflow` if intermediate sum overflows or result does not fit `i64`.
pub fn div_round_half_up(num: i128, den: i128) -> Result<i64, MathError> {
    if den <= 0 {
        return Err(MathError::DivByZero);
    }
    let half = den / 2;
    let rounded = if num >= 0 {
        num.checked_add(half).ok_or(MathError::Overflow)? / den
    } else {
        num.checked_sub(half).ok_or(MathError::Overflow)? / den
    };
    i64::try_from(rounded).map_err(|_| MathError::Overflow)
}

/// Computes margin in basis points (10000 bp = 100%).
///
/// Formula: `div_round_half_up((net_paise - cogs_paise) * 10000, net_paise)`
/// If `net_paise == 0`, returns 0 bp.
pub fn margin_bp(net_paise: i64, cogs_paise: i64) -> Result<i64, MathError> {
    if net_paise == 0 {
        return Ok(0);
    }
    let diff = (net_paise as i128)
        .checked_sub(cogs_paise as i128)
        .ok_or(MathError::Overflow)?;
    let num = diff.checked_mul(10_000).ok_or(MathError::Overflow)?;
    if net_paise > 0 {
        div_round_half_up(num, net_paise as i128)
    } else {
        div_round_half_up(-num, -(net_paise as i128))
    }
}

/// Computes effective active days in a window discounting stocked-out days.
///
/// Formula: `max(window - stocked_out_days, min(window, 3))`
pub fn effective_days(window: i64, stocked_out_days: i64) -> i64 {
    let diff = window.saturating_sub(stocked_out_days);
    let floor = std::cmp::min(window, 3);
    std::cmp::max(diff, floor)
}

/// Computes runout days in integer tenths of a day (10 = 1 day, 600 = 60 days).
///
/// Formula: `div_round_half_up(stock_milli * eff_days * 10, qty_window_milli)`
/// If `qty_window_milli <= 0`, returns sentinel `999_999`.
/// Clamps result at `0..=999_999`.
pub fn runout_days_x10(
    stock_milli: i64,
    qty_window_milli: i64,
    eff_days: i64,
) -> Result<i64, MathError> {
    if qty_window_milli <= 0 {
        return Ok(SENTINEL_RUNOUT_DAYS_X10);
    }
    if stock_milli <= 0 {
        return Ok(0);
    }
    let num = (stock_milli as i128)
        .checked_mul(eff_days as i128)
        .ok_or(MathError::Overflow)?
        .checked_mul(10)
        .ok_or(MathError::Overflow)?;
    let res = div_round_half_up(num, qty_window_milli as i128)?;
    if res > SENTINEL_RUNOUT_DAYS_X10 {
        Ok(SENTINEL_RUNOUT_DAYS_X10)
    } else if res < 0 {
        Ok(0)
    } else {
        Ok(res)
    }
}

// TODO blend: using simpler runout_days_x10 with 30-day window per instruction to avoid unproven algebra

/// Computes Gross Margin Return on Investment (GMROI) in basis points.
///
/// Formula: `div_round_half_up(gp_paise * 10000, avg_inventory_paise)`
/// Returns 0 if `avg_inventory_paise <= 0`.
pub fn gmroi_bp(gp_paise: i64, avg_inventory_paise: i64) -> Result<i64, MathError> {
    if avg_inventory_paise <= 0 {
        return Ok(0);
    }
    let num = (gp_paise as i128)
        .checked_mul(10_000)
        .ok_or(MathError::Overflow)?;
    div_round_half_up(num, avg_inventory_paise as i128)
}

/// Computes annualised GMROI in basis points over a window of days.
///
/// Formula: `div_round_half_up(gp_paise * 365 * 10000, avg_inventory_paise * window_days)`
pub fn gmroi_annual_bp(
    gp_paise: i64,
    avg_inventory_paise: i64,
    window_days: i64,
) -> Result<i64, MathError> {
    if avg_inventory_paise <= 0 || window_days <= 0 {
        return Ok(0);
    }
    let num = (gp_paise as i128)
        .checked_mul(365)
        .ok_or(MathError::Overflow)?
        .checked_mul(10_000)
        .ok_or(MathError::Overflow)?;
    let den = (avg_inventory_paise as i128)
        .checked_mul(window_days as i128)
        .ok_or(MathError::Overflow)?;
    div_round_half_up(num, den)
}

/// Computes valuation in paise for a lot quantity and whole-unit rate.
///
/// Formula: `div_round_half_up(qty_milli * rate_paise, 1000)`
pub fn lot_value_paise(qty_milli: i64, rate_paise: i64) -> Result<i64, MathError> {
    let num = (qty_milli as i128)
        .checked_mul(rate_paise as i128)
        .ok_or(MathError::Overflow)?;
    div_round_half_up(num, 1000)
}

/// Checks whether stock is dead based on inactivity threshold.
///
/// Rule: `stock_milli > 0 && today - max(last_sold_day, last_received_day) >= threshold_days`
pub fn is_dead(
    stock_milli: i64,
    last_sold_day: i64,
    last_received_day: i64,
    today: i64,
    threshold_days: i64,
) -> bool {
    if stock_milli <= 0 {
        return false;
    }
    let last_active = std::cmp::max(last_sold_day, last_received_day);
    today.saturating_sub(last_active) >= threshold_days
}

/// Classifies cumulative revenue into ABC tier:
/// Class 1 (A): top 80% of revenue (`cum_before * 10000 < 8000 * total`)
/// Class 2 (B): next 15% of revenue (`cum_before * 10000 < 9500 * total`)
/// Class 3 (C): remaining 5% of revenue or zero total revenue
pub fn abc_class(cum_before_paise: i64, total_paise: i64) -> u8 {
    if total_paise <= 0 {
        return 3;
    }
    let cum_scaled = (cum_before_paise as i128).saturating_mul(10_000);
    let total_128 = total_paise as i128;
    if cum_scaled < 8_000 * total_128 {
        1
    } else if cum_scaled < 9_500 * total_128 {
        2
    } else {
        3
    }
}

/// Calculates quantity in milli-units at risk of expiring unsold.
///
/// Floor documentation:
/// The quantity expected to be sold before expiry is calculated as:
/// integer division `(rate_per_day_num * days_to_expiry) / rate_per_day_den`.
/// In Rust integer arithmetic on non-negative integers, this division truncates toward zero,
/// which matches the mathematical floor operation.
/// Formula: `max(0, stock_milli - floor(rate_num * days_to_expiry / rate_den))`
pub fn at_risk_milli(
    stock_milli: i64,
    rate_per_day_num: i64,
    rate_per_day_den: i64,
    days_to_expiry: i64,
) -> Result<i64, MathError> {
    if rate_per_day_den <= 0 {
        return Err(MathError::DivByZero);
    }
    if stock_milli <= 0 {
        return Ok(0);
    }
    if days_to_expiry <= 0 {
        return Ok(stock_milli);
    }
    let mult = (rate_per_day_num as i128)
        .checked_mul(days_to_expiry as i128)
        .ok_or(MathError::Overflow)?;
    let expected_sold_128 = mult / (rate_per_day_den as i128);
    let expected_sold = i64::try_from(expected_sold_128).map_err(|_| MathError::Overflow)?;
    Ok(std::cmp::max(0, stock_milli.saturating_sub(expected_sold)))
}
