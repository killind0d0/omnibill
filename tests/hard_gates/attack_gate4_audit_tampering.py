#!/usr/bin/env python3
"""
Adversarial Attack Suite - Hard Gate 4: Immutability, Statutory Period Lock & HMAC Audit Trail
Validates that:
1. Period Lock DB boundary blocks back-dated insert AND date-update bypass.
2. statutory_period_locks table cannot be altered (UPDATE or DELETE forbidden).
3. audit_logs cannot be updated or deleted via raw SQL.
4. Sequence numbers and hash chain linkages are enforced at the DB trigger level.
5. Forged HMAC rows (correct sequence & prev_hash, but forged signature) are detected.
6. 1,000-row scale test:
   - Pristine 1,000-row HMAC chain verifies cleanly.
   - Middle-row payload tampering (row 500) detected.
   - Middle-row deletion (row 500) detected.
   - Tail truncation (last 10 rows deleted) detected against external anchor.
7. External key (~/.config/omnibill/audit_hmac.key) and anchor (~/.config/omnibill/audit_anchor.json)
   are managed and persisted with secure permissions.
"""

import sqlite3
import hmac
import hashlib
import json
import sys
import os
import shutil
import time

CONFIG_DIR = os.path.expanduser("~/.config/omnibill")
HMAC_KEY_PATH = os.path.join(CONFIG_DIR, "audit_hmac.key")
ANCHOR_PATH = os.path.join(CONFIG_DIR, "audit_anchor.json")

def setup_external_security_environment():
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
    if not os.path.exists(HMAC_KEY_PATH):
        # 256-bit cryptographic secret key stored external to SQLite
        key = os.urandom(32)
        with open(HMAC_KEY_PATH, "wb") as f:
            f.write(key)
        os.chmod(HMAC_KEY_PATH, 0o600)
    else:
        os.chmod(HMAC_KEY_PATH, 0o600)

    with open(HMAC_KEY_PATH, "rb") as f:
        secret_key = f.read()

    return secret_key

def compute_hmac(key, seq, ts, actor_id, actor_role, term_id, event_type, ent_type, ent_id, b_json, a_json, reason, prev_hash):
    msg = f"{seq}|{ts}|{actor_id}|{actor_role}|{term_id}|{event_type}|{ent_type or ''}|{ent_id or ''}|{b_json or ''}|{a_json or ''}|{reason or ''}|{prev_hash}"
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).hexdigest()

def verify_audit_chain(conn, key, anchor_path=None):
    rows = conn.execute("""
        SELECT sequence_number, timestamp_ms, actor_id, actor_role, terminal_id,
               event_type, entity_type, entity_id, before_state_json, after_state_json,
               reason, prev_hash, entry_hash
        FROM audit_logs
        ORDER BY sequence_number ASC
    """).fetchall()

    if not rows:
        return True, "Audit log is empty"

    expected_seq = 1
    expected_prev_hash = "GENESIS"
    for r in rows:
        seq, ts, actor_id, actor_role, term_id, event_type, ent_type, ent_id, b_json, a_json, reason, prev_hash, entry_hash = r
        if seq != expected_seq:
            return False, f"Sequence gap at {seq}, expected {expected_seq}"
        if prev_hash != expected_prev_hash:
            return False, f"Hash chain mismatch at seq {seq}: prev_hash '{prev_hash}' != expected '{expected_prev_hash}'"
        recomputed = compute_hmac(key, seq, ts, actor_id, actor_role, term_id, event_type, ent_type, ent_id, b_json, a_json, reason, prev_hash)
        if recomputed != entry_hash:
            return False, f"HMAC tampering detected at seq {seq}: record entry_hash '{entry_hash}' != recomputed '{recomputed}'"
        expected_prev_hash = entry_hash
        expected_seq += 1

    last_seq = rows[-1][0]
    last_hash = rows[-1][12]

    # Verify against external anchor if present
    if anchor_path and os.path.exists(anchor_path):
        with open(anchor_path, "r") as f:
            anchor_data = json.load(f)
        anchor_seq = anchor_data.get("last_sequence")
        anchor_hash = anchor_data.get("last_hash")
        if last_seq < anchor_seq:
            return False, f"Tail truncation detected: Database head seq {last_seq} < external anchor seq {anchor_seq}"
        if last_seq == anchor_seq and last_hash != anchor_hash:
            return False, f"Tail hash mismatch against external anchor: {last_hash} != {anchor_hash}"

    return True, f"Verified {len(rows)} entries intact"

def run_attack_suite(db_template_path):
    print("=" * 80)
    print("  HARD GATE 4 ADVERSARIAL ATTACK DRILL: AUDIT IMMUTABILITY & TAMPER DETECTION")
    print("=" * 80)

    secret_key = setup_external_security_environment()
    print(f"[Key Storage] External HMAC Key: {HMAC_KEY_PATH} (permissions: {oct(os.stat(HMAC_KEY_PATH).st_mode)[-4:]})")
    print(f"[Anchor File] External Anchor:   {ANCHOR_PATH}")

    test_db = "/tmp/test_gate4_adversarial.db"
    if os.path.exists(test_db):
        os.remove(test_db)
    shutil.copy2(db_template_path, test_db)

    conn = sqlite3.connect(test_db)
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA recursive_triggers = ON")

    passed_attacks = 0
    total_attacks = 11

    now = int(time.time() * 1000)
    user_id = "usr_adv4"
    conn.execute("INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role) VALUES (?, 'adv4', 'h', 'Adv4', 'ADMIN')", (user_id,))
    conn.execute("INSERT OR IGNORE INTO entities (id, entity_code, entity_type, full_name, state_code) VALUES ('ent_c4', 'E4', 'CUSTOMER', 'Customer 4', '27')")
    conn.commit()

    # --- ATTACK 1: Period Lock - Direct Back-Dated Insert ---
    print("\n[Attack 1] Attempt direct INSERT of back-dated DRAFT on/before active period lock (2026-03-31)...")
    conn.execute("INSERT OR REPLACE INTO statutory_period_locks (id, lock_date, locked_at_ms, locked_by_user_id, reason, is_active) VALUES ('spl_1', '2026-03-31', ?, ?, 'Statutory Year End 2026', 1)", (now, user_id))
    conn.commit()

    try:
        conn.execute("""
            INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_atk_bd1', 'DRAFT', '27', '27', 'INV', 'INV/25-26/BD01', 'ent_c4',
                1000, 0, 1000, 90, 90, 0, 0, 1180, ?, 'SALE', NULL, '2026-03-25'
            )
        """, (user_id,))
        conn.commit()
        print("❌ FAILED: Backdated transaction insert on locked period succeeded!")
    except Exception as e:
        err = str(e)
        if "PERIOD_LOCKED" in err:
            print(f"✅ BLOCKED [PERIOD_LOCKED: Direct insert on or before lock_date rejected]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 2: Period Lock - Date-Update Bypass (Insert allowed DRAFT, update invoice_date into lock) ---
    print("\n[Attack 2] Attempt date-update bypass: Insert DRAFT on 2026-04-15, then UPDATE invoice_date to 2026-03-15...")
    conn.execute("""
        INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            'tx_allowed_draft', 'DRAFT', '27', '27', 'INV', 'INV/26-27/OK01', 'ent_c4',
            1000, 0, 1000, 90, 90, 0, 0, 1180, ?, 'SALE', NULL, '2026-04-15'
        )
    """, (user_id,))
    conn.commit()

    try:
        conn.execute("UPDATE transactions SET invoice_date = '2026-03-15' WHERE id = 'tx_allowed_draft'")
        conn.commit()
        print("❌ FAILED: Date-update bypass succeeded!")
    except Exception as e:
        err = str(e)
        if "PERIOD_LOCKED" in err or "IMMUTABILITY_RULE_BROKEN" in err:
            print(f"✅ BLOCKED [Date update into locked period strictly rejected]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 3: Tampering with statutory_period_locks (UPDATE & DELETE) ---
    print("\n[Attack 3] Attempt direct UPDATE and DELETE on statutory_period_locks table...")
    upd_lock_blocked = False
    del_lock_blocked = False
    try:
        conn.execute("UPDATE statutory_period_locks SET lock_date = '2020-01-01' WHERE id = 'spl_1'")
        conn.commit()
    except Exception as e:
        if "IMMUTABILITY_RULE_BROKEN" in str(e):
            upd_lock_blocked = True

    try:
        conn.execute("DELETE FROM statutory_period_locks WHERE id = 'spl_1'")
        conn.commit()
    except Exception as e:
        if "IMMUTABILITY_RULE_BROKEN" in str(e):
            del_lock_blocked = True

    if upd_lock_blocked and del_lock_blocked:
        print("✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: Period locks table cannot be updated or deleted]")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Lock table tampering succeeded! upd={upd_lock_blocked}, del={del_lock_blocked}")

    # --- ATTACK 4: Raw UPDATE on audit_logs ---
    print("\n[Attack 4] Attempt raw UPDATE on audit_logs table...")
    # Insert valid sequence 1
    h1 = compute_hmac(secret_key, 1, now, "usr_admin", "ADMIN", "term_1", "auth.login_ok", "USER", "usr_admin", None, "Success", "Login", "GENESIS")
    conn.execute("""
        INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, entity_type, entity_id, before_state_json, after_state_json, reason, prev_hash, entry_hash)
        VALUES ('aud_1', 1, ?, 'usr_admin', 'ADMIN', 'term_1', 'auth.login_ok', 'USER', 'usr_admin', NULL, 'Success', 'Login', 'GENESIS', ?)
    """, (now, h1))
    conn.commit()

    try:
        conn.execute("UPDATE audit_logs SET actor_id = 'intruder' WHERE sequence_number = 1")
        conn.commit()
        print("❌ FAILED: Raw UPDATE on audit_logs succeeded!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err and "UPDATE on audit_logs is strictly forbidden" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: UPDATE on audit_logs forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 5: Raw DELETE on audit_logs ---
    print("\n[Attack 5] Attempt raw DELETE on audit_logs table...")
    try:
        conn.execute("DELETE FROM audit_logs WHERE sequence_number = 1")
        conn.commit()
        print("❌ FAILED: Raw DELETE on audit_logs succeeded!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err and "DELETE on audit_logs is strictly forbidden" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: DELETE on audit_logs forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 6: Sequence Skip Insert ---
    print("\n[Attack 6] Attempt inserting audit record with skipped sequence_number = 5...")
    try:
        conn.execute("""
            INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, prev_hash, entry_hash)
            VALUES ('aud_bad', 5, ?, 'usr_admin', 'ADMIN', 'term_1', 'auth.login_ok', 'bad_hash', 'bad_hash')
        """, (now + 1000,))
        conn.commit()
        print("❌ FAILED: Skipped sequence was committed!")
    except Exception as e:
        err = str(e)
        if "AUDIT_CHAIN_BROKEN" in err and "sequence_number must strictly increment by 1" in err:
            print(f"✅ BLOCKED [AUDIT_CHAIN_BROKEN: Sequence must increment strictly by 1]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 7: Chain Link Mismatch Insert ---
    print("\n[Attack 7] Attempt inserting seq 2 with bogus prev_hash (not matching seq 1 entry_hash)...")
    try:
        conn.execute("""
            INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, prev_hash, entry_hash)
            VALUES ('aud_bad_prev', 2, ?, 'usr_admin', 'ADMIN', 'term_1', 'auth.login_ok', 'fake_prev_hash', 'fake_hash')
        """, (now + 2000,))
        conn.commit()
        print("❌ FAILED: Broken prev_hash chain insert succeeded!")
    except Exception as e:
        err = str(e)
        if "AUDIT_CHAIN_BROKEN" in err and "prev_hash must match entry_hash of preceding" in err:
            print(f"✅ BLOCKED [AUDIT_CHAIN_BROKEN: prev_hash must link to preceding entry]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 8: Forged HMAC Row (Correct sequence & prev_hash, forged signature) ---
    print("\n[Attack 8] Attacker inserts valid sequence & prev_hash but forged HMAC (unknown key)...")
    fake_key = b"attacker_bogus_key_1234567890123"
    forged_hmac = compute_hmac(fake_key, 2, now + 1000, "usr_admin", "ADMIN", "term_1", "financial.override", "INVOICE", "tx_100", None, "Forged discount", "Override", h1)
    # Trigger allows because sequence = 2 and prev_hash = h1
    conn.execute("""
        INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, entity_type, entity_id, before_state_json, after_state_json, reason, prev_hash, entry_hash)
        VALUES ('aud_forged', 2, ?, 'usr_admin', 'ADMIN', 'term_1', 'financial.override', 'INVOICE', 'tx_100', NULL, 'Forged discount', 'Override', ?, ?)
    """, (now + 1000, h1, forged_hmac))
    conn.commit()

    is_valid, msg = verify_audit_chain(conn, secret_key)
    if not is_valid and "HMAC tampering detected at seq 2" in msg:
        print(f"✅ DETECTED [Cryptographic HMAC verification caught forged signature]: {msg}")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Forged HMAC entry was not detected! {msg}")

    # Remove forged entry to restore clean state for scale test
    conn.execute("DROP TRIGGER trg_audit_logs_no_delete")
    conn.execute("DELETE FROM audit_logs WHERE sequence_number = 2")
    conn.commit()

    # --- ATTACK 9, 10, 11: 1,000-Row Scale Test ---
    print("\n[1,000-Row Scale Drill] Generating 1,000 sequential HMAC-chained audit log entries...")
    audit_batch = []
    prev_h = h1
    t_start = time.time()
    for i in range(2, 1001):
        ts = now + i * 10
        event = "sales.invoice_created" if i % 2 == 0 else "financial.payment_received"
        cur_h = compute_hmac(secret_key, i, ts, "usr_admin", "ADMIN", "term_pos", event, "TRANSACTION", f"tx_{i}", None, f"{{\"amount\": {i*100}}}", "Audit Scale Record", prev_h)
        audit_batch.append((f"aud_{i}", i, ts, "usr_admin", "ADMIN", "term_pos", event, "TRANSACTION", f"tx_{i}", None, f"{{\"amount\": {i*100}}}", "Audit Scale Record", prev_h, cur_h))
        prev_h = cur_h

    conn.executemany("""
        INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, entity_type, entity_id, before_state_json, after_state_json, reason, prev_hash, entry_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, audit_batch)
    conn.commit()
    t_gen = time.time() - t_start

    # Persist external anchor at row 1,000
    with open(ANCHOR_PATH, "w") as f:
        json.dump({
            "last_sequence": 1000,
            "last_hash": prev_h,
            "anchor_timestamp": now + 10000
        }, f, indent=2)
    os.chmod(ANCHOR_PATH, 0o644)

    # Verify pristine 1,000 rows
    t0 = time.time()
    is_valid, msg = verify_audit_chain(conn, secret_key, ANCHOR_PATH)
    t_verify = time.time() - t0
    assert is_valid, f"Pristine chain verification failed: {msg}"
    print(f"  Inserted 1,000 rows in {t_gen:.2f}s | Verified in {t_verify*1000:.2f}ms: {msg}")

    # --- ATTACK 9: Scale Test - Tamper Row 500 Payload ---
    print("\n[Attack 9] Scale Tamper: Mutate after_state_json in middle row 500 (offline attack)...")
    conn.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_update")
    conn.execute("UPDATE audit_logs SET after_state_json = '{\"tampered\": true}' WHERE sequence_number = 500")
    conn.commit()

    is_valid, msg = verify_audit_chain(conn, secret_key, ANCHOR_PATH)
    if not is_valid and "HMAC tampering detected at seq 500" in msg:
        print(f"✅ DETECTED [HMAC verification caught payload mutation in row 500/1000]: {msg}")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Mutation at row 500 undetected! {msg}")

    # Restore row 500
    r500_orig = audit_batch[498]
    conn.execute("UPDATE audit_logs SET after_state_json = ? WHERE sequence_number = 500", (r500_orig[10],))
    conn.commit()

    # --- ATTACK 10: Scale Test - Delete Row 500 (Omission / Gap) ---
    print("\n[Attack 10] Scale Tamper: Delete middle row 500 from 1,000-row chain...")
    conn.execute("DELETE FROM audit_logs WHERE sequence_number = 500")
    conn.commit()

    is_valid, msg = verify_audit_chain(conn, secret_key, ANCHOR_PATH)
    if not is_valid and ("Sequence gap at 501" in msg or "Hash chain mismatch at seq 501" in msg):
        print(f"✅ DETECTED [Omission of row 500 detected via chain gap/mismatch]: {msg}")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Row deletion undetected! {msg}")

    # Re-insert row 500 to restore for tail truncation test (requires dropping sequence guard to simulate offline restore)
    r500 = audit_batch[498] # index 498 corresponds to seq 500
    conn.execute("DROP TRIGGER IF EXISTS trg_audit_logs_sequence_and_hash_guard")
    conn.execute("""
        INSERT INTO audit_logs (id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id, event_type, entity_type, entity_id, before_state_json, after_state_json, reason, prev_hash, entry_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, r500)
    conn.commit()

    # --- ATTACK 11: Scale Test - Tail Truncation (Delete last 10 rows: 991-1000) ---
    print("\n[Attack 11] Scale Tamper: Delete last 10 rows (seq 991-1000) and compare against external anchor...")
    conn.execute("DELETE FROM audit_logs WHERE sequence_number > 990")
    conn.commit()

    is_valid, msg = verify_audit_chain(conn, secret_key, ANCHOR_PATH)
    if not is_valid and "Tail truncation detected" in msg:
        print(f"✅ DETECTED [External anchor detected rollback/truncation of tail]: {msg}")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Tail truncation undetected! {msg}")

    conn.close()
    if os.path.exists(test_db):
        os.remove(test_db)

    print("\n" + "=" * 80)
    print(f"  HARD GATE 4 RESULT: {passed_attacks} / {total_attacks} ADVERSARIAL ATTACKS PASSED")
    print("=" * 80)
    if passed_attacks == total_attacks:
        print("🏆 VERDICT: HARD GATE 4 PASS (1,000-row HMAC chain, offline tamper detection, period lock DB boundary verified)")
        return True
    else:
        print("💥 VERDICT: HARD GATE 4 FAIL")
        return False

if __name__ == "__main__":
    db_path = "/home/killindodo/omnibill.db"
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    success = run_attack_suite(db_path)
    sys.exit(0 if success else 1)
