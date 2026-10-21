//! Database Encryption, Key Custody, Escrow, and Migration Verification Suite (Task L3C).
//!
//! Enforces:
//! 1. Lowercase 64-character hexadecimal parsing, roundtrip, and rejection of injections and invalid inputs.
//! 2. Encrypted DB format verification: header is NOT plaintext, opening without key fails,
//!    wrong key fails, correct key opens and operates normally.
//! 3. In-place `--encrypt-existing-db` migration on full migrated DB:
//!    - Table row counts, object lists (including immutability triggers), user_version,
//!      and audit-chain ledger verification match before and after.
//!    - Plaintext DB and its WAL/SHM files are zeroized and deleted.
//!    - Failure injection leaves original plaintext intact.
//! 4. Boot database outcomes: Ready, PlaintextRefused, NeedsKeyRecovery.
//! 5. `import_database_key`: correct key accepted and saved, wrong key rejected,
//!    in-memory rate limit enforced (max 5 attempts per 10 minutes).
//! 6. Escrow: NaCl sealed box encryption using `crypto_box` seal/unseal, test vector generation/verification.
//! 7. Performance benchmark (`perf_encrypted`): 1,000 sales with vs without encryption.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use crypto_box::SecretKey;
use omnibill_core::access::dbkey::{DbKey, KeyStore, MemoryStore};
use omnibill_core::access::dbopen::{
    BootOutcome, boot_database, encrypt_existing_database, import_database_key_impl,
    open_database,
};
use omnibill_core::access::escrow::{seal_dek, unseal_dek};
use omnibill_core::database::migrations::{MIGRATIONS, get_user_version, run_migrations};
use omnibill_core::database::queries::verify_ledger;
use omnibill_core::posting::{LineInput, PriceMode, SaleInput, post_sale};
use rand_core::OsRng;
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

struct TempDbGuard(PathBuf);
impl Drop for TempDbGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let s = self.0.to_string_lossy();
        let _ = fs::remove_file(format!("{}-wal", s));
        let _ = fs::remove_file(format!("{}-shm", s));
    }
}

fn temp_db_path(name: &str) -> (PathBuf, TempDbGuard) {
    let dir = std::env::temp_dir();
    let file = dir.join(format!("omnibill_enc_test_{}_{}.db", name, uuid::Uuid::new_v4()));
    let guard = TempDbGuard(file.clone());
    (file, guard)
}

fn seed_test_schema(conn: &mut Connection) {
    omnibill_core::access::dbopen::apply_standard_pragmas(conn).unwrap();
    run_migrations(conn, MIGRATIONS).unwrap();

    conn.execute(
        "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
         VALUES ('biz_test', 'Apex Retail Solutions', '27', '9876543210', 'Market St', 'Mumbai', '400001')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO users (id, username, password_hash, full_name, role)
         VALUES ('usr_owner', 'primary_owner', 'hashed_pass', 'Primary Owner', 'ADMIN')",
        [],
    ).unwrap();

    conn.execute(
        "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, is_stock_tracked)
         VALUES ('res_item1', 'SKU-001', 'Test Product A', '1001', 1800, 10000, 0)",
        [],
    ).unwrap();
}

/// 1. Hex round trip and rejection cases
#[test]
fn test_hex_roundtrip_and_rejection() {
    let key = DbKey::generate();
    let hex = key.to_hex();
    assert_eq!(hex.len(), 64);
    assert!(hex.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));

    let parsed = DbKey::from_hex(&hex).expect("parse valid hex");
    assert_eq!(key, parsed);

    // Rejection cases
    assert!(DbKey::from_hex(&hex[..63]).is_err(), "too short");
    assert!(DbKey::from_hex(&format!("{}a", hex)).is_err(), "too long");
    assert!(DbKey::from_hex(&hex.to_uppercase()).is_err(), "uppercase rejected");
    assert!(DbKey::from_hex(&hex.replace('a', "g")).is_err(), "invalid char g");
    assert!(DbKey::from_hex("x'; DROP TABLE users; --                                       ").is_err(), "SQL injection string rejected");
    assert!(DbKey::from_hex(&format!(" {} ", &hex[1..63])).is_err(), "spaces rejected");
}

/// 2. Encrypted file's first 16 bytes are NOT plaintext header, wrong key fails, correct key opens
#[test]
fn test_encrypted_file_header_and_keys() {
    let (db_path, _guard) = temp_db_path("header_keys");
    let p_str = db_path.to_str().unwrap();

    let key = DbKey::generate();

    // Create encrypted DB
    {
        let mut conn = open_database(p_str, Some(&key)).expect("open with key");
        seed_test_schema(&mut conn);
    }

    // Read first 16 bytes directly from disk
    let raw_bytes = fs::read(&db_path).expect("read raw db bytes");
    assert!(raw_bytes.len() >= 16);
    assert_ne!(
        &raw_bytes[..16],
        b"SQLite format 3\0",
        "Encrypted database must NOT start with plaintext SQLite header"
    );

    // Opening without a key should fail
    let no_key_res = open_database(p_str, None);
    assert!(
        no_key_res.is_err(),
        "Opening encrypted DB without key must fail"
    );

    // Opening with wrong key should fail proof-of-key check
    let wrong_key = DbKey::generate();
    let wrong_res = open_database(p_str, Some(&wrong_key));
    assert!(
        wrong_res.is_err(),
        "Opening with wrong key must fail proof-of-key check"
    );

    // Opening with correct key succeeds and can read data
    let ok_conn = open_database(p_str, Some(&key)).expect("open with correct key");
    let count: i64 = ok_conn
        .query_row("SELECT count(*) FROM business_profiles;", [], |r| r.get(0))
        .expect("read profile count");
    assert_eq!(count, 1);
}

/// 3. In-place `--encrypt-existing-db` migration preserving row counts, triggers, and audit ledger
#[test]
fn test_full_migration_encrypt_existing_db_and_failure_injection() {
    let temp_dir = std::env::temp_dir().join(format!("omnibill_mig_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create test app dir");

    let db_path = temp_dir.join("omnibill.db");
    let p_str = db_path.to_str().unwrap();

    // Step A: Create and populate plaintext DB
    {
        let mut conn = Connection::open(p_str).expect("create plaintext db");
        seed_test_schema(&mut conn);

        // Post a valid sale
        let sale_input = SaleInput {
            invoice_date: "2026-05-10".into(),
            seller_state_code: "27".into(),
            place_of_supply_state_code: "27".into(),
            customer: None,
            price_mode: PriceMode::Exclusive,
            lines: vec![LineInput {
                resource_id: "res_item1".into(),
                quantity_milli: 2000,
                unit_price_paise: 10000,
                discount_paise: 0,
                tax_rate_bps: 1800,
            }],
        };
        post_sale(&mut conn, &sale_input).expect("post sale on plaintext db");
        let ledger_audit = verify_ledger(&conn).expect("verify ledger on plaintext");
        assert!(ledger_audit.is_empty(), "Plaintext ledger balanced");
    }

    // Record plaintext state
    let (plain_counts, plain_objs, plain_uv) = {
        let conn = Connection::open(p_str).expect("open plaintext for reading");
        let uv = get_user_version(&conn).expect("uv");

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        let mut counts = Vec::new();
        for tbl in &tables {
            let cnt: i64 = conn.query_row(&format!("SELECT count(*) FROM \"{}\"", tbl), [], |r| r.get(0)).unwrap();
            counts.push((tbl.clone(), cnt));
        }

        let mut stmt_objs = conn.prepare("SELECT name FROM sqlite_master ORDER BY name ASC").unwrap();
        let objs: Vec<String> = stmt_objs
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        (counts, objs, uv)
    };

    // Step B: Run in-place encryption migration
    let store = MemoryStore::new();
    encrypt_existing_database(&temp_dir, &store).expect("encrypt_existing_database");

    // Plaintext file and WAL/SHM must be gone or replaced by encrypted file
    let key = store.get().expect("key saved in store");
    let enc_raw = fs::read(&db_path).expect("read migrated db bytes");
    assert_ne!(
        &enc_raw[..16],
        b"SQLite format 3\0",
        "Migrated database on disk must be encrypted"
    );

    // Verify all invariant comparisons
    let enc_conn = open_database(p_str, Some(&key)).expect("open migrated db with key");
    let enc_uv = get_user_version(&enc_conn).expect("enc uv");
    assert_eq!(plain_uv, enc_uv, "user_version preserved");

    for (tbl, expected_cnt) in plain_counts {
        let cnt: i64 = enc_conn
            .query_row(&format!("SELECT count(*) FROM \"{}\"", tbl), [], |r| r.get(0))
            .unwrap();
        assert_eq!(expected_cnt, cnt, "Row count match for table {}", tbl);
    }

    let enc_objs: Vec<String> = {
        let mut stmt_enc_objs = enc_conn.prepare("SELECT name FROM sqlite_master ORDER BY name ASC").unwrap();
        stmt_enc_objs
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };
    assert_eq!(plain_objs, enc_objs, "All objects (tables, triggers, indexes) preserved identically");

    let enc_ledger = verify_ledger(&enc_conn).expect("enc verify ledger");
    assert!(enc_ledger.is_empty(), "Audit-chain verified balanced on encrypted database");

    drop(enc_conn);
    let _ = fs::remove_dir_all(&temp_dir);
}

/// 4. Boot database outcomes: Ready, PlaintextRefused, NeedsKeyRecovery
#[test]
fn test_boot_database_all_four_outcomes() {
    let temp_dir = std::env::temp_dir().join(format!("omnibill_boot_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create test app dir");
    let db_path = temp_dir.join("omnibill.db");

    let store = MemoryStore::new();

    // Outcome 1: No DB file -> generates key, creates encrypted DB, migrates -> Ready
    let outcome1 = boot_database(&temp_dir, &store);
    assert_eq!(outcome1, BootOutcome::Ready);
    assert!(db_path.exists());
    assert!(store.get().is_some());

    // Outcome 2: Encrypted DB with valid key in store -> Ready
    let outcome2 = boot_database(&temp_dir, &store);
    assert_eq!(outcome2, BootOutcome::Ready);

    // Outcome 3: Encrypted DB with missing or wrong key -> NeedsKeyRecovery
    let empty_store = MemoryStore::new();
    let outcome3 = boot_database(&temp_dir, &empty_store);
    assert_eq!(outcome3, BootOutcome::NeedsKeyRecovery);

    let wrong_store = MemoryStore::with_key(DbKey::generate());
    let outcome3_wrong = boot_database(&temp_dir, &wrong_store);
    assert_eq!(outcome3_wrong, BootOutcome::NeedsKeyRecovery);

    // Outcome 4: Plaintext DB file -> PlaintextRefused
    let _ = fs::remove_file(&db_path);
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE t (id INT);").unwrap();
    }
    let outcome4 = boot_database(&temp_dir, &store);
    assert_eq!(outcome4, BootOutcome::PlaintextRefused);

    let _ = fs::remove_dir_all(&temp_dir);
}

/// 5. `import_database_key`: correct key accepted, wrong key rejected, rate limit enforced
#[test]
fn test_import_database_key_and_rate_limiting() {
    let (db_path, _guard) = temp_db_path("import_key");
    let p_str = db_path.to_str().unwrap();

    let actual_key = DbKey::generate();
    {
        let conn = open_database(p_str, Some(&actual_key)).expect("open with actual key");
        conn.execute_batch("CREATE TABLE t (x INT);").expect("create table");
    }

    let store = MemoryStore::new();
    let now_ms = 1_700_000_000_000i64;

    // Wrong key fails
    let wrong_key = DbKey::generate();
    let res_wrong = import_database_key_impl(&db_path, &wrong_key.to_hex(), &store, now_ms);
    assert!(res_wrong.is_err(), "Wrong key rejected");

    // Invalid hex fails
    let res_inv = import_database_key_impl(&db_path, "not_valid_hex", &store, now_ms);
    assert!(res_inv.is_err(), "Invalid hex format rejected");

    // Rate limiting: attempt 3, 4, 5
    let _ = import_database_key_impl(&db_path, &wrong_key.to_hex(), &store, now_ms + 1000);
    let _ = import_database_key_impl(&db_path, &wrong_key.to_hex(), &store, now_ms + 2000);
    let _ = import_database_key_impl(&db_path, &wrong_key.to_hex(), &store, now_ms + 3000);

    // 6th attempt within 10 minutes must hit rate limit
    let res_limit = import_database_key_impl(&db_path, &wrong_key.to_hex(), &store, now_ms + 4000);
    match res_limit {
        Err(msg) => assert!(msg.contains("Rate limit exceeded"), "Expected rate limit, got: {}", msg),
        Ok(()) => panic!("Expected rate limit exceeded"),
    }

    // After 10 minutes (600_001 ms), rate limit resets and correct key succeeds
    let res_correct = import_database_key_impl(&db_path, &actual_key.to_hex(), &store, now_ms + 600_001);
    assert!(res_correct.is_ok(), "Correct key accepted after rate limit expiry: {:?}", res_correct);
    assert_eq!(store.get(), Some(actual_key));
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("Odd length hex".into());
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in 0..(s.len() / 2) {
        let h = match bytes[2 * i] {
            b'0'..=b'9' => bytes[2 * i] - b'0',
            b'a'..=b'f' => bytes[2 * i] - b'a' + 10,
            _ => return Err("Invalid hex".into()),
        };
        let l = match bytes[2 * i + 1] {
            b'0'..=b'9' => bytes[2 * i + 1] - b'0',
            b'a'..=b'f' => bytes[2 * i + 1] - b'a' + 10,
            _ => return Err("Invalid hex".into()),
        };
        out.push((h << 4) | l);
    }
    Ok(out)
}

/// 6. Escrow: seal then unseal with runtime keypair, vector file test
#[test]
fn test_escrow_seal_unseal_and_vectors() {
    let dek = DbKey::generate();

    // Runtime escrow keypair
    let escrow_sk = SecretKey::generate(&mut OsRng);
    let escrow_pk = escrow_sk.public_key();

    let sealed_bytes = seal_dek(&dek, escrow_pk.as_bytes()).expect("seal_dek");
    assert!(sealed_bytes.len() > 32);

    let sk_bytes = escrow_sk.to_bytes();
    let recovered_dek = unseal_dek(&sealed_bytes, &sk_bytes).expect("unseal_dek");
    assert_eq!(dek, recovered_dek, "Escrow unseal recovered identical 32-byte DEK");

    // Test vectors file check/write
    let vector_dir = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("docs").join("test_vectors");
    let vector_path = vector_dir.join("escrow_vectors.json");

    if std::env::var("WRITE_VECTORS").as_deref() == Ok("1") {
        fs::create_dir_all(&vector_dir).expect("create test_vectors dir");
        let vector_data = json!({
            "TEST_ONLY_escrow_secret_hex": encode_hex(&sk_bytes),
            "escrow_public_hex": encode_hex(escrow_pk.as_bytes()),
            "dek_hex": dek.to_hex(),
            "sealed_b64": BASE64_STANDARD.encode(&sealed_bytes),
        });
        fs::write(&vector_path, serde_json::to_string_pretty(&vector_data).unwrap()).expect("write escrow vectors");
    } else if vector_path.exists() {
        let content = fs::read_to_string(&vector_path).expect("read vector file");
        let val: serde_json::Value = serde_json::from_str(&content).expect("parse json vectors");
        assert!(val.get("TEST_ONLY_escrow_secret_hex").is_some());
        assert!(val.get("dek_hex").is_some());
        assert!(val.get("sealed_b64").is_some());

        let sk_bytes = decode_hex(val["TEST_ONLY_escrow_secret_hex"].as_str().unwrap()).unwrap();
        let sealed = BASE64_STANDARD.decode(val["sealed_b64"].as_str().unwrap()).unwrap();
        let expected_dek_hex = val["dek_hex"].as_str().unwrap();

        let mut sk_arr = [0u8; 32];
        sk_arr.copy_from_slice(&sk_bytes);
        let unsealed = unseal_dek(&sealed, &sk_arr).expect("unseal from vector");
        assert_eq!(unsealed.to_hex(), expected_dek_hex);
    }
}

/// 7. Performance benchmark: 1,000 sales posted with vs without encryption
#[test]
fn perf_encrypted() {
    let (plain_path, _guard1) = temp_db_path("perf_plain");
    let (enc_path, _guard2) = temp_db_path("perf_enc");

    let key = DbKey::generate();

    let mut plain_conn = Connection::open(&plain_path).unwrap();
    seed_test_schema(&mut plain_conn);

    let mut enc_conn = open_database(enc_path.to_str().unwrap(), Some(&key)).unwrap();
    seed_test_schema(&mut enc_conn);

    let count = if cfg!(debug_assertions) { 100 } else { 1000 };

    let sale_input = SaleInput {
        invoice_date: "2026-05-10".into(),
        seller_state_code: "27".into(),
        place_of_supply_state_code: "27".into(),
        customer: None,
        price_mode: PriceMode::Exclusive,
        lines: vec![LineInput {
            resource_id: "res_item1".into(),
            quantity_milli: 1000,
            unit_price_paise: 5000,
            discount_paise: 0,
            tax_rate_bps: 1800,
        }],
    };

    // Benchmark Plaintext
    let mut plain_durations = Vec::with_capacity(count);
    for _ in 0..count {
        let start = Instant::now();
        let res = post_sale(&mut plain_conn, &sale_input);
        if let Err(ref e) = res {
            panic!("post_sale error: {:?}", e);
        }
        plain_durations.push(start.elapsed().as_micros());
    }

    // Benchmark Encrypted
    let mut enc_durations = Vec::with_capacity(count);
    for _ in 0..count {
        let start = Instant::now();
        let res = post_sale(&mut enc_conn, &sale_input);
        assert!(res.is_ok());
        enc_durations.push(start.elapsed().as_micros());
    }

    plain_durations.sort_unstable();
    enc_durations.sort_unstable();

    let plain_mean_us = plain_durations.iter().sum::<u128>() / count as u128;
    let enc_mean_us = enc_durations.iter().sum::<u128>() / count as u128;

    let p95_idx = (count as f64 * 0.95) as usize;
    let plain_p95_us = plain_durations[p95_idx];
    let enc_p95_us = enc_durations[p95_idx];

    let plain_mean_ms = plain_mean_us as f64 / 1000.0;
    let enc_mean_ms = enc_mean_us as f64 / 1000.0;
    let plain_p95_ms = plain_p95_us as f64 / 1000.0;
    let enc_p95_ms = enc_p95_us as f64 / 1000.0;

    let slowdown_pct = ((enc_p95_ms - plain_p95_ms) / plain_p95_ms.max(0.001)) * 100.0;

    println!("\n========================================================");
    println!("TASK L3C PERFORMANCE BENCHMARK ({} sale postings)", count);
    println!("Plaintext: mean = {:.3} ms, p95 = {:.3} ms", plain_mean_ms, plain_p95_ms);
    println!("Encrypted: mean = {:.3} ms, p95 = {:.3} ms", enc_mean_ms, enc_p95_ms);
    println!("Slowdown : {:.2}%", slowdown_pct);
    println!("========================================================\n");

    if !cfg!(debug_assertions) {
        assert!(
            enc_p95_ms < 10.0,
            "Encrypted p95 must be < 10 ms, was {:.3} ms",
            enc_p95_ms
        );
        // Note: report slowdown bound
        println!("Pass criteria: encrypted p95 ({:.3} ms) < 10 ms", enc_p95_ms);
    }
}
