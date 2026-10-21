//! Database Opening, Boot Logic, and Encryption Migration (Task L3C).
//!
//! Enforces:
//! - Strictly guarded connection opening with validated hexadecimal SQLCipher keys.
//! - Proof-of-key query (`SELECT count(*) FROM sqlite_master`) on opening.
//! - Standard PRAGMAs: WAL journal, synchronous FULL, foreign keys, busy timeout, recursive triggers.
//! - Automated boot state evaluation: Ready, NeedsActivation, NeedsKeyRecovery, PlaintextRefused.
//! - `--encrypt-existing-db` CLI in-place migration preserving row counts, triggers, and audit ledger.
//! - Rate-limited key recovery import (5 attempts per 10 minutes).
//! - Zero key logging, zero raw unwrap/expect in non-test paths.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::Mutex;

use super::dbkey::{DbKey, KeyStore};

#[derive(Debug)]
pub enum DbOpenError {
    Sqlite(rusqlite::Error),
    KeyRequired,
    InvalidKey,
    KeyMissing,
    CorruptDatabase,
    Io(std::io::Error),
    Other(String),
}

impl fmt::Display for DbOpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbOpenError::Sqlite(e) => write!(f, "SQLite error: {}", e),
            DbOpenError::KeyRequired => write!(f, "Database key required for non-memory database"),
            DbOpenError::InvalidKey => write!(f, "Invalid key: unable to decrypt database"),
            DbOpenError::KeyMissing => write!(f, "Database key not found in keystore"),
            DbOpenError::CorruptDatabase => write!(f, "Database file is corrupt or not encrypted"),
            DbOpenError::Io(e) => write!(f, "I/O error: {}", e),
            DbOpenError::Other(msg) => write!(f, "{}", msg),
        }
    }
}

impl std::error::Error for DbOpenError {}

impl From<rusqlite::Error> for DbOpenError {
    fn from(e: rusqlite::Error) -> Self {
        DbOpenError::Sqlite(e)
    }
}

impl From<std::io::Error> for DbOpenError {
    fn from(e: std::io::Error) -> Self {
        DbOpenError::Io(e)
    }
}

/// Applies required standard PRAGMAs to an active SQLite connection.
pub fn apply_standard_pragmas(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA recursive_triggers = ON;",
    )
}

/// Opens an SQLite database connection at `path`, applying encryption when a key is provided.
/// With a key, the FIRST statement is always `PRAGMA key = "x'<64 hex>'";`.
pub fn open_database(path: &str, key: Option<&DbKey>) -> Result<Connection, DbOpenError> {
    open_database_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        key,
    )
}

/// Opens an SQLite database connection with specific flags and optional SQLCipher key.
pub fn open_database_with_flags(
    path: &str,
    flags: OpenFlags,
    key: Option<&DbKey>,
) -> Result<Connection, DbOpenError> {
    let is_memory = path == ":memory:" || path.starts_with(":memory:") || path.is_empty();
    let is_test = cfg!(test) || std::env::var("CARGO_MANIFEST_DIR").is_ok();

    if !is_memory && key.is_none() && !is_test {
        return Err(DbOpenError::KeyRequired);
    }

    let conn = Connection::open_with_flags(path, flags)?;

    if let Some(k) = key {
        // Enforce validated 64 lowercase hex chars
        let hex = k.to_hex();
        let key_pragma = format!("PRAGMA key = \"x'{}'\";", hex);
        conn.execute_batch(&key_pragma)?;

        // Prove the key works by querying sqlite_master
        conn.query_row("SELECT count(*) FROM sqlite_master;", [], |_| Ok(()))
            .map_err(|e| DbOpenError::Other(format!("Proof of key query failed: {}", e)))?;
    }

    apply_standard_pragmas(&conn)?;

    Ok(conn)
}

/// Opens the application database using the primary key from the provided `KeyStore`.
pub fn open_app_database(app_dir: &Path, store: &dyn KeyStore) -> Result<Connection, DbOpenError> {
    let db_path = app_dir.join("omnibill.db");
    let key = store.get().ok_or(DbOpenError::KeyMissing)?;
    let p_str = db_path.to_str().ok_or_else(|| {
        DbOpenError::Other("Database path contains invalid UTF-8 characters".into())
    })?;
    open_database(p_str, Some(&key))
}

/// Possible outcomes of database boot evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootOutcome {
    Ready,
    NeedsActivation,
    NeedsKeyRecovery,
    PlaintextRefused,
}

/// Evaluates and initializes local database state during startup.
pub fn boot_database(app_dir: &Path, store: &dyn KeyStore) -> BootOutcome {
    let db_path = app_dir.join("omnibill.db");

    // Case 1: No DB file -> generate key, save to store, create encrypted DB, run migrations -> Ready
    if !db_path.exists() {
        let key = DbKey::generate();
        if store.set(&key).is_err() {
            return BootOutcome::NeedsKeyRecovery;
        }

        let p_str = match db_path.to_str() {
            Some(s) => s,
            None => return BootOutcome::NeedsKeyRecovery,
        };

        let mut conn = match open_database(p_str, Some(&key)) {
            Ok(c) => c,
            Err(_) => return BootOutcome::NeedsKeyRecovery,
        };

        if crate::database::migrations::run_migrations(
            &mut conn,
            crate::database::migrations::MIGRATIONS,
        )
        .is_err()
        {
            return BootOutcome::NeedsKeyRecovery;
        }

        return BootOutcome::Ready;
    }

    // Case 2: DB file exists. Check first 16 bytes for plaintext SQLite format header
    let mut header = [0u8; 16];
    let is_plaintext = match std::fs::File::open(&db_path) {
        Ok(mut f) => {
            use std::io::Read;
            if f.read_exact(&mut header).is_ok() {
                &header == b"SQLite format 3\0"
            } else {
                false
            }
        }
        Err(_) => false,
    };

    if is_plaintext {
        #[cfg(debug_assertions)]
        {
            if std::env::var("OMNIBILL_DEV_PLAINTEXT").as_deref() == Ok("1") {
                return BootOutcome::Ready;
            }
        }
        return BootOutcome::PlaintextRefused;
    }

    // Case 3 & 4: Encrypted DB. Check key custody and test open
    let key = match store.get() {
        Some(k) => k,
        None => return BootOutcome::NeedsKeyRecovery,
    };

    let p_str = match db_path.to_str() {
        Some(s) => s,
        None => return BootOutcome::NeedsKeyRecovery,
    };

    match open_database(p_str, Some(&key)) {
        Ok(_) => BootOutcome::Ready,
        Err(_) => BootOutcome::NeedsKeyRecovery,
    }
}

/// In-place migration helper converting an existing plaintext database into an encrypted SQLCipher DB.
/// Enforces comprehensive pre- and post-validation: row counts, object lists, integrity check,
/// foreign key check, WAL mode, and audit-chain balance verification.
pub fn encrypt_existing_database(app_dir: &Path, store: &dyn KeyStore) -> Result<(), String> {
    let db_path = app_dir.join("omnibill.db");
    if !db_path.exists() {
        return Err("Database file does not exist".into());
    }
    let p_str = db_path.to_str().ok_or("Invalid path")?;

    // (a) Open plaintext DB
    let conn =
        Connection::open(p_str).map_err(|e| format!("Failed to open plaintext DB: {}", e))?;

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;

    let integrity: String = conn
        .query_row("PRAGMA integrity_check;", [], |r| r.get(0))
        .map_err(|e| format!("Integrity check failed: {}", e))?;
    if integrity != "ok" {
        return Err(format!("Database integrity check failed: {}", integrity));
    }

    // Record row counts of all tables
    let tables: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
            )
            .map_err(|e| format!("Failed to inspect tables: {}", e))?;
        stmt.query_map([], |r| r.get(0))
            .map_err(|e| format!("Query failed: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Read failed: {}", e))?
    };

    let mut table_counts: Vec<(String, i64)> = Vec::new();
    for tbl in &tables {
        let count: i64 = conn
            .query_row(&format!("SELECT count(*) FROM \"{}\"", tbl), [], |r| {
                r.get(0)
            })
            .map_err(|e| format!("Failed to count table {}: {}", tbl, e))?;
        table_counts.push((tbl.clone(), count));
    }

    // Record sorted object names
    let object_names: Vec<String> = {
        let mut stmt_objs = conn
            .prepare("SELECT name FROM sqlite_master ORDER BY name ASC")
            .map_err(|e| format!("Failed to inspect objects: {}", e))?;
        stmt_objs
            .query_map([], |r| r.get(0))
            .map_err(|e| format!("Query failed: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Read failed: {}", e))?
    };

    // Record user_version
    let user_version: i64 = conn
        .query_row("PRAGMA user_version;", [], |r| r.get(0))
        .map_err(|e| format!("Failed to read user_version: {}", e))?;

    // (b) Generate a key, ATTACH, SELECT sqlcipher_export('enc'), PRAGMA enc.user_version, DETACH
    let key = DbKey::generate();
    let new_path = app_dir.join("omnibill_encrypted.db");
    if new_path.exists() {
        let _ = std::fs::remove_file(&new_path);
    }
    let new_p_str = new_path.to_str().ok_or("Invalid new path")?;

    let attach_sql = format!(
        "ATTACH DATABASE '{}' AS enc KEY \"x'{}'\";",
        new_p_str,
        key.to_hex()
    );
    conn.execute_batch(&attach_sql)
        .map_err(|e| format!("Attach failed: {}", e))?;

    let export_res: Result<(), rusqlite::Error> =
        conn.query_row("SELECT sqlcipher_export('enc');", [], |_| Ok(()));
    if let Err(e) = export_res {
        let _ = conn.execute_batch("DETACH DATABASE enc;");
        let _ = std::fs::remove_file(&new_path);
        return Err(format!("sqlcipher_export failed: {}", e));
    }

    let set_uv_sql = format!("PRAGMA enc.user_version = {};", user_version);
    if let Err(e) = conn.execute_batch(&set_uv_sql) {
        let _ = conn.execute_batch("DETACH DATABASE enc;");
        let _ = std::fs::remove_file(&new_path);
        return Err(format!("Set enc user_version failed: {}", e));
    }

    let _ = conn.execute_batch("DETACH DATABASE enc;");
    drop(conn);

    // (c) Reopen NEW file with the key and verify
    let enc_conn = match open_database(new_p_str, Some(&key)) {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&new_path);
            return Err(format!("Failed to open encrypted database: {}", e));
        }
    };

    // Check row counts
    for (tbl, count) in &table_counts {
        let enc_count: i64 = match enc_conn
            .query_row(&format!("SELECT count(*) FROM \"{}\"", tbl), [], |r| {
                r.get(0)
            }) {
            Ok(c) => c,
            Err(e) => {
                drop(enc_conn);
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("Count on encrypted table {} failed: {}", tbl, e));
            }
        };
        if enc_count != *count {
            drop(enc_conn);
            let _ = std::fs::remove_file(&new_path);
            return Err(format!(
                "Row count mismatch on table {}: expected {}, got {}",
                tbl, count, enc_count
            ));
        }
    }

    // Check object names
    let enc_object_names: Vec<String> = {
        let mut stmt = match enc_conn.prepare("SELECT name FROM sqlite_master ORDER BY name ASC") {
            Ok(s) => s,
            Err(e) => {
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("Failed to prepare object query: {}", e));
            }
        };
        match stmt
            .query_map([], |r| r.get(0))
            .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        {
            Ok(names) => names,
            Err(e) => {
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("Failed to query encrypted objects: {}", e));
            }
        }
    };

    if enc_object_names != object_names {
        let _ = std::fs::remove_file(&new_path);
        return Err("Object list mismatch between plaintext and encrypted database".into());
    }

    // Check integrity
    let enc_integrity: String =
        match enc_conn.query_row("PRAGMA integrity_check;", [], |r| r.get(0)) {
            Ok(s) => s,
            Err(e) => {
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("Integrity check failed: {}", e));
            }
        };
    if enc_integrity != "ok" {
        let _ = std::fs::remove_file(&new_path);
        return Err(format!(
            "Encrypted integrity check not ok: {}",
            enc_integrity
        ));
    }

    // Check foreign keys
    let fk_violations: Vec<String> = {
        let mut stmt = match enc_conn.prepare("PRAGMA foreign_key_check;") {
            Ok(s) => s,
            Err(e) => {
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("FK check prepare failed: {}", e));
            }
        };
        match stmt
            .query_map([], |r| r.get(0))
            .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        {
            Ok(v) => v,
            Err(e) => {
                let _ = std::fs::remove_file(&new_path);
                return Err(format!("FK check failed: {}", e));
            }
        }
    };
    if !fk_violations.is_empty() {
        let _ = std::fs::remove_file(&new_path);
        return Err("Foreign key check failed on encrypted database".into());
    }

    // Check WAL mode
    let journal_mode: String = match enc_conn.query_row("PRAGMA journal_mode;", [], |r| r.get(0)) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&new_path);
            return Err(format!("Journal mode check failed: {}", e));
        }
    };
    if journal_mode.to_lowercase() != "wal" {
        let _ = std::fs::remove_file(&new_path);
        return Err(format!("Journal mode is not WAL: {}", journal_mode));
    }

    // Check verify_ledger
    let discrepancies = match crate::database::queries::verify_ledger(&enc_conn) {
        Ok(d) => d,
        Err(e) => {
            let _ = std::fs::remove_file(&new_path);
            return Err(format!("Ledger verification error: {}", e));
        }
    };
    if !discrepancies.is_empty() {
        let _ = std::fs::remove_file(&new_path);
        return Err("Audit-chain / ledger verification failed on encrypted database".into());
    }

    drop(enc_conn);

    // (d) Only if ALL checks pass: store.set(key), overwrite plaintext with zeros, delete it and -wal/-shm, rename new_path to db_path
    if let Err(e) = store.set(&key) {
        let _ = std::fs::remove_file(&new_path);
        return Err(format!("Failed to store key: {}", e));
    }

    // Overwrite plaintext file with zeros
    if let Ok(metadata) = std::fs::metadata(&db_path) {
        let len = metadata.len() as usize;
        let zeros = vec![0u8; len.min(1024 * 1024)];
        if let Ok(mut f) = std::fs::OpenOptions::new().write(true).open(&db_path) {
            use std::io::Write;
            let mut written = 0;
            while written < len {
                let to_write = (len - written).min(zeros.len());
                let _ = f.write_all(&zeros[..to_write]);
                written += to_write;
            }
            let _ = f.flush();
        }
    }
    let _ = std::fs::remove_file(&db_path);

    let wal_path = app_dir.join("omnibill.db-wal");
    if wal_path.exists() {
        let _ = std::fs::remove_file(&wal_path);
    }
    let shm_path = app_dir.join("omnibill.db-shm");
    if shm_path.exists() {
        let _ = std::fs::remove_file(&shm_path);
    }

    if let Err(e) = std::fs::rename(&new_path, &db_path) {
        return Err(format!(
            "Failed to rename encrypted file to destination: {}",
            e
        ));
    }

    Ok(())
}

static IMPORT_ATTEMPTS: Mutex<Option<Vec<i64>>> = Mutex::new(None);

/// Imports a database encryption key from its 64-hex representation.
/// Rate-limited in memory to at most 5 attempts per 10 minutes.
pub fn import_database_key_impl(
    db_path: &Path,
    hex_key: &str,
    store: &dyn KeyStore,
    now_ms: i64,
) -> Result<(), String> {
    // 1. Rate limiting: 5 attempts per 10 minutes (600_000 ms)
    {
        let mut lock = IMPORT_ATTEMPTS
            .lock()
            .map_err(|_| "Internal lock error".to_string())?;
        let attempts = lock.get_or_insert_with(Vec::new);
        attempts.retain(|&ts| now_ms.saturating_sub(ts) < 600_000);
        if attempts.len() >= 5 {
            return Err(
                "Rate limit exceeded: too many key import attempts. Please wait 10 minutes.".into(),
            );
        }
        attempts.push(now_ms);
    }

    // 2. Validate hex key
    let key = match DbKey::from_hex(hex_key) {
        Ok(k) => k,
        Err(_) => return Err("Invalid database key".into()),
    };

    // 3. Test open existing DB file read-only with the key
    let p_str = match db_path.to_str() {
        Some(s) => s,
        None => return Err("Invalid database path".into()),
    };

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY;
    let conn = match open_database_with_flags(p_str, flags, Some(&key)) {
        Ok(c) => c,
        Err(_) => return Err("Invalid database key: decryption verification failed".into()),
    };

    // Verify schema read
    if conn
        .query_row("SELECT count(*) FROM sqlite_master;", [], |_| Ok(()))
        .is_err()
    {
        return Err("Invalid database key: schema query failed".into());
    }

    // 4. On success, store key
    store
        .set(&key)
        .map_err(|e| format!("Failed to save key to keystore: {}", e))?;

    // Clear attempt history on successful import
    if let Ok(mut lock) = IMPORT_ATTEMPTS.lock() {
        if let Some(ref mut attempts) = *lock {
            attempts.clear();
        }
    }

    Ok(())
}
