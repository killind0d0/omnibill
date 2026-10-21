use omnibill_core::database::migrations::{
    LATEST_VERSION, MIGRATIONS, get_user_version, run_migrations,
};
use rusqlite::{Connection, params};

#[test]
fn test_auth_schema_fresh_db_columns_and_integrity() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable fk");

    run_migrations(&mut conn, MIGRATIONS).expect("run all migrations");
    let version = get_user_version(&conn).expect("get user_version");
    assert_eq!(version, LATEST_VERSION);

    // 1. Assert via PRAGMA table_info that every column exists on app_users
    let mut stmt = conn
        .prepare("PRAGMA table_info(app_users)")
        .expect("pragma table_info app_users");
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .expect("query cols")
        .map(|r| r.expect("col name"))
        .collect();

    let expected_user_cols = [
        "id",
        "username",
        "display_name",
        "password_hash",
        "role",
        "is_primary_owner",
        "is_active",
        "must_change_password",
        "failed_attempts",
        "locked_until_ms",
        "last_login_ms",
        "created_by",
        "created_ms",
        "updated_ms",
    ];
    for col in expected_user_cols {
        assert!(
            cols.contains(&col.to_string()),
            "app_users missing required column: {}",
            col
        );
    }

    // Assert via PRAGMA table_info that every column exists on app_state
    let mut stmt_state = conn
        .prepare("PRAGMA table_info(app_state)")
        .expect("pragma table_info app_state");
    let state_cols: Vec<String> = stmt_state
        .query_map([], |r| r.get::<_, String>(1))
        .expect("query cols")
        .map(|r| r.expect("col name"))
        .collect();

    let expected_state_cols = ["key", "value", "updated_ms"];
    for col in expected_state_cols {
        assert!(
            state_cols.contains(&col.to_string()),
            "app_state missing required column: {}",
            col
        );
    }

    // PRAGMA integrity_check = ok
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .expect("integrity check");
    assert_eq!(integrity, "ok");

    // PRAGMA foreign_key_check empty
    let mut fk_stmt = conn
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check");
    let fk_violations: Vec<String> = fk_stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("fk violations query")
        .map(|r| r.expect("fk violation"))
        .collect();
    assert!(
        fk_violations.is_empty(),
        "foreign_key_check found violations: {:?}",
        fk_violations
    );
}

#[test]
fn test_auth_schema_constraints_and_uniqueness() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable fk");
    run_migrations(&mut conn, MIGRATIONS).expect("run migrations");

    let now_ms = 1_700_000_000_000i64;

    // Insert primary owner: must succeed
    conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params!["owner_alice", "Alice Owner", "argon2_hash_1", "owner", now_ms],
    ).expect("primary owner insert");

    // Two owner rows fail: second primary owner violates users_one_primary
    let err_second_owner = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params!["owner_bob", "Bob Owner", "argon2_hash_2", "owner", now_ms],
    );
    assert!(
        err_second_owner.is_err(),
        "second owner insert must fail unique constraint"
    );

    // Insert first co-owner: must succeed
    conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["co_carol", "Carol CoOwner", "argon2_hash_3", "co_owner", now_ms],
    ).expect("first co-owner insert");

    // A second co_owner fails: violates users_one_coowner
    let err_second_coowner = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["co_dave", "Dave CoOwner", "argon2_hash_4", "co_owner", now_ms],
    );
    assert!(
        err_second_coowner.is_err(),
        "second co_owner insert must fail unique constraint"
    );

    // role='owner' with is_primary_owner=0 fails CHECK ((role = 'owner') = (is_primary_owner = 1))
    let err_owner_non_primary = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["owner_fake", "Fake Owner", "hash", "owner", now_ms],
    );
    assert!(
        err_owner_non_primary.is_err(),
        "role='owner' with is_primary_owner=0 must fail CHECK constraint"
    );

    // non-owner role with is_primary_owner=1 fails CHECK
    let err_cashier_primary = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
        params!["cashier_fake", "Fake Cashier", "hash", "cashier", now_ms],
    );
    assert!(
        err_cashier_primary.is_err(),
        "role='cashier' with is_primary_owner=1 must fail CHECK constraint"
    );

    // role 'god' fails CHECK(role IN (...))
    let err_role_god = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["super_god", "God User", "hash", "god", now_ms],
    );
    assert!(
        err_role_god.is_err(),
        "role='god' must fail CHECK constraint"
    );

    // a 2-char username fails CHECK(length(username) BETWEEN 3 AND 40)
    let err_short_username = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["ab", "Short Name", "hash", "cashier", now_ms],
    );
    assert!(
        err_short_username.is_err(),
        "2-character username must fail CHECK constraint"
    );

    // Raju and raju conflict (COLLATE NOCASE UNIQUE)
    conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["Raju", "Raju Staff", "hash_raju1", "cashier", now_ms],
    ).expect("first Raju insert succeeds");

    let err_case_conflict = conn.execute(
        "INSERT INTO app_users (username, display_name, password_hash, role, is_primary_owner, created_ms, updated_ms)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params!["raju", "Raju Lowercase", "hash_raju2", "cashier", now_ms],
    );
    assert!(
        err_case_conflict.is_err(),
        "raju and Raju must conflict on NOCASE UNIQUE constraint"
    );
}

#[test]
fn test_auth_schema_upgrade_from_previous_migration_data_intact() {
    let mut conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable fk");

    // 1. Run migrations up to v7
    let v7_migrations = &MIGRATIONS[..7];
    run_migrations(&mut conn, v7_migrations).expect("migrate to v7");
    assert_eq!(get_user_version(&conn).expect("version"), 7);

    // 2. Insert pre-existing row in an existing table (business_profiles)
    conn.execute(
        "INSERT INTO business_profiles (id, legal_name, state_code, phone, address_line1, city, postal_code)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            "bp_pre_existing",
            "OmniCorp Retail Ltd",
            "27",
            "9876543210",
            "123 Main St",
            "Mumbai",
            "400001"
        ],
    ).expect("insert pre-existing row");

    // 3. Run all migrations (upgrades v7 -> latest)
    run_migrations(&mut conn, MIGRATIONS).expect("migrate to latest");
    assert_eq!(get_user_version(&conn).expect("version"), LATEST_VERSION);

    // 4. Assert pre-existing row survived intact
    let legal_name: String = conn
        .query_row(
            "SELECT legal_name FROM business_profiles WHERE id = ?1",
            params!["bp_pre_existing"],
            |r| r.get(0),
        )
        .expect("query pre-existing row");
    assert_eq!(legal_name, "OmniCorp Retail Ltd");

    // 5. Assert new tables app_users and app_state are ready
    conn.execute(
        "INSERT INTO app_state (key, value, updated_ms) VALUES ('tenant_id', 'ten_123', 1700000000000)",
        [],
    ).expect("insert into app_state");

    let val: String = conn
        .query_row(
            "SELECT value FROM app_state WHERE key = 'tenant_id'",
            [],
            |r| r.get(0),
        )
        .expect("query app_state");
    assert_eq!(val, "ten_123");

    // Foreign key check and integrity check on upgraded DB
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .expect("integrity check");
    assert_eq!(integrity, "ok");

    let mut fk_stmt = conn
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check");
    let fk_violations: Vec<String> = fk_stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("fk violations query")
        .map(|r| r.expect("fk violation"))
        .collect();
    assert!(fk_violations.is_empty(), "no FK violations after upgrade");
}
