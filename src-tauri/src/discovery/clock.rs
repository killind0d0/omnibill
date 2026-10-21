//! Business time helper for IST (UTC+5:30)
//!
//! Provides deterministic integer math for converting Unix millisecond timestamps
//! and calendar dates into IST business day numbers and business hours.
//! ZERO floats used.

pub const IST_OFFSET_MS: i64 = 19_800_000;
pub const MS_PER_DAY: i64 = 86_400_000;
pub const MS_PER_HOUR: i64 = 3_600_000;

/// Computes the IST business day index (days since 1970-01-01 in IST) from a UTC Unix millisecond timestamp.
#[inline]
pub fn business_day(unix_ms: i64) -> i64 {
    (unix_ms + IST_OFFSET_MS).div_euclid(MS_PER_DAY)
}

/// Computes the IST business hour (0..=23) from a UTC Unix millisecond timestamp.
#[inline]
pub fn business_hour(unix_ms: i64) -> i64 {
    ((unix_ms + IST_OFFSET_MS).rem_euclid(MS_PER_DAY)) / MS_PER_HOUR
}

/// Converts a calendar date string `YYYY-MM-DD` directly to days since 1970-01-01.
/// Pure integer arithmetic (Howard Hinnant algorithm).
pub fn parse_date_to_day(date_str: &str) -> Option<i64> {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let d: i64 = parts[2].parse().ok()?;

    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }

    let y_adj = if m <= 2 { y - 1 } else { y };
    let era = if y_adj >= 0 { y_adj } else { y_adj - 399 } / 400;
    let yoe = (y_adj - era * 400) as u64;
    let m_adj = if m > 2 { m - 3 } else { m + 9 } as u64;
    let doy = (153 * m_adj + 2) / 5 + (d as u64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = (era * 146097) + (doe as i64) - 719468;
    Some(days)
}

/// Helper that converts days since 1970-01-01 back to `YYYY-MM-DD` string.
pub fn day_to_date_str(days: i64) -> String {
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y_final = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y_final, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clock_fixed_values() {
        assert_eq!(business_day(0), 0);
        assert_eq!(business_hour(0), 5); // 00:00 UTC = 05:30 IST -> hour 5

        // Case crossing midnight IST:
        // 18:29:59 UTC = 66_599_000 ms -> 23:59:59 IST (day 0, hour 23)
        let t_before = 66_599_000;
        assert_eq!(business_day(t_before), 0);
        assert_eq!(business_hour(t_before), 23);

        // 18:30:00 UTC = 66_600_000 ms -> 00:00:00 IST (day 1, hour 0)
        let t_midnight = 66_600_000;
        assert_eq!(business_day(t_midnight), 1);
        assert_eq!(business_hour(t_midnight), 0);
    }

    #[test]
    fn test_clock_date_string_conversion_roundtrip() {
        let cases = ["1970-01-01", "2026-01-01", "2026-04-15", "2028-12-31"];
        for s in &cases {
            let day = match parse_date_to_day(s) {
                Some(d) => d,
                None => panic!("failed to parse date: {}", s),
            };
            let roundtrip = day_to_date_str(day);
            assert_eq!(s, &roundtrip);
        }
        assert_eq!(parse_date_to_day("1970-01-01"), Some(0));
    }
}
