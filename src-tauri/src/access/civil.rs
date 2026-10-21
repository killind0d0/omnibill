//! Civil date arithmetic (Howard Hinnant algorithm) and IST day calculations.
//! Pure integer math, zero floats, deterministic day indexing from Unix epoch.

pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub const IST_OFFSET_MS: i64 = 19_800_000;

pub fn ist_day(unix_ms: i64) -> i64 {
    (unix_ms + IST_OFFSET_MS).div_euclid(86_400_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_civil_vectors() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 2, 29), 11016);
        assert_eq!(days_from_civil(2026, 10, 21), 20747);

        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11016), (2000, 2, 29));
        assert_eq!(civil_from_days(20747), (2026, 10, 21));

        let start_day = days_from_civil(1970, 1, 1);
        let end_day = days_from_civil(2100, 12, 31);
        for z in start_day..=end_day {
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }

        assert_eq!(ist_day(0), 0);
        assert_eq!(ist_day(18 * 3600 * 1000 + 29 * 60_000 + 59_999), 0);
        assert_eq!(ist_day(18 * 3600 * 1000 + 30 * 60_000), 1);
    }
}
