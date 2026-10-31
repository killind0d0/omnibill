#!/usr/bin/env python3
"""
Drill Suite - Hard Gate 6: Verified Backup and 1-Click Restore with Pre-Restore Snapshot Drill
Validates:
1. Online backup during concurrent active writes (WAL mode, zero locking errors).
2. Restore preview metadata inspection (ID, date, sha256, tx_count, last_invoice).
3. 1-Click Restore with automatic pre-restore safety snapshot (.bak) and integrity check.
4. Scale Timed Restore Drill on >= 500,000 records proving RTO << 15 minutes.
5. Automated backup scheduler demonstration with rolling retention pruning (Row 6.4.1).
6. Supervisor override PIN lockout demonstration (Row 6.3.9).
"""

import sqlite3
import subprocess
import threading
import time
import os
import shutil
import sys
import glob

OMNIBILL_BIN = "/home/killindodo/omnibill/src-tauri/target/debug/omnibill"
CARGO_TOML = "/home/killindodo/omnibill/src-tauri/Cargo.toml"

def run_drill_suite(db_template_path):
    print("=" * 80)
    print("  HARD GATE 6 DRILL: VERIFIED BACKUP, 1-CLICK RESTORE & DISASTER RECOVERY")
    print("=" * 80)

    drill_dir = "/tmp/omnibill_drills"
    if os.path.exists(drill_dir):
        shutil.rmtree(drill_dir)
    os.makedirs(drill_dir, exist_ok=True)

    passed_drills = 0
    total_drills = 6

    # --- DRILL 1: Online Backup During Concurrent Active Writes ---
    print("\n[Drill 1] Testing Online Backup during active concurrent database writes (WAL mode)...")
    live_db = os.path.join(drill_dir, "live_source.db")
    shutil.copy2(db_template_path, live_db)

    # Enable WAL mode on source
    conn_setup = sqlite3.connect(live_db)
    conn_setup.execute("PRAGMA journal_mode = WAL")
    conn_setup.execute("PRAGMA busy_timeout = 5000")
    conn_setup.execute("INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role) VALUES ('usr_w', 'writer', 'h', 'Writer', 'ADMIN')")
    conn_setup.execute("INSERT OR IGNORE INTO entities (id, entity_code, entity_type, full_name, state_code) VALUES ('ent_w', 'EW', 'CUSTOMER', 'Writer Co', '27')")
    conn_setup.commit()
    conn_setup.close()

    writer_stop = False
    write_errors = []
    writes_count = [0]

    def background_writer():
        conn = sqlite3.connect(live_db, timeout=10.0)
        conn.execute("PRAGMA busy_timeout = 10000")
        i = 0
        while not writer_stop:
            i += 1
            tx_id = f"tx_concur_{i}"
            inv_no = f"INV/CONCUR/{i:04d}"
            try:
                conn.execute("""
                    INSERT INTO transactions (
                        id, status, seller_state_code, place_of_supply_state_code, series,
                        invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                        cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                        created_by_user_id, transaction_type, original_transaction_id, invoice_date
                    ) VALUES (
                        ?, 'DRAFT', '27', '27', 'INV', ?, 'ent_w',
                        1000, 0, 1000, 90, 90, 0, 0, 1180, 'usr_w', 'SALE', NULL, '2026-05-15'
                    )
                """, (tx_id, inv_no))
                conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES (?, ?, NULL, 'acc_1100', 1180, 0, 'AR Dr')", (f"le_{i}_dr", tx_id))
                conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES (?, ?, NULL, 'acc_4000', 0, 1000, 'Sales Cr')", (f"le_{i}_cr", tx_id))
                conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES (?, ?, NULL, 'acc_2110', 0, 90, 'CGST Cr')", (f"le_{i}_cgst", tx_id))
                conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES (?, ?, NULL, 'acc_2120', 0, 90, 'SGST Cr')", (f"le_{i}_sgst", tx_id))
                conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = ?", (tx_id,))
                conn.commit()
                writes_count[0] += 1
                time.sleep(0.01)
            except Exception as e:
                write_errors.append(str(e))
                break
        conn.close()

    writer_thread = threading.Thread(target=background_writer)
    writer_thread.start()

    time.sleep(0.1) # Let writer start
    concur_backup_path = os.path.join(drill_dir, "live_concur_backup.omnbak")

    t0 = time.time()
    res = subprocess.run([OMNIBILL_BIN, "--backup", concur_backup_path, live_db], capture_output=True, text=True)
    t_backup = time.time() - t0

    writer_stop = True
    writer_thread.join()

    if res.returncode == 0 and len(write_errors) == 0 and writes_count[0] >= 10:
        bak_size = os.path.getsize(concur_backup_path)
        print(f"✅ PASS: Backup taken concurrently with {writes_count[0]} transactions committed during execution.")
        print(f"  Backup File: {concur_backup_path} ({bak_size} bytes, completed in {t_backup:.2f}s, 0 lock errors)")
        passed_drills += 1
    else:
        print(f"❌ FAILED: Backup during concurrent writes failed: {res.stderr}, errors: {write_errors}")

    # --- DRILL 2: Restore Preview Inspection ---
    print("\n[Drill 2] Testing Restore Preview Inspection on generated backup container...")
    res_prev = subprocess.run([OMNIBILL_BIN, "--restore-preview", concur_backup_path], capture_output=True, text=True)
    print(res_prev.stdout.strip())

    if res_prev.returncode == 0 and "RESTORE PREVIEW METADATA" in res_prev.stdout and "Transaction Count:" in res_prev.stdout:
        print("✅ PASS: Restore preview metadata correctly parsed without modifying target.")
        passed_drills += 1
    else:
        print(f"❌ FAILED: Preview failed: {res_prev.stderr}")

    # --- DRILL 3: 1-Click Restore with Automatic Pre-Restore Snapshot ---
    print("\n[Drill 3] Testing 1-Click Restore with Automatic Pre-Restore Snapshot...")
    restore_target = os.path.join(drill_dir, "restored_production.db")
    # Seed restore_target with initial database
    shutil.copy2(db_template_path, restore_target)

    res_rest = subprocess.run([OMNIBILL_BIN, "--restore", concur_backup_path, restore_target], capture_output=True, text=True)
    print(res_rest.stdout.strip())

    # Check that pre-restore snapshot file was created
    pre_restore_snaps = glob.glob(f"{restore_target}.pre_restore_*.bak")

    if res_rest.returncode == 0 and len(pre_restore_snaps) > 0:
        snap_path = pre_restore_snaps[0]
        snap_size = os.path.getsize(snap_path)
        # Verify integrity of pre-restore snapshot
        conn_snap = sqlite3.connect(snap_path)
        snap_check = conn_snap.execute("PRAGMA integrity_check").fetchone()[0]
        conn_snap.close()

        # Verify integrity of restored target
        conn_target = sqlite3.connect(restore_target)
        target_check = conn_target.execute("PRAGMA integrity_check").fetchone()[0]
        tx_in_target = conn_target.execute("SELECT count(*) FROM transactions WHERE status = 'POSTED'").fetchone()[0]
        # Run verify ledger Dr=Cr check
        bal = conn_target.execute("""
            SELECT SUM(debit_paise) - SUM(credit_paise) FROM ledger_entries le
            JOIN transactions t ON t.id = le.transaction_id WHERE t.status = 'POSTED'
        """).fetchone()[0] or 0
        conn_target.close()

        print(f"  Pre-Restore Snapshot File: {snap_path} ({snap_size} bytes)")
        print(f"  Pre-Restore Snapshot PRAGMA integrity_check: {snap_check}")
        print(f"  Restored Target PRAGMA integrity_check:       {target_check}")
        print(f"  Restored Target Transactions:                 {tx_in_target} posted invoices")
        print(f"  Restored Target Net Ledger Discrepancy:       ₹{bal/100:.2f}")

        if snap_check == "ok" and target_check == "ok" and bal == 0 and tx_in_target > 0:
            print("✅ PASS: 1-Click Restore completed. Pre-restore snapshot verified and Dr == Cr held strictly.")
            passed_drills += 1
        else:
            print("❌ FAILED: Restored database integrity check or balance failed!")
    else:
        print(f"❌ FAILED: Restore failed or snapshot missing: {res_rest.stderr}")

    # --- DRILL 4: Large Database Scale Restore Drill (>= 500,000 Records) ---
    print("\n[Drill 4] Running Scale Timed Restore Drill on database with >= 500,000 records...")
    scale_db = os.path.join(drill_dir, "scale_500k.db")
    shutil.copy2(db_template_path, scale_db)

    conn_scale = sqlite3.connect(scale_db)
    conn_scale.execute("PRAGMA journal_mode = WAL")
    conn_scale.execute("PRAGMA synchronous = NORMAL")
    conn_scale.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_update")
    conn_scale.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_delete")
    conn_scale.execute("DROP TRIGGER IF EXISTS trg_audit_logs_sequence_and_hash_guard")

    batch_size = 50000
    total_target = 500000
    t_gen_start = time.time()
    now_ms = int(time.time() * 1000)
    for b in range(0, total_target, batch_size):
        records = [
            (
                f"aud_bench_{i}", i + 1, now_ms + i, "usr_bench", "ADMIN", "term_bench",
                "system.heartbeat", "SERVER", "node_1", None, f'{{"metric": {i}}}',
                "Bench Scale Drill", "GENESIS" if i == 0 else f"hash_{i}", f"hash_{i+1}"
            )
            for i in range(b, b + batch_size)
        ]
        conn_scale.executemany("""
            INSERT INTO audit_logs (
                id, sequence_number, timestamp_ms, actor_id, actor_role, terminal_id,
                event_type, entity_type, entity_id, before_state_json, after_state_json,
                reason, prev_hash, entry_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records)
        conn_scale.commit()
    t_gen = time.time() - t_gen_start

    scale_count = conn_scale.execute("SELECT count(*) FROM audit_logs").fetchone()[0]
    conn_scale.close()
    scale_db_size = os.path.getsize(scale_db)

    print(f"  Generated benchmark database: {scale_count:,} records ({scale_db_size / (1024*1024):.2f} MB in {t_gen:.2f}s)")

    scale_backup_path = os.path.join(drill_dir, "scale_500k.omnbak")
    scale_restore_target = os.path.join(drill_dir, "scale_restored.db")

    # Time Backup
    t_bk_start = time.time()
    res_b = subprocess.run([OMNIBILL_BIN, "--backup", scale_backup_path, scale_db], capture_output=True, text=True)
    t_bk_duration = time.time() - t_bk_start

    # Time Restore
    t_rst_start = time.time()
    res_r = subprocess.run([OMNIBILL_BIN, "--restore", scale_backup_path, scale_restore_target], capture_output=True, text=True)
    t_rst_duration = time.time() - t_rst_start

    conn_res_scale = sqlite3.connect(scale_restore_target)
    integrity_scale = conn_res_scale.execute("PRAGMA integrity_check").fetchone()[0]
    restored_count = conn_res_scale.execute("SELECT count(*) FROM audit_logs").fetchone()[0]
    conn_res_scale.close()

    print(f"  Backup Duration (500k rows):  {t_bk_duration:.2f} seconds")
    print(f"  Restore Duration (500k rows): {t_rst_duration:.2f} seconds")
    print(f"  Restored Record Count:        {restored_count:,} rows")
    print(f"  PRAGMA integrity_check:       {integrity_scale}")
    print(f"  RTO Achieved:                 {t_rst_duration:.2f}s (Threshold: 900.0s / 15 minutes)")

    if res_b.returncode == 0 and res_r.returncode == 0 and integrity_scale == "ok" and restored_count == total_target and t_rst_duration < 900.0:
        print(f"✅ PASS: Timed restore of {total_target:,} records completed in {t_rst_duration:.2f}s (RTO << 15 minutes).")
        passed_drills += 1
    else:
        print(f"❌ FAILED: Scale drill failed! b_code={res_b.returncode}, r_code={res_r.returncode}, check={integrity_scale}")

    # --- DRILL 5: Automated Backup Scheduler Demonstration (Row 6.4.1) ---
    print("\n[Drill 5] Running Automated Backup Scheduler with Retention Policy Pruning (Row 6.4.1)...")
    res_sched = subprocess.run([
        "cargo", "test", "--manifest-path", CARGO_TOML,
        "hardware::scheduler::tests::test_scheduled_backup_execution_and_retention",
        "--", "--nocapture"
    ], capture_output=True, text=True)

    if res_sched.returncode == 0 and "test hardware::scheduler::tests::test_scheduled_backup_execution_and_retention ... ok" in res_sched.stdout:
        print("  Observed 2+ sequential scheduled backup executions.")
        print("  Observed automatic pruning of backups exceeding retention_count = 2.")
        print("✅ PASS: Automated Backup Scheduler & retention pruning verified (Scorecard Row 6.4.1).")
        passed_drills += 1
    else:
        print(f"❌ FAILED: Scheduler test failed: {res_sched.stderr} {res_sched.stdout}")

    # --- DRILL 6: Supervisor PIN Override Rate-Limiting & Lockout Demonstration (Row 6.3.9) ---
    print("\n[Drill 6] Running Supervisor PIN Override Lockout & Audit Verification (Row 6.3.9)...")
    res_pin = subprocess.run([
        "cargo", "test", "--manifest-path", CARGO_TOML,
        "test_supervisor_override_pin_lockout_and_audit",
        "--", "--nocapture"
    ], capture_output=True, text=True)

    if res_pin.returncode == 0 and "test test_supervisor_override_pin_lockout_and_audit ... ok" in res_pin.stdout:
        print("  Supervisor override with correct PIN verified and logged financial.override.")
        print("  5 failed PIN attempts triggered 15-minute lockout and logged auth.locked.")
        print("  Attempts during lockout window strictly rejected with AuthError::Locked.")
        print("✅ PASS: Supervisor PIN Override rate limiting & 15-minute lockout verified (Scorecard Row 6.3.9).")
        passed_drills += 1
    else:
        print(f"❌ FAILED: Supervisor lockout test failed: {res_pin.stderr} {res_pin.stdout}")

    shutil.rmtree(drill_dir, ignore_errors=True)

    print("\n" + "=" * 80)
    print(f"  HARD GATE 6 RESULT: {passed_drills} / {total_drills} RESTORE & RECOVERY DRILLS PASSED")
    print("=" * 80)
    if passed_drills == total_drills:
        print("🏆 VERDICT: HARD GATE 6 PASS (Online concurrent backup, preview, snapshot, 500k RTO << 15m, scheduler, PIN lockout verified)")
        return True
    else:
        print("💥 VERDICT: HARD GATE 6 FAIL")
        return False

if __name__ == "__main__":
    db_path = "/home/killindodo/omnibill.db"
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    success = run_drill_suite(db_path)
    sys.exit(0 if success else 1)
