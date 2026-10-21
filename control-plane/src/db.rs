use rusqlite::{params, Connection, Result};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const INIT_SQL: &str = include_str!("../migrations/001_init.sql");

pub fn open_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(INIT_SQL)
}

pub fn compute_audit_hash(
    prev_hash: &[u8],
    ts_ms: i64,
    admin_id: Option<i64>,
    action: &str,
    tenant_id: Option<&str>,
    detail: &str,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash);
    hasher.update(&ts_ms.to_be_bytes());
    hasher.update(&admin_id.unwrap_or(0).to_be_bytes());
    hasher.update(action.as_bytes());
    hasher.update(tenant_id.unwrap_or("").as_bytes());
    hasher.update(detail.as_bytes());
    hasher.finalize().into()
}

pub fn append_audit(
    conn: &Connection,
    admin_id: Option<i64>,
    action: &str,
    tenant_id: Option<&str>,
    detail: &str,
    ts_ms: i64,
) -> Result<i64> {
    let prev_hash: Vec<u8> = conn
        .query_row(
            "SELECT hash FROM admin_audit ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| vec![0u8; 32]);

    let hash = compute_audit_hash(&prev_hash, ts_ms, admin_id, action, tenant_id, detail);

    conn.execute(
        "INSERT INTO admin_audit (ts_ms, admin_id, action, tenant_id, detail, prev_hash, hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            ts_ms,
            admin_id,
            action,
            tenant_id,
            detail,
            prev_hash,
            hash.as_slice()
        ],
    )?;

    Ok(conn.last_insert_rowid())
}

pub fn verify_chain(conn: &Connection) -> std::result::Result<(), i64> {
    let mut stmt = match conn.prepare(
        "SELECT id, ts_ms, admin_id, action, tenant_id, detail, prev_hash, hash
         FROM admin_audit ORDER BY id ASC",
    ) {
        Ok(s) => s,
        Err(_) => return Err(0),
    };

    let mut expected_prev_hash = vec![0u8; 32];

    let rows = match stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<i64>>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, Vec<u8>>(6)?,
            r.get::<_, Vec<u8>>(7)?,
        ))
    }) {
        Ok(rows) => rows,
        Err(_) => return Err(0),
    };

    for row_res in rows {
        let (id, ts_ms, admin_id, action, tenant_id, detail, prev_hash, hash) = match row_res {
            Ok(r) => r,
            Err(_) => return Err(0),
        };

        if prev_hash != expected_prev_hash {
            return Err(id);
        }

        let computed = compute_audit_hash(
            &prev_hash,
            ts_ms,
            admin_id,
            &action,
            tenant_id.as_deref(),
            &detail,
        );

        if computed.as_slice() != hash.as_slice() {
            return Err(id);
        }

        expected_prev_hash = hash;
    }

    Ok(())
}
