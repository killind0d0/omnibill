use rusqlite::{params, Connection, Result};

pub fn get_support_text(conn: &Connection) -> String {
    conn.query_row(
        "SELECT value FROM server_settings WHERE key = 'support_text'",
        [],
        |r| r.get(0),
    )
    .unwrap_or_default()
}

pub fn set_support_text(
    conn: &Connection,
    text: &str,
    admin_id: i64,
    now_ms: i64,
) -> Result<(), String> {
    if text.chars().count() > 120 {
        return Err("Support text cannot exceed 120 characters".into());
    }

    conn.execute(
        "INSERT INTO server_settings (key, value) VALUES ('support_text', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![text],
    )
    .map_err(|e| e.to_string())?;

    crate::db::append_audit(
        conn,
        Some(admin_id),
        "settings.support_text_updated",
        None,
        &format!("Updated support text to: {}", text),
        now_ms,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
