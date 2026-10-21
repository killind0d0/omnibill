//! Monotonic clock guard helper.
//! Enforces non-decreasing time tracking to defend against system clock rollback attacks.

/// Advances the maximum seen timestamp monotonically.
pub fn advance_max_seen(prev: i64, now: i64) -> i64 {
    prev.max(now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_advance_max_seen() {
        assert_eq!(advance_max_seen(100, 150), 150);
        assert_eq!(advance_max_seen(150, 120), 150);
        assert_eq!(advance_max_seen(150, 150), 150);
        assert_eq!(advance_max_seen(0, 10), 10);
    }
}
