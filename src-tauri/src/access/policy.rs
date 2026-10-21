//! Policy constants for OmniBill Access & Licensing System.
//! All policy constants are centralized in this single file.

pub const OFFLINE_WINDOW_DAYS_DEFAULT: i64 = 3;
pub const EXPIRY_GRACE_DAYS_DEFAULT: i64 = 0;
pub const LOCKOUT_FAILED_ATTEMPTS: u32 = 5;
pub const LOCKOUT_MINUTES: i64 = 15;
pub const SESSION_IDLE_MINUTES: i64 = 15;
pub const SESSION_ABSOLUTE_HOURS: i64 = 12;
pub const CLOCK_ROLLBACK_TOLERANCE_MIN: i64 = 10;
pub const OWNER_RESET_VALID_HOURS: i64 = 72;
pub const LAN_PAIRING_CODE_MINUTES: i64 = 10;
pub const LAN_IDEMPOTENCY_HOURS: i64 = 24;

// Argon2id parameters
#[cfg(not(test))]
pub const ARGON2_M_COST: u32 = 19456; // 19456 KiB
#[cfg(not(test))]
pub const ARGON2_T_COST: u32 = 2; // 2 iterations
#[cfg(not(test))]
pub const ARGON2_P_COST: u32 = 1; // 1 parallelism

#[cfg(test)]
pub const ARGON2_M_COST: u32 = 1024; // Fast for testing
#[cfg(test)]
pub const ARGON2_T_COST: u32 = 1;
#[cfg(test)]
pub const ARGON2_P_COST: u32 = 1;

/// Validates whether a given role string is recognized and valid for the given vertical.
pub fn is_role_valid_for_vertical(role: &str, vertical: &str) -> bool {
    match role {
        "owner" | "co_owner" | "manager" => {
            matches!(vertical, "retail" | "wholesale" | "hospital" | "school")
        }
        "cashier" | "stock_clerk" => matches!(vertical, "retail" | "wholesale"),
        "accountant" => matches!(vertical, "wholesale" | "hospital"),
        "pharmacist" | "front_desk" | "lab_tech" => vertical == "hospital",
        "bursar" | "clerk" => vertical == "school",
        _ => false,
    }
}
