use crate::database::{
    migrations::get_user_version,
    queries::{LedgerDiscrepancy, verify_ledger},
};
use aes_gcm::{
    Aes256Gcm, Key, Nonce,
    aead::{Aead, KeyInit},
};
use rand_core::{OsRng, RngCore};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use uuid::Uuid;

pub const MAGIC_HEADER: &str = "OMNIBACKUP_V1";
const PBKDF2_ROUNDS: u32 = 100_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

/// Metadata describing a completed backup archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub backup_id: String,
    pub created_at: String,
    pub schema_version: i32,
    pub sha256_checksum: String,
    pub total_bytes: u64,
}

/// Summary details returned after a backup has been successfully verified and restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoreSummary {
    pub backup_id: String,
    pub created_at: String,
    pub schema_version: i32,
    pub sha256_checksum: String,
    pub total_bytes: u64,
}

/// Strongly typed errors that can occur during backup or restore operations.
#[derive(Debug)]
pub enum BackupError {
    Database(rusqlite::Error),
    Io(std::io::Error),
    InvalidHeader(String),
    ChecksumMismatch { expected: String, actual: String },
    PassphraseRequired,
    InvalidPassphrase,
    LedgerVerificationFailed(Vec<LedgerDiscrepancy>),
    IntegrityCheckFailed(String),
    CorruptedBackup(String),
    Crypto(String),
}

impl fmt::Display for BackupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BackupError::Database(err) => write!(f, "Database error: {}", err),
            BackupError::Io(err) => write!(f, "I/O error: {}", err),
            BackupError::InvalidHeader(msg) => write!(f, "Invalid backup header: {}", msg),
            BackupError::ChecksumMismatch { expected, actual } => write!(
                f,
                "Backup checksum mismatch: expected {}, actual {}",
                expected, actual
            ),
            BackupError::PassphraseRequired => {
                write!(f, "Backup is encrypted; decryption passphrase is required")
            }
            BackupError::InvalidPassphrase => {
                write!(
                    f,
                    "Failed to decrypt backup: invalid passphrase or corrupted payload"
                )
            }
            BackupError::LedgerVerificationFailed(discrepancies) => {
                write!(
                    f,
                    "Restored database failed ledger verification with {} discrepancies",
                    discrepancies.len()
                )
            }
            BackupError::IntegrityCheckFailed(msg) => {
                write!(f, "SQLite integrity check failed: {}", msg)
            }
            BackupError::CorruptedBackup(msg) => write!(f, "Corrupted backup file: {}", msg),
            BackupError::Crypto(msg) => write!(f, "Cryptographic error: {}", msg),
        }
    }
}

impl std::error::Error for BackupError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            BackupError::Database(err) => Some(err),
            BackupError::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for BackupError {
    fn from(err: rusqlite::Error) -> Self {
        BackupError::Database(err)
    }
}

impl From<std::io::Error> for BackupError {
    fn from(err: std::io::Error) -> Self {
        BackupError::Io(err)
    }
}

impl From<crate::access::dbopen::DbOpenError> for BackupError {
    fn from(err: crate::access::dbopen::DbOpenError) -> Self {
        match err {
            crate::access::dbopen::DbOpenError::Sqlite(e) => BackupError::Database(e),
            crate::access::dbopen::DbOpenError::Io(e) => BackupError::Io(e),
            other => BackupError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(other))),
        }
    }
}

/// RAII guard ensuring temporary database files are removed even on error.
struct TempFileGuard(PathBuf);

impl TempFileGuard {
    fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let path_str = self.0.to_string_lossy();
        let _ = fs::remove_file(format!("{}-wal", path_str));
        let _ = fs::remove_file(format!("{}-shm", path_str));
    }
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, BackupError> {
    let trimmed = hex.trim();
    if !trimmed.is_ascii() {
        return Err(BackupError::InvalidHeader(
            "Hex string contains non-ASCII characters".into(),
        ));
    }
    let bytes = trimmed.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return Err(BackupError::InvalidHeader(format!(
            "Invalid hex length: {}",
            bytes.len()
        )));
    }
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.as_chunks::<2>().0 {
        let s = std::str::from_utf8(chunk)
            .map_err(|_| BackupError::InvalidHeader("Invalid UTF-8 in hex".into()))?;
        let byte = u8::from_str_radix(s, 16).map_err(|e| {
            BackupError::InvalidHeader(format!("Invalid hex byte '{}': {}", s, e))
        })?;
        out.push(byte);
    }
    Ok(out)
}

fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    bytes_to_hex(&hasher.finalize())
}

fn derive_aes_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ROUNDS, &mut key);
    key
}

fn encrypt_payload(
    plaintext: &[u8],
    passphrase: &str,
    salt: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, BackupError> {
    let key_bytes = derive_aes_key(passphrase, salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);
    cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| BackupError::Crypto(format!("Encryption error: {}", e)))
}

fn decrypt_payload(
    ciphertext: &[u8],
    passphrase: &str,
    salt: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, BackupError> {
    let key_bytes = derive_aes_key(passphrase, salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| BackupError::InvalidPassphrase)
}

/// Creates a consistent online backup of the SQLite database at `src_conn`.
///
/// - Uses SQLite Online Backup API (`rusqlite::backup::Backup`) so backup never locks active transactions or readers.
/// - Computes SHA-256 checksum of the backup payload.
/// - If `encryption_passphrase` is provided, encrypts the payload with AES-256-GCM.
/// - Encodes container header with MAGIC: `OMNIBACKUP_V1`, timestamp, schema version, checksum, and payload size.
/// - Returns strongly typed `BackupMetadata`.
pub fn create_backup(
    src_conn: &Connection,
    target_path: &str,
    encryption_passphrase: Option<&str>,
) -> Result<BackupMetadata, BackupError> {
    // 1. Capture metadata from source DB
    let schema_version: i32 = src_conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);

    let created_at: String = src_conn
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .unwrap_or_else(|_| {
            let dur = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            format!("{}.{:03}Z", dur.as_secs(), dur.subsec_millis())
        });

    let backup_id = Uuid::new_v4().to_string();

    // 2. Perform SQLite Online Backup to a temporary file.
    // Stepping in 100-page chunks yields to concurrent readers and writers.
    let temp_dir = std::env::temp_dir();
    let temp_db_path = temp_dir.join(format!("omnibill_backup_{}.tmp", Uuid::new_v4()));
    let _guard = TempFileGuard::new(temp_db_path.clone());

    {
        let mut dst_conn = crate::access::dbopen::open_database(
            temp_db_path.to_str().unwrap_or(""),
            None,
        )?;
        let backup = rusqlite::backup::Backup::new(src_conn, &mut dst_conn)?;
        backup.run_to_completion(100, Duration::from_millis(1), None)?;
    } // dst_conn is closed and flushed here

    // 3. Read raw database snapshot
    let raw_db_bytes = fs::read(&temp_db_path)?;

    // 4. Encrypt payload if passphrase is provided
    let (payload, is_encrypted, salt_bytes, nonce_bytes) = match encryption_passphrase {
        Some(passphrase) => {
            let mut salt = [0u8; SALT_LEN];
            let mut nonce = [0u8; NONCE_LEN];
            OsRng.fill_bytes(&mut salt);
            OsRng.fill_bytes(&mut nonce);

            let ciphertext = encrypt_payload(&raw_db_bytes, passphrase, &salt, &nonce)?;
            (ciphertext, true, salt.to_vec(), nonce.to_vec())
        }
        None => (
            raw_db_bytes,
            false,
            vec![0u8; SALT_LEN],
            vec![0u8; NONCE_LEN],
        ),
    };

    // 5. Compute SHA-256 checksum of payload
    let checksum = compute_sha256(&payload);

    // 6. Construct container header
    let header_str = format!(
        "{}\n\
         BACKUP_ID: {}\n\
         CREATED_AT: {}\n\
         SCHEMA_VERSION: {}\n\
         ENCRYPTED: {}\n\
         SALT: {}\n\
         NONCE: {}\n\
         CHECKSUM: {}\n\
         PAYLOAD_BYTES: {}\n\
         \n",
        MAGIC_HEADER,
        backup_id,
        created_at,
        schema_version,
        if is_encrypted { 1 } else { 0 },
        bytes_to_hex(&salt_bytes),
        bytes_to_hex(&nonce_bytes),
        checksum,
        payload.len(),
    );

    // 7. Write container to target_path
    if let Some(parent) = Path::new(target_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }

    let mut full_file = Vec::with_capacity(header_str.len() + payload.len());
    full_file.extend_from_slice(header_str.as_bytes());
    full_file.extend_from_slice(&payload);

    fs::write(target_path, &full_file)?;

    let total_bytes = full_file.len() as u64;

    Ok(BackupMetadata {
        backup_id,
        created_at,
        schema_version,
        sha256_checksum: checksum,
        total_bytes,
    })
}

/// Restores a database backup from `backup_file_path` to `target_db_path`.
///
/// - Validates container magic header and integrity checksum before applying.
/// - Decrypts payload with `decryption_passphrase` if encrypted.
/// - Restores database to `target_db_path` using SQLite Online Backup API.
/// - Verifies target DB integrity: applies WAL/sync pragmas, validates schema version, and runs `verify_ledger`.
/// - Returns strongly typed `RestoreSummary`.
pub fn restore_backup(
    backup_file_path: &str,
    target_db_path: &str,
    decryption_passphrase: Option<&str>,
) -> Result<RestoreSummary, BackupError> {
    // 1. Read backup file
    let file_bytes = fs::read(backup_file_path)?;
    if file_bytes.is_empty() {
        return Err(BackupError::CorruptedBackup("Backup file is empty".into()));
    }

    // 2. Validate magic header
    if !file_bytes.starts_with(MAGIC_HEADER.as_bytes()) {
        return Err(BackupError::InvalidHeader(format!(
            "Missing magic header: expected starts with '{}'",
            MAGIC_HEADER
        )));
    }

    // 3. Locate end of header: "\n\n" or "\r\n\r\n"
    let (header_end_idx, payload_start_idx) =
        if let Some(pos) = file_bytes.windows(2).position(|w| w == b"\n\n") {
            (pos, pos + 2)
        } else if let Some(pos) = file_bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            (pos, pos + 4)
        } else {
            return Err(BackupError::InvalidHeader(
                "Missing header end delimiter in backup file".into(),
            ));
        };

    let header_str = std::str::from_utf8(&file_bytes[..header_end_idx])
        .map_err(|e| BackupError::InvalidHeader(format!("Header is not valid UTF-8: {}", e)))?;

    // 4. Parse header fields
    let mut backup_id = String::new();
    let mut created_at = String::new();
    let mut schema_version: Option<i32> = None;
    let mut is_encrypted = false;
    let mut salt = Vec::new();
    let mut nonce = Vec::new();
    let mut expected_checksum = String::new();
    let mut expected_payload_bytes: Option<usize> = None;

    for line in header_str.lines() {
        let line = line.trim();
        if line == MAGIC_HEADER || line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_uppercase();
            let val = v.trim();
            match key.as_str() {
                "BACKUP_ID" | "ID" => backup_id = val.to_string(),
                "CREATED_AT" | "TIMESTAMP" => created_at = val.to_string(),
                "SCHEMA_VERSION" => {
                    let v: i32 = val.parse().map_err(|e| {
                        BackupError::InvalidHeader(format!("Invalid SCHEMA_VERSION: {}", e))
                    })?;
                    schema_version = Some(v);
                }
                "ENCRYPTED" => {
                    is_encrypted = val == "1" || val.eq_ignore_ascii_case("true");
                }
                "SALT" => {
                    salt = hex_to_bytes(val)?;
                }
                "NONCE" => {
                    nonce = hex_to_bytes(val)?;
                }
                "CHECKSUM" | "SHA256" => {
                    expected_checksum = val.to_lowercase();
                }
                "PAYLOAD_BYTES" | "TOTAL_BYTES" => {
                    let v: usize = val.parse().map_err(|e| {
                        BackupError::InvalidHeader(format!("Invalid PAYLOAD_BYTES: {}", e))
                    })?;
                    expected_payload_bytes = Some(v);
                }
                _ => {} // Ignore unknown header keys for future compatibility
            }
        }
    }

    if expected_checksum.is_empty() {
        return Err(BackupError::InvalidHeader(
            "Header missing CHECKSUM field".into(),
        ));
    }

    let schema_version = schema_version.unwrap_or(0);

    // 5. Extract payload and validate payload size if specified
    let payload = &file_bytes[payload_start_idx..];
    if let Some(exp_bytes) = expected_payload_bytes
        && payload.len() != exp_bytes
    {
        return Err(BackupError::CorruptedBackup(format!(
            "Payload size mismatch: expected {} bytes, got {}",
            exp_bytes,
            payload.len()
        )));
    }

    // 6. Validate integrity checksum before applying or decrypting
    let actual_checksum = compute_sha256(payload);
    if actual_checksum != expected_checksum {
        return Err(BackupError::ChecksumMismatch {
            expected: expected_checksum,
            actual: actual_checksum,
        });
    }

    // 7. Decrypt payload if encrypted
    let raw_db_bytes = if is_encrypted {
        let passphrase = decryption_passphrase.ok_or(BackupError::PassphraseRequired)?;
        decrypt_payload(payload, passphrase, &salt, &nonce)?
    } else {
        payload.to_vec()
    };

    // 8. Write decrypted database bytes to temporary file
    let temp_dir = std::env::temp_dir();
    let temp_restore_path = temp_dir.join(format!("omnibill_restore_{}.tmp", Uuid::new_v4()));
    let _guard = TempFileGuard::new(temp_restore_path.clone());

    fs::write(&temp_restore_path, &raw_db_bytes)?;

    // 9. Verify temporary DB integrity BEFORE touching target DB
    let src_temp = crate::access::dbopen::open_database(
        temp_restore_path.to_str().unwrap_or(""),
        None,
    )?;

    let integrity: String = src_temp.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        return Err(BackupError::IntegrityCheckFailed(format!(
            "PRAGMA integrity_check failed on restored data: {}",
            integrity
        )));
    }

    let restored_version = get_user_version(&src_temp)?;
    if schema_version > 0 && restored_version != schema_version {
        return Err(BackupError::IntegrityCheckFailed(format!(
            "Restored database user_version ({}) does not match backup schema_version ({})",
            restored_version, schema_version
        )));
    }

    // Run double-entry consistency audit on temporary database
    let discrepancies = verify_ledger(&src_temp)?;
    if !discrepancies.is_empty() {
        return Err(BackupError::LedgerVerificationFailed(discrepancies));
    }

    // 10. All checks passed on temporary DB! Now safely write to target path.
    if let Some(parent) = Path::new(target_db_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }

    let key = crate::access::dbkey::default_keystore().get();

    {
        let mut target_conn = crate::access::dbopen::open_database(target_db_path, key.as_ref())?;
        let backup = rusqlite::backup::Backup::new(&src_temp, &mut target_conn)?;
        backup.run_to_completion(100, Duration::from_millis(1), None)?;
    }

    let _target_conn = crate::access::dbopen::open_database(target_db_path, key.as_ref())?;

    Ok(RestoreSummary {
        backup_id,
        created_at,
        schema_version: restored_version,
        sha256_checksum: expected_checksum,
        total_bytes: file_bytes.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{
        apply_pragmas,
        migrations::{MIGRATIONS, run_migrations},
    };
    use rusqlite::Connection;

    struct TestDirGuard(PathBuf);
    impl TestDirGuard {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("omnibill_test_{}_{}", name, Uuid::new_v4()));
            let _ = fs::create_dir_all(&path);
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn setup_migrated_populated_db(db_path: &Path) -> Connection {
        let mut conn = crate::access::dbopen::open_database(db_path.to_str().unwrap(), None).expect("open test db");
        apply_pragmas(&conn).expect("apply pragmas");
        run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

        // Seed basic business profile
        conn.execute(
            "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
             VALUES ('biz_1', 'OmniMart Corp', '27', '9876543210', 'Market Rd', 'Mumbai', '400001')",
            [],
        ).expect("seed profile");

        // Seed user
        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_1', 'cashier_alice', 'hash_val', 'Alice Smith', 'CASHIER')",
            [],
        )
        .expect("seed user");

        // Seed accounts
        conn.execute(
            "INSERT INTO accounts (id, code, name, type)
             VALUES ('acc_ar', '1001', 'Accounts Receivable', 'ASSET')",
            [],
        )
        .expect("seed acc 1");
        conn.execute(
            "INSERT INTO accounts (id, code, name, type)
             VALUES ('acc_sales', '4001', 'Sales Revenue', 'REVENUE')",
            [],
        )
        .expect("seed acc 2");

        // Seed entity
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_1', 'CUST-001', 'CUSTOMER', 'John Doe', '27')",
            [],
        )
        .expect("seed entity");

        // Seed balanced transaction
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES ('tx_1', 'POSTED', '27', '27', 'INV', 'INV/26-27/0001', 'ent_1', 1000, 0, 1000, 0, 0, 0, 0, 1000, 'SALE', NULL, '2026-10-20', 'usr_1')",
            [],
        ).expect("seed tx");

        // Balanced ledger entries: 1000 debit, 1000 credit
        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_1', 'tx_1', 'acc_ar', 1000, 0, 'Sale AR')",
            [],
        )
        .expect("seed le 1");

        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('led_2', 'tx_1', 'acc_sales', 0, 1000, 'Sale Revenue')",
            [],
        )
        .expect("seed le 2");

        conn
    }

    #[test]
    fn test_backup_creation_on_populated_db() {
        let test_dir = TestDirGuard::new("backup_creation");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");

        let conn = setup_migrated_populated_db(&src_db_path);

        let meta = create_backup(&conn, backup_file_path.to_str().unwrap(), None)
            .expect("create_backup should succeed");

        assert!(!meta.backup_id.is_empty(), "backup_id must not be empty");
        assert!(!meta.created_at.is_empty(), "created_at must not be empty");
        assert_eq!(meta.schema_version, crate::database::migrations::LATEST_VERSION, "schema_version must match LATEST_VERSION");
        assert_eq!(
            meta.sha256_checksum.len(),
            64,
            "checksum must be 64-char hex"
        );
        assert!(meta.total_bytes > 0, "total_bytes must be > 0");
        assert!(backup_file_path.exists(), "backup file must exist on disk");

        let file_bytes = fs::read(&backup_file_path).expect("read backup file");
        assert_eq!(file_bytes.len() as u64, meta.total_bytes);
        assert!(file_bytes.starts_with(MAGIC_HEADER.as_bytes()));
    }

    #[test]
    fn test_restore_to_new_database_file() {
        let test_dir = TestDirGuard::new("restore_new_db");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");
        let restored_db_path = test_dir.path().join("restored.db");

        let conn = setup_migrated_populated_db(&src_db_path);

        let meta = create_backup(&conn, backup_file_path.to_str().unwrap(), None)
            .expect("create_backup should succeed");

        let summary = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            None,
        )
        .expect("restore_backup should succeed");

        assert_eq!(summary.backup_id, meta.backup_id);
        assert_eq!(summary.schema_version, meta.schema_version);
        assert_eq!(summary.sha256_checksum, meta.sha256_checksum);
        assert_eq!(summary.total_bytes, meta.total_bytes);

        // Verify data in the newly restored DB
        let restored_conn = crate::access::dbopen::open_database(restored_db_path.to_str().unwrap(), None).expect("open restored db");
        let biz_name: String = restored_conn
            .query_row(
                "SELECT legal_name FROM business_profiles WHERE id = 'biz_1'",
                [],
                |r| r.get(0),
            )
            .expect("query biz");
        assert_eq!(biz_name, "OmniMart Corp");

        let tx_count: i64 = restored_conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .expect("query tx count");
        assert_eq!(tx_count, 1);

        let discrepancies = verify_ledger(&restored_conn).expect("verify ledger");
        assert!(
            discrepancies.is_empty(),
            "restored ledger must have zero discrepancies"
        );
    }

    #[test]
    fn test_corrupted_backup_detection_tampered_checksum() {
        let test_dir = TestDirGuard::new("tampered_checksum");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");
        let restored_db_path = test_dir.path().join("restored.db");

        let conn = setup_migrated_populated_db(&src_db_path);
        create_backup(&conn, backup_file_path.to_str().unwrap(), None).expect("create_backup");

        let bytes = fs::read(&backup_file_path).expect("read backup");
        let header_end = bytes
            .windows(2)
            .position(|w| w == b"\n\n")
            .expect("find header end");
        let header_str = std::str::from_utf8(&bytes[..header_end]).expect("utf8 header");

        // Replace checksum in header with a tampered value
        let tampered_header = if let Some(idx) = header_str.find("CHECKSUM: ") {
            let start = idx + "CHECKSUM: ".len();
            let mut modified = header_str.to_string();
            modified.replace_range(start..start + 8, "01234567");
            modified
        } else {
            panic!("CHECKSUM line not found in header");
        };

        let mut tampered_bytes = Vec::new();
        tampered_bytes.extend_from_slice(tampered_header.as_bytes());
        tampered_bytes.extend_from_slice(b"\n\n");
        tampered_bytes.extend_from_slice(&bytes[header_end + 2..]);

        fs::write(&backup_file_path, &tampered_bytes).expect("write tampered backup");

        let res = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            None,
        );

        match res {
            Err(BackupError::ChecksumMismatch { expected, actual }) => {
                assert!(expected.starts_with("01234567"));
                assert_ne!(expected, actual);
            }
            other => panic!("Expected ChecksumMismatch error, got {:?}", other),
        }

        assert!(
            !restored_db_path.exists(),
            "Restored DB must not be created on corrupted backup"
        );
    }

    #[test]
    fn test_corrupted_backup_detection_tampered_payload() {
        let test_dir = TestDirGuard::new("tampered_payload");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");
        let restored_db_path = test_dir.path().join("restored.db");

        let conn = setup_migrated_populated_db(&src_db_path);
        create_backup(&conn, backup_file_path.to_str().unwrap(), None).expect("create_backup");

        let mut bytes = fs::read(&backup_file_path).expect("read backup");
        // Flip a byte in the payload area
        let len = bytes.len();
        bytes[len - 10] ^= 0xAA;
        fs::write(&backup_file_path, &bytes).expect("write corrupted backup");

        let res = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            None,
        );

        match res {
            Err(BackupError::ChecksumMismatch { .. }) => {}
            other => panic!("Expected ChecksumMismatch error, got {:?}", other),
        }
    }

    #[test]
    fn test_ledger_verification_post_restore_detects_imbalance() {
        let test_dir = TestDirGuard::new("ledger_verification");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");
        let restored_db_path = test_dir.path().join("restored.db");

        let conn = setup_migrated_populated_db(&src_db_path);

        // Corrupt the database ledger before backup: disable triggers and add an unbalanced entry
        conn.execute("PRAGMA recursive_triggers = OFF", [])
            .expect("disable triggers");
        conn.execute(
            "INSERT INTO ledger_entries (id, transaction_id, account_id, debit_paise, credit_paise, narration)
             VALUES ('led_bad', 'tx_1', 'acc_ar', 9999, 0, 'Corrupt unbalanced debit')",
            [],
        ).expect("insert unbalanced entry");

        // Take backup of this corrupt database
        create_backup(&conn, backup_file_path.to_str().unwrap(), None)
            .expect("backup creation should succeed");

        // Attempt restore
        let res = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            None,
        );

        match res {
            Err(BackupError::LedgerVerificationFailed(discrepancies)) => {
                assert!(
                    !discrepancies.is_empty(),
                    "Discrepancies must be flagged on unbalanced ledger"
                );
                let found_unbal = discrepancies
                    .iter()
                    .any(|d| matches!(d, LedgerDiscrepancy::UnbalancedTransaction { .. }));
                assert!(found_unbal, "Must detect UnbalancedTransaction");
            }
            other => panic!("Expected LedgerVerificationFailed, got {:?}", other),
        }
    }

    #[test]
    fn test_encrypted_backup_and_restore_cycle() {
        let test_dir = TestDirGuard::new("encrypted_cycle");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("encrypted.omnibackup");
        let restored_db_path = test_dir.path().join("restored_enc.db");

        let passphrase = "UltraSecurePassphrase!2026";
        let conn = setup_migrated_populated_db(&src_db_path);

        let meta = create_backup(&conn, backup_file_path.to_str().unwrap(), Some(passphrase))
            .expect("encrypted create_backup should succeed");

        assert_eq!(meta.schema_version, crate::database::migrations::LATEST_VERSION);

        // Verify restore without passphrase fails with PassphraseRequired
        let err_no_pass = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            None,
        );
        match err_no_pass {
            Err(BackupError::PassphraseRequired) => {}
            other => panic!("Expected PassphraseRequired, got {:?}", other),
        }

        // Verify restore with wrong passphrase fails with InvalidPassphrase
        let err_wrong_pass = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            Some("WrongPassword123"),
        );
        match err_wrong_pass {
            Err(BackupError::InvalidPassphrase) => {}
            other => panic!("Expected InvalidPassphrase, got {:?}", other),
        }

        // Verify restore with correct passphrase succeeds
        let summary = restore_backup(
            backup_file_path.to_str().unwrap(),
            restored_db_path.to_str().unwrap(),
            Some(passphrase),
        )
        .expect("restore_backup with valid passphrase should succeed");

        assert_eq!(summary.backup_id, meta.backup_id);
        assert_eq!(summary.sha256_checksum, meta.sha256_checksum);

        let restored_conn = crate::access::dbopen::open_database(restored_db_path.to_str().unwrap(), None).expect("open restored");
        let count: i64 = restored_conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .expect("query tx");
        assert_eq!(count, 1);
    }

    #[test]
    fn test_invalid_header_magic_rejected() {
        let test_dir = TestDirGuard::new("invalid_header");
        let bad_file_path = test_dir.path().join("bad.omnibackup");
        let restored_path = test_dir.path().join("restored.db");

        fs::write(&bad_file_path, b"NOT_A_VALID_MAGIC\nCHECKSUM: abc\n\n1234")
            .expect("write bad file");

        let res = restore_backup(
            bad_file_path.to_str().unwrap(),
            restored_path.to_str().unwrap(),
            None,
        );

        match res {
            Err(BackupError::InvalidHeader(msg)) => {
                assert!(msg.contains("Missing magic header"));
            }
            other => panic!("Expected InvalidHeader, got {:?}", other),
        }
    }

    #[test]
    fn test_online_backup_during_concurrent_read_lock() {
        let test_dir = TestDirGuard::new("concurrent_read");
        let src_db_path = test_dir.path().join("source.db");
        let backup_file_path = test_dir.path().join("backup.omnibackup");

        let conn = setup_migrated_populated_db(&src_db_path);

        // Open a secondary connection to simulate a concurrent active reader
        let reader_conn = crate::access::dbopen::open_database(src_db_path.to_str().unwrap(), None).expect("open reader conn");
        apply_pragmas(&reader_conn).expect("apply pragmas reader");

        let tx = reader_conn
            .unchecked_transaction()
            .expect("begin read transaction");
        let _: i64 = tx
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .expect("read query");

        // Backup must complete successfully while read transaction is active
        let meta = create_backup(&conn, backup_file_path.to_str().unwrap(), None)
            .expect("backup should succeed during active read");

        assert!(meta.total_bytes > 0);
        tx.finish().expect("finish read tx");
    }
}
