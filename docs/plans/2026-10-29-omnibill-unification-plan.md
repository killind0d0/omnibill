# OmniBill ERP Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the best battle-tested features from OmniFlow, BillFlow, and the Receipt Generator into OmniBill ERP to create a single, offline-first billing and inventory software.

**Architecture:** Build on OmniBill's native Rust + SQLite WAL zero-float engine and React 19 UI. Integrate customer Khata with WhatsApp reminders, Indian number-to-words formatting, and inward stock Goods Received Notes (GRN) with strict audit integrity.

**Tech Stack:** Rust (2024 edition), SQLite (WAL mode, SQLCipher, triggers), Tauri v2, React 19, TypeScript 5.7, Tailwind CSS, Lucide icons.

---

### Scope
- **In Scope:**
  - Port Indian English Number-to-Words (`ui/src/lib/numbersToWords.ts`) with paise support.
  - Port WhatsApp Smart Reminders Engine (`ui/src/features/reminders/`) for 1-click collection links.
  - Enhance `EntityLedger.tsx` with instant WhatsApp follow-up modal and UPI QR.
  - Enhance `LightningPOS.tsx` with customer previous due warning banner.
  - Port Goods Received Note (GRN) workflow for physical stock intake from suppliers.
  - Automated test coverage for all new modules.
- **Out of Scope:**
  - Modifying SQLite trigger immutability rules (they remain strictly read/insert only).
  - Cloud PostgreSQL synchronization (app remains 100% offline-first).

---

### Task 1: Indian Number-to-Words Engine

**Files:**
- Create: `ui/src/lib/numbersToWords.ts`
- Test: `ui/tests/numbersToWords.test.mjs`
- Modify: `ui/package.json`

**Step 1: Write the failing unit test**
Create `ui/tests/numbersToWords.test.mjs` verifying:
- Zero amount: `Zero Rupees Only`
- Single digit: `₹5` -> `Five Rupees Only`
- Lakhs: `₹1,25,000` -> `One Lakh Twenty-Five Thousand Rupees Only`
- Crores: `₹2,50,00,000` -> `Two Crore Fifty Lakh Rupees Only`
- Paise breakdown: `₹150.75` -> `One Hundred Fifty Rupees and Seventy-Five Paise Only`

**Step 2: Implement `numbersToWords.ts`**
Port and convert the pure algorithmic converter from `billing-receipt-generator/js/calculations.js` into clean, strongly typed TypeScript with strict integer arithmetic.

**Step 3: Run the test**
Run `node ui/tests/numbersToWords.test.mjs` and ensure 100% pass.

---

### Task 2: Smart WhatsApp Payment Reminders Engine

**Files:**
- Create: `ui/src/features/reminders/types.ts`
- Create: `ui/src/features/reminders/whatsapp.ts`
- Test: `ui/tests/whatsapp_reminders.test.mjs`

**Step 1: Define types**
Create `ui/src/features/reminders/types.ts`:
- `ReminderItem`: partyId, partyName, partyPhone, partyRole, balanceDuePaise, invoiceNumber, dueDate, note.
- `SenderProfile`: businessName, phone, upiVpa.

**Step 2: Implement WhatsApp template formatter**
Port `composeWhatsAppUrl` from `universal-billing/smart-reminders-hub.js`:
- Phone normalization (strip spaces, add `91` country code if missing).
- Vertical-adaptive templates (Retail Shop, Wholesale, School Fee, Hospital).
- Dynamic UPI payment link and balance summary formatted in Indian Rupees.
- Safe URL encoding for `https://wa.me/{cleanPhone}?text={encodedMsg}`.

**Step 3: Write test and verify**
Create `ui/tests/whatsapp_reminders.test.mjs` testing Indian phone normalization (`9876543210` -> `919876543210`), message formatting, and URL generation.

---

### Task 3: Khata WhatsApp Follow-Up Modal in Entity Ledger

**Files:**
- Create: `ui/src/features/reminders/WhatsAppModal.tsx`
- Modify: `ui/src/pages/EntityLedger.tsx`

**Step 1: Create `WhatsAppModal.tsx`**
- Displays target customer details, total pending balance (formatted in ₹), invoice reference, and message preview.
- Includes editable notes (e.g. "Counter invoice #INV-102 overdue by 5 days").
- "Send via WhatsApp" button opening `window.open(url, '_blank')`.
- Dynamic UPI QR preview so cashier can show the QR directly to in-person customers.

**Step 2: Wire into `EntityLedger.tsx`**
- Add a green WhatsApp icon button next to each customer row with `balance_paise > 0`.
- Clicking the button opens `WhatsAppModal` pre-filled with the customer's live ledger balance.

---

### Task 4: LightningPOS Customer Previous Due Alert

**Files:**
- Modify: `ui/src/components/pos/LightningPOS.tsx`

**Step 1: Add Customer Khata lookup listener**
- When cashier enters or scans customer mobile number in POS counter:
- Lookup existing customer in `ErpStorageService.getEntities()`.
- If customer has outstanding balance (`balance_paise > 0`), display amber status banner:
  *"⚠️ Khata Due Alert: Customer has ₹X.XX pending balance. [View Ledger] [Add Surcharge/Settle]"*
- Prevents counter cashiers from unwittingly extending credit to defaulting customers.

---

### Task 5: Inward Stock Goods Received Note (GRN) Module

**Files:**
- Modify: `ui/src/types/accounting.ts`
- Modify: `ui/src/lib/erpStorage.ts`
- Create: `ui/src/pages/GoodsReceipt.tsx`
- Modify: `ui/src/App.tsx`

**Step 1: Update accounting types**
Add `GoodsReceiptNote` interface:
- `id`, `grn_number`, `supplier_id`, `supplier_name`, `challan_number`, `receipt_date`, `items: Array<{ resource_id, batch_lot, expiry_date, quantity_milli, unit_cost_paise }>`.

**Step 2: Implement GRN storage and stock update**
In `ErpStorageService`:
- Add `recordGoodsReceipt(grn: GoodsReceiptNote)`:
  - Appends GRN to `omnibill_grn_v2`.
  - Increments stock levels for matching `resource_id` in `omnibill_items_v2`.
  - Records stock lot with batch and expiry tracking.

**Step 3: Create `GoodsReceipt.tsx` page**
- Clean intake table for warehouse/store staff:
  - Select Supplier.
  - Enter Inward Challan / Invoice No.
  - Scan / select item barcode.
  - Enter Quantity, Batch No, Expiry Month/Year, Cost Price.
  - Click "Post GRN & Restock".

**Step 4: Register in `App.tsx` router**
Add `GOODS_RECEIPT` route in `AppRoute` with PackagePlus icon in the top header.

---

### Task 6: Final Verification & Test Suite Run

**Files:**
- Run: `npm --prefix ui test`
- Run: `cargo test --manifest-path src-tauri/Cargo.toml --all-targets`

**Step 1: Execute all unit and integration tests**
Ensure 0 failures across Rust database engine, SQLite immutability triggers, and TypeScript UI logic.
