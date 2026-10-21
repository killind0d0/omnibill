use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;

/// In-memory sliding window rate limiter.
pub struct SlidingWindowLimiter {
    window_ms: i64,
    max_requests: usize,
    history: Mutex<HashMap<String, Vec<i64>>>,
}

impl SlidingWindowLimiter {
    pub fn new(window_ms: i64, max_requests: usize) -> Self {
        Self {
            window_ms,
            max_requests,
            history: Mutex::new(HashMap::new()),
        }
    }

    /// Checks if a request for `key` is permitted at `now_ms`.
    /// If permitted, records the timestamp and returns `true`.
    /// If rate-limited, returns `false`.
    pub fn check_and_record(&self, key: &str, now_ms: i64) -> bool {
        let mut lock = match self.history.lock() {
            Ok(l) => l,
            Err(poisoned) => poisoned.into_inner(),
        };

        let entries = lock.entry(key.to_string()).or_default();
        let cutoff = now_ms - self.window_ms;
        entries.retain(|&ts| ts > cutoff);

        if entries.len() >= self.max_requests {
            false
        } else {
            entries.push(now_ms);
            true
        }
    }

    pub fn reset(&self) {
        let mut lock = match self.history.lock() {
            Ok(l) => l,
            Err(poisoned) => poisoned.into_inner(),
        };
        lock.clear();
    }
}

/// Resolves client IP: from `peer_addr`, and from `X-Forwarded-For` ONLY when `peer_addr` is loopback (127.0.0.1).
pub fn extract_client_ip(peer_addr: SocketAddr, x_forwarded_for: Option<&str>) -> String {
    if peer_addr.ip().is_loopback() {
        if let Some(xff) = x_forwarded_for {
            if let Some(client) = xff.split(',').next() {
                let trimmed = client.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    peer_addr.ip().to_string()
}
