//! Control Plane server URL configuration and enforcement.
//!
//! Rule 1: In debug builds default to `http://127.0.0.1:8080`.
//! Rule 2: In release builds a missing value is a compile error.
//! Rule 3: Release builds reject any non-`https://` URL at runtime too.

#[cfg(debug_assertions)]
pub const CONTROL_PLANE_URL: &str = match option_env!("OMNIBILL_CONTROL_URL") {
    Some(u) => u,
    None => "http://127.0.0.1:8080",
};

#[cfg(not(debug_assertions))]
pub const CONTROL_PLANE_URL: &str = match option_env!("OMNIBILL_CONTROL_URL") {
    Some(u) => u,
    None => panic!("compile_error: OMNIBILL_CONTROL_URL must be set in release builds"),
};

#[cfg(not(debug_assertions))]
const _: () = {
    assert!(
        option_env!("OMNIBILL_CONTROL_URL").is_some(),
        "compile_error: OMNIBILL_CONTROL_URL must be set in release builds"
    );
};

/// Returns the configured Control Plane URL, enforcing that release builds strictly require `https://`.
pub fn get_control_plane_url() -> Result<&'static str, &'static str> {
    #[cfg(not(debug_assertions))]
    {
        if !CONTROL_PLANE_URL.starts_with("https://") {
            return Err("In release builds, control plane URL must use https://");
        }
    }
    Ok(CONTROL_PLANE_URL)
}
