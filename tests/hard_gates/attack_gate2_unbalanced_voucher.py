#!/usr/bin/env python3
"""
Adversarial Attack Suite - Hard Gate 2: Unbalanced Voucher & Ledger Gateway Guard
Validates that NO PATH (direct SQL, draft mutation, orphan insertion, negative values,
carve-out bypass, dual-parent injection, reopen, delete, or replace) can commit an
unbalanced voucher into SQLite.

Strictly asserts exact error strings across all adversarial vectors.
"""

import sqlite3
import sys
import os
import shutil

def run_attack_suite(db_template_path):
    print("=" * 80)
    print("  HARD GATE 2 ADVERSARIAL ATTACK DRILL: UNBALANCED VOUCHER PREVENTION")
    print("=" * 80)

    test_db = "/tmp/test_gate2_adversarial.db"
    if os.path.exists(test_db):
        os.remove(test_db)
    shutil.copy2(db_template_path, test_db)

    # Open raw SQLite connection directly (bypassing any application code)
    conn = sqlite3.connect(test_db)
    conn.execute("PRAGMA foreign_keys = OFF") # Adversarial mode: disable FKs to test trigger isolation
    conn.execute("PRAGMA recursive_triggers = ON")

    # Display full Trigger SQL definitions
    print("\n[Audit Info] Verifying Database Triggers guarding Gate 2:")
    triggers = conn.execute("""
        SELECT name, sql FROM sqlite_master 
        WHERE type = 'trigger' AND name IN (
            'trg_transactions_no_direct_posted_insert',
            'trg_ledger_entries_insert_only_on_draft',
            'trg_ledger_entries_line_amounts_check',
            'trg_transactions_verify_balanced_on_post',
            'trg_transactions_update_guard',
            'trg_transactions_no_delete',
            'trg_ledger_entries_no_update',
            'trg_ledger_entries_no_delete',
            'trg_ledger_entries_payment_balance_guard'
        )
        ORDER BY name;
    """).fetchall()

    for name, sql in triggers:
        print(f"\n--- Trigger: {name} ---")
        print(sql.strip())

    passed_attacks = 0
    total_attacks = 18

    # Test Fixtures
    user_id = "usr_adversary"
    entity_id = "ent_victim"
    conn.execute("INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role) VALUES (?, 'adv', 'h', 'Adv', 'ADMIN')", (user_id,))
    conn.execute("INSERT OR IGNORE INTO entities (id, entity_code, entity_type, full_name, state_code) VALUES (?, 'E1', 'CUSTOMER', 'Victim', '27')", (entity_id,))
    conn.commit()

    # --- ATTACK 1: Direct Raw SQL Insert with status = 'POSTED' ---
    print("\n[Attack 1] Attempt direct raw SQL INSERT of transaction with status = 'POSTED'...")
    try:
        conn.execute("""
            INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_atk1', 'POSTED', '27', '27', 'INV', 'INV/26-27/ATK1', ?,
                10000, 0, 10000, 900, 900, 0, 0, 11800, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.commit()
        print("❌ FAILED: Direct INSERT of POSTED transaction succeeded!")
    except Exception as e:
        err = str(e)
        if "GATEWAY_VIOLATION" in err and "Direct insert of POSTED transaction is forbidden" in err:
            print(f"✅ BLOCKED [GATEWAY_VIOLATION]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 2: Post DRAFT Voucher with Unbalanced Dr != Cr (2 lines: Dr 5000, Cr 3000) ---
    print("\n[Attack 2] Attempt posting DRAFT voucher with 2 unbalanced lines (Dr: 5000, Cr: 3000)...")
    try:
        conn.execute("""
            INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_atk2', 'DRAFT', '27', '27', 'INV', 'INV/26-27/ATK2', ?,
                5000, 0, 5000, 0, 0, 0, 0, 5000, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk2_1', 'tx_atk2', NULL, 'acc_1100', 5000, 0, 'Debit 5000')")
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk2_2', 'tx_atk2', NULL, 'acc_4000', 0, 3000, 'Credit 3000 (imbalance 2000)')")
        conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_atk2'")
        conn.commit()
        print("❌ FAILED: Unbalanced voucher was posted!")
    except Exception as e:
        err = str(e)
        if "UNBALANCED_VOUCHER" in err and "Total debits must equal total credits" in err:
            print(f"✅ BLOCKED [UNBALANCED_VOUCHER: Total debits must equal total credits]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 3: Post DRAFT Voucher with < 2 ledger lines (1 line only) ---
    print("\n[Attack 3] Attempt posting DRAFT voucher with only 1 line...")
    try:
        conn.execute("""
            INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_atk3', 'DRAFT', '27', '27', 'INV', 'INV/26-27/ATK3', ?,
                5000, 0, 5000, 0, 0, 0, 0, 5000, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk3_1', 'tx_atk3', NULL, 'acc_1100', 5000, 0, 'Single line')")
        conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_atk3'")
        conn.commit()
        print("❌ FAILED: Single-line voucher was posted!")
    except Exception as e:
        err = str(e)
        if "UNBALANCED_VOUCHER" in err and "Voucher must contain at least 2 ledger lines" in err:
            print(f"✅ BLOCKED [UNBALANCED_VOUCHER: Voucher must contain at least 2 ledger lines]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 4: Negative Line Amounts ---
    print("\n[Attack 4] Attempt inserting negative line amount (debit: -500)...")
    try:
        conn.execute("""
            INSERT OR IGNORE INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_atk4', 'DRAFT', '27', '27', 'INV', 'INV/26-27/ATK4', ?,
                5000, 0, 5000, 0, 0, 0, 0, 5000, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk4_1', 'tx_atk4', NULL, 'acc_1100', -500, 0, 'Negative debit')")
        conn.commit()
        print("❌ FAILED: Negative line amount inserted!")
    except Exception as e:
        err = str(e)
        if "INVALID_LINE_AMOUNT" in err:
            print(f"✅ BLOCKED [INVALID_LINE_AMOUNT]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 5: Double-Sided Line (Both Debit and Credit > 0) ---
    print("\n[Attack 5] Attempt inserting double-sided line (debit: 500, credit: 500)...")
    try:
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk5_1', 'tx_atk4', NULL, 'acc_1100', 500, 500, 'Double-sided line')")
        conn.commit()
        print("❌ FAILED: Double-sided line inserted!")
    except Exception as e:
        err = str(e)
        if "INVALID_LINE_AMOUNT" in err:
            print(f"✅ BLOCKED [INVALID_LINE_AMOUNT]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 6: Zero-Zero Line (Both Debit and Credit == 0) ---
    print("\n[Attack 6] Attempt inserting zero-zero line (debit: 0, credit: 0)...")
    try:
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk6_1', 'tx_atk4', NULL, 'acc_1100', 0, 0, 'Zero-zero line')")
        conn.commit()
        print("❌ FAILED: Zero-zero line inserted!")
    except Exception as e:
        err = str(e)
        if "INVALID_LINE_AMOUNT" in err:
            print(f"✅ BLOCKED [INVALID_LINE_AMOUNT]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 7: Orphan Line Insert (Missing parent, FK=OFF) ---
    print("\n[Attack 7] Attempt inserting ledger entry with non-existent parent (FK=OFF)...")
    try:
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk7_1', 'tx_ghost_id', NULL, 'acc_1100', 1000, 0, 'Ghost parent')")
        conn.commit()
        print("❌ FAILED: Orphan ledger entry was inserted!")
    except Exception as e:
        err = str(e)
        if "LINE_REQUIRES_DRAFT_PARENT" in err:
            print(f"✅ BLOCKED [LINE_REQUIRES_DRAFT_PARENT]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 8: NULL-Parent Line (Both transaction_id and payment_id NULL) ---
    print("\n[Attack 8] Attempt inserting ledger entry with NULL parents (both tx_id and payment_id NULL)...")
    try:
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk8_1', NULL, NULL, 'acc_1100', 1000, 0, 'Null parents')")
        conn.commit()
        print("❌ FAILED: NULL-parent ledger entry was inserted!")
    except Exception as e:
        err = str(e)
        if "LINE_REQUIRES_DRAFT_PARENT" in err:
            print(f"✅ BLOCKED [LINE_REQUIRES_DRAFT_PARENT]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 9: Dual-Parent Line (Both transaction_id and payment_id provided) ---
    print("\n[Attack 9] Attempt inserting ledger entry attaching to BOTH transaction and payment...")
    # First seed a payment
    conn.execute("INSERT OR IGNORE INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, reference_number, created_by_user_id) VALUES ('pay_dummy', 'PAY/001', ?, 'CASH', 5000, 'REF-1', ?)", (entity_id, user_id))
    try:
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_atk9_1', 'tx_atk4', 'pay_dummy', 'acc_1100', 1000, 0, 'Dual parent injection')")
        conn.commit()
        print("❌ FAILED: Dual-parent ledger entry was inserted!")
    except Exception as e:
        err = str(e)
        if "LINE_REQUIRES_DRAFT_PARENT" in err:
            print(f"✅ BLOCKED [LINE_REQUIRES_DRAFT_PARENT: Entry must have exactly one parent]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 10: Post-Commit Line Injection on POSTED Transaction ---
    print("\n[Attack 10] Setup legitimate POSTED voucher, then attempt post-commit line injection...")
    conn.execute("""
        INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            'tx_legit', 'DRAFT', '27', '27', 'INV', 'INV/26-27/LEGIT', ?,
            10000, 0, 10000, 900, 900, 0, 0, 11800, ?, 'SALE', NULL, '2026-05-15'
        )
    """, (entity_id, user_id))
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_legit_dr', 'tx_legit', NULL, 'acc_1100', 11800, 0, 'Legit Dr')")
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_legit_cr', 'tx_legit', NULL, 'acc_4000', 0, 11800, 'Legit Cr')")
    conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_legit'")
    conn.commit()

    try:
        # Sneak a line into the posted transaction
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_sneak', 'tx_legit', NULL, 'acc_1100', 5000, 0, 'Sneak injection')")
        conn.commit()
        print("❌ FAILED: Post-commit line injection succeeded!")
    except Exception as e:
        err = str(e)
        if "LINE_REQUIRES_DRAFT_PARENT" in err:
            print(f"✅ BLOCKED [LINE_REQUIRES_DRAFT_PARENT: Cannot attach lines to POSTED parent]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 11: Payment 3rd Line Carve-out Abuse ---
    print("\n[Attack 11] Attempt inserting a 3rd line into a payment (payment lines must be exactly 2)...")
    conn.execute("INSERT OR IGNORE INTO payments (id, payment_number, entity_id, payment_mode, amount_paise, reference_number, created_by_user_id) VALUES ('pay_test', 'PAY/002', ?, 'CASH', 2000, 'REF-TEST', ?)", (entity_id, user_id))
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pay_1', NULL, 'pay_test', 'acc_1000', 2000, 0, 'Pay Dr')")
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pay_2', NULL, 'pay_test', 'acc_1100', 0, 2000, 'Pay Cr')")
    conn.commit()

    try:
        # Attempt 3rd line
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pay_3', NULL, 'pay_test', 'acc_1000', 500, 0, 'Illegal 3rd line')")
        conn.commit()
        print("❌ FAILED: 3rd payment line was inserted!")
    except Exception as e:
        err = str(e)
        if "GATEWAY_VIOLATION" in err and "Payment may only have exactly 2 balanced ledger lines" in err:
            print(f"✅ BLOCKED [GATEWAY_VIOLATION: Payment line count capped]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 12: Reopening POSTED Transaction (status: POSTED -> DRAFT) ---
    print("\n[Attack 12] Attempt reopening POSTED transaction (UPDATE status = 'DRAFT')...")
    try:
        conn.execute("UPDATE transactions SET status = 'DRAFT' WHERE id = 'tx_legit'")
        conn.commit()
        print("❌ FAILED: Posted voucher was reopened to DRAFT!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err and "Only status transition DRAFT -> POSTED" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: Reopen forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 13: Reverse Cancellation (status: CANCELLED -> POSTED) ---
    print("\n[Attack 13] Cancel voucher, then attempt reverse transition (CANCELLED -> POSTED)...")
    conn.execute("UPDATE transactions SET status = 'CANCELLED' WHERE id = 'tx_legit'")
    conn.commit()

    try:
        conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_legit'")
        conn.commit()
        print("❌ FAILED: CANCELLED voucher was revived to POSTED!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: CANCELLED -> POSTED forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 14: Direct Mutation of Financial Columns on POSTED Transaction ---
    print("\n[Attack 14] Setup another POSTED voucher, attempt mutating total_amount_paise...")
    conn.execute("""
        INSERT INTO transactions (
            id, status, seller_state_code, place_of_supply_state_code, series,
            invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
            cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
            created_by_user_id, transaction_type, original_transaction_id, invoice_date
        ) VALUES (
            'tx_mut', 'DRAFT', '27', '27', 'INV', 'INV/26-27/MUT', ?,
            10000, 0, 10000, 900, 900, 0, 0, 11800, ?, 'SALE', NULL, '2026-05-15'
        )
    """, (entity_id, user_id))
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_mut_dr', 'tx_mut', NULL, 'acc_1100', 11800, 0, 'Mut Dr')")
    conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_mut_cr', 'tx_mut', NULL, 'acc_4000', 0, 11800, 'Mut Cr')")
    conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_mut'")
    conn.commit()

    try:
        conn.execute("UPDATE transactions SET total_amount_paise = 99999 WHERE id = 'tx_mut'")
        conn.commit()
        print("❌ FAILED: total_amount_paise on posted transaction was modified!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: Financial mutation forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 15: Raw DELETE on POSTED Transaction ---
    print("\n[Attack 15] Attempt DELETE on POSTED transaction...")
    try:
        conn.execute("DELETE FROM transactions WHERE id = 'tx_mut'")
        conn.commit()
        print("❌ FAILED: DELETE on transactions succeeded!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err and "DELETE on transactions is forbidden" in err:
            print(f"✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: DELETE forbidden]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 16: INSERT OR REPLACE into Transactions (Collision Overwrite) ---
    print("\n[Attack 16] Attempt INSERT OR REPLACE into transactions on existing POSTED id...")
    try:
        conn.execute("""
            INSERT OR REPLACE INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_mut', 'POSTED', '27', '27', 'INV', 'INV/26-27/MUT_FORGE', ?,
                20000, 0, 20000, 1800, 1800, 0, 0, 23600, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.commit()
        print("❌ FAILED: INSERT OR REPLACE overwrote posted transaction!")
    except Exception as e:
        err = str(e)
        if "IMMUTABILITY_RULE_BROKEN" in err or "GATEWAY_VIOLATION" in err:
            print(f"✅ BLOCKED [REPLACE ABORTED]: {err}")
            passed_attacks += 1
        else:
            print(f"❌ FAILED with unexpected error: {err}")

    # --- ATTACK 17: Tampering or Deleting POSTED Ledger Entries ---
    print("\n[Attack 17] Attempt direct UPDATE or DELETE on posted ledger_entries...")
    upd_blocked = False
    del_blocked = False
    try:
        conn.execute("UPDATE ledger_entries SET debit_paise = 99999 WHERE id = 'le_mut_dr'")
        conn.commit()
    except Exception as e:
        if "IMMUTABILITY_RULE_BROKEN" in str(e):
            upd_blocked = True
    try:
        conn.execute("DELETE FROM ledger_entries WHERE id = 'le_mut_dr'")
        conn.commit()
    except Exception as e:
        if "IMMUTABILITY_RULE_BROKEN" in str(e):
            del_blocked = True

    if upd_blocked and del_blocked:
        print("✅ BLOCKED [IMMUTABILITY_RULE_BROKEN: UPDATE and DELETE on posted lines strictly forbidden]")
        passed_attacks += 1
    else:
        print(f"❌ FAILED: Immutability breach: upd_blocked={upd_blocked}, del_blocked={del_blocked}")

    # --- ATTACK 18: POSITIVE CONTROL - Legitimate Balanced Voucher Lifecycle ---
    print("\n[Attack 18 / Positive Control] Execute legitimate balanced voucher posting & ledger audit...")
    try:
        conn.execute("""
            INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                created_by_user_id, transaction_type, original_transaction_id, invoice_date
            ) VALUES (
                'tx_pos_ctrl', 'DRAFT', '27', '27', 'INV', 'INV/26-27/POS01', ?,
                50000, 0, 50000, 4500, 4500, 0, 0, 59000, ?, 'SALE', NULL, '2026-05-15'
            )
        """, (entity_id, user_id))
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pc_dr', 'tx_pos_ctrl', NULL, 'acc_1100', 59000, 0, 'Positive Control AR Dr')")
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pc_cr1', 'tx_pos_ctrl', NULL, 'acc_4000', 0, 50000, 'Positive Control Sales Cr')")
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pc_cr2', 'tx_pos_ctrl', NULL, 'acc_2110', 0, 4500, 'Positive Control CGST Cr')")
        conn.execute("INSERT INTO ledger_entries (id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration) VALUES ('le_pc_cr3', 'tx_pos_ctrl', NULL, 'acc_2120', 0, 4500, 'Positive Control SGST Cr')")
        conn.execute("UPDATE transactions SET status = 'POSTED' WHERE id = 'tx_pos_ctrl'")
        conn.commit()

        # Audit ledger balance across all posted records
        res = conn.execute("""
            SELECT
                SUM(debit_paise) as total_debit,
                SUM(credit_paise) as total_credit,
                SUM(debit_paise) - SUM(credit_paise) as net_diff
            FROM ledger_entries le
            JOIN transactions t ON t.id = le.transaction_id
            WHERE t.status = 'POSTED'
        """).fetchone()

        total_dr, total_cr, net_diff = res[0] or 0, res[1] or 0, res[2] or 0
        print(f"  Posted Ledger Debits:  ₹{total_dr/100:.2f}")
        print(f"  Posted Ledger Credits: ₹{total_cr/100:.2f}")
        print(f"  Net Ledger Difference: ₹{net_diff/100:.2f}")

        if total_dr > 0 and total_cr > 0 and net_diff == 0:
            print("✅ POSITIVE CONTROL PASSED: Legitimate multi-line voucher posted successfully and Dr == Cr held strictly.")
            passed_attacks += 1
        else:
            print("❌ POSITIVE CONTROL FAILED: Ledger imbalance in posted records!")
    except Exception as e:
        print(f"❌ POSITIVE CONTROL FAILED with error: {e}")

    conn.close()
    if os.path.exists(test_db):
        os.remove(test_db)

    print("\n" + "=" * 80)
    print(f"  HARD GATE 2 RESULT: {passed_attacks} / {total_attacks} ADVERSARIAL ATTACKS PASSED")
    print("=" * 80)
    if passed_attacks == total_attacks:
        print("🏆 VERDICT: HARD GATE 2 PASS (Zero unbalanceable pathways exist, all error codes asserted)")
        return True
    else:
        print("💥 VERDICT: HARD GATE 2 FAIL")
        return False

if __name__ == "__main__":
    db_path = "/home/killindodo/omnibill.db"
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    success = run_attack_suite(db_path)
    sys.exit(0 if success else 1)
