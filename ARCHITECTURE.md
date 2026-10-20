# OmniBill ERP — Architectural Blueprint

This document outlines the engineering architecture, accounting theory, database invariants, and hardware interfaces of **OmniBill ERP**.

---

## 1. REA (Resource-Event-Agent) Accounting Core

OmniBill is constructed upon William E. McCarthy’s **Resource-Event-Agent (REA)** economic ontology, an accounting model that represents enterprise phenomena as actual economic exchanges rather than artificial bookkeeping debits and credits.

```
                      +-------------------+
                      |   Inside Agent    |
                      |   (User/Cashier)  |
                      +---------+---------+
                                | participates in
                                v
+------------------+    +---------------+    +------------------+
|     Resource     |<---|     Event     |--->|  Outside Agent   |
| (Goods/Services) |    | (Transaction) |    |    (Customer/    |
|                  |--->|   (Payment)   |<---|    Supplier)     |
+------------------+    +---------------+    +------------------+
    decremented /              ^
     incremented               | dual exchange
                               v
                        +---------------+
                        |     Event     |
                        | (Settlement/  |
                        | Claim Inflow) |
                        +---------------+
```

### 1.1 The Triad of Entities
* **Resources**: Tangible or intangible goods of economic value that can be increased or decreased.
  * In OmniBill: `resources` (SKUs, services, ward charges) and their specific physical batches (`resource_lots`).
* **Events**: The transactions that increment or decrement resource values at a specific instant in time.
  * In OmniBill: `transactions` (`SALE`, `PURCHASE`, `SALE_RETURN`, `PURCHASE_RETURN`), `payments`, and `stock_movements`.
* **Agents**: The individuals or corporate legal entities that participate in events and assume control of resources.
  * In OmniBill: Internal agents (`users` with roles `ADMIN`, `MANAGER`, `CASHIER`) and external agents (`entities` with types `CUSTOMER`, `SUPPLIER`, `PATIENT`, `STUDENT`).

### 1.2 Duality of Economic Exchange
Under REA, every economic event has a corresponding give-and-take duality:
1. When a **Sale** event occurs:
   * **Resource Decrement**: The enterprise relinquishes inventory (`stock_movements` record negative `quantity_delta_milli` tied to a specific lot).
   * **Economic Claim Inflow**: The enterprise claims an asset (Accounts Receivable or Cash), balanced by Sales Revenue and Tax Liabilities in `ledger_entries`.
2. When a **Payment** event occurs:
   * Cash/Bank Asset is incremented, and the Customer's Accounts Receivable is decremented via `payment_allocations` referencing original transaction IDs.

### 1.3 Schema Implementation of REA
Unlike traditional accounting packages that maintain a stored `balance` column on account or customer tables, OmniBill **has no stored balance column**.
* Account balances are strictly derived from the sum of immutable ledger entries: `SUM(debit_paise) - SUM(credit_paise)`.
* Resource stock levels are strictly derived from the sum of immutable movements: `SUM(quantity_delta_milli)`.
* This completely eliminates state drift, race condition bugs, and inconsistent balance reconciliations.

---

## 2. Integer-Only Arithmetic & Rounding Mechanics

Accounting software written with IEEE-754 floating-point numbers (`f32`, `f64`, or JavaScript `number`) inevitably suffers from binary representation errors:
$$\frac{1}{10} + \frac{2}{10} \neq \frac{3}{10} \quad (0.1 + 0.2 = 0.30000000000000004)$$

In Indian GST compliance, an invoice with a 1-paisa calculation discrepancy between the line totals and invoice totals is rejected by the GST Common Portal during GSTR-1 uploading. OmniBill enforces a **Zero-Float Guarantee** across the entire codebase.

### 2.1 Integer Representations
* **Currency (`i64` in Paise)**:
  * $1\text{ INR} = 100\text{ paise}$.
  * $₹1,499.50 \rightarrow 149950\text{ paise}$.
  * Stored in SQLite as `INTEGER`. Negative values are forbidden by `CHECK(col >= 0)`.
* **Quantity (`i64` in Milli-units)**:
  * $1\text{ standard unit} = 1,000\text{ milli-units}$.
  * $1.250\text{ kg} \rightarrow 1250\text{ milli-units}$.
  * $3\text{ pieces} \rightarrow 3000\text{ milli-units}$.
  * Allows exact weight, length, volume, and count representation down to 3 decimal places without floating-point numbers.
* **Tax Rates (`i64` in Basis Points - bps)**:
  * $1\% = 100\text{ bps}$.
  * $18\% = 1800\text{ bps}$.
  * $0.25\%\text{ (gemstones)} = 25\text{ bps}$.

### 2.2 Round-Half-Up Division (`round_div_i128`)
For tax and line calculations, division cannot truncate (which would systematically shortchange tax departments or customers). OmniBill uses **round-half-up (half away from zero)** arithmetic, computed entirely using 128-bit integers (`i128`) to prevent overflow:

$$\text{round\_div}(a, b) = \begin{cases} \left\lfloor \frac{a + \lfloor b/2 \rfloor}{b} \right\rfloor & \text{if } a \ge 0, b > 0 \\ \left\lfloor \frac{a - \lfloor b/2 \rfloor}{b} \right\rfloor & \text{if } a < 0, b > 0 \end{cases}$$

```rust
pub fn round_div_i128(numerator: i128, denominator: i128) -> Result<i128, PostingError> {
    if denominator == 0 {
        return Err(PostingError::DivisionByZero);
    }
    if numerator == 0 {
        return Ok(0);
    }
    let (num, den) = if denominator < 0 {
        (numerator.checked_neg().ok_or(PostingError::MathOverflow)?,
         denominator.checked_neg().ok_or(PostingError::MathOverflow)?)
    } else {
        (numerator, denominator)
    };

    let half = den / 2;
    let rounded_num = if num >= 0 {
        num.checked_add(half).ok_or(PostingError::MathOverflow)?
    } else {
        num.checked_sub(half).ok_or(PostingError::MathOverflow)?
    };

    Ok(rounded_num / den)
}
```

### 2.3 Tax Formulas
For each line item with quantity $Q$ (milli-units), unit price $P$ (paise), discount $D$ (paise), and tax rate $B$ (bps):

1. **Gross Amount**:
   $$\text{Gross} = \text{round\_div}(Q \times P, 1000)$$
2. **Taxable Amount (Exclusive Mode)**:
   $$\text{Taxable} = \text{Gross} - D$$
3. **Taxable Amount (Inclusive Mode)**:
   $$\text{Taxable} = \text{round\_div}((\text{Gross} - D) \times 10000, 10000 + B)$$
4. **GST Tax Split**:
   * **Intra-State** ($\text{Seller State} = \text{Place of Supply}$):
     $$\text{CGST} = \text{round\_div}\left(\text{Taxable} \times \frac{B}{2}, 10000\right), \quad \text{SGST} = \text{CGST}, \quad \text{IGST} = 0$$
   * **Inter-State** ($\text{Seller State} \neq \text{Place of Supply}$):
     $$\text{IGST} = \text{round\_div}(\text{Taxable} \times B, 10000), \quad \text{CGST} = 0, \quad \text{SGST} = 0$$
5. **Round-Off Invariant**:
   $$\text{Total Raw} = \text{Taxable} + \text{CGST} + \text{SGST} + \text{IGST}$$
   $$\text{Rounded Total} = \left\lfloor \frac{\text{Total Raw} + 50}{100} \right\rfloor \times 100$$
   $$\text{Round-Off} = \text{Rounded Total} - \text{Total Raw} \quad (-99 \le \text{Round-Off} \le +99)$$

---

## 3. SQLite WAL Concurrency & Immutability Triggers

OmniBill embeds SQLite directly in process. To satisfy the demands of multi-threaded cashier UI and crash resilience during electrical power outages, every connection opened via `open_connection()` immediately executes the following five mandatory PRAGMAs:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA recursive_triggers = ON;
```

### 3.1 Pragma Specifications
1. **`journal_mode = WAL` (Write-Ahead Logging)**:
   * Readers and writers do not block each other. While a report query scans millions of rows, the cashier can commit a new sales invoice in <1ms.
   * Eliminates concurrency stalls common to legacy rollback journal databases.
2. **`synchronous = FULL`**:
   * Ensures that SQLite syncs WAL frames to persistent physical disk before completing the commit transaction. Crucial for retail environments with unstable power grids.
3. **`foreign_keys = ON`**:
   * Relational integrity is enforced. All foreign keys are defined with `ON DELETE RESTRICT` to prevent accidental cascading deletion of financial data.
4. **`busy_timeout = 5000`**:
   * Under write contention, connection requests automatically wait up to 5,000 ms before returning an `SQLITE_BUSY` error.
5. **`recursive_triggers = ON`**:
   * Ensures triggers that fire subsequent SQL actions trigger the complete audit chain.

### 3.2 Connection Security Guard
To protect against unvetted connections bypassing database safety, every domain posting function (`post_sale`, `post_payment`, `post_purchase`, `post_return`) executes an explicit pre-flight validation check:

```rust
let recursive_triggers: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;

if recursive_triggers != 1 || foreign_keys != 1 {
    return Err(PostingError::InsecureConnection { recursive_triggers, foreign_keys });
}
```

### 3.3 The Immutability Trigger Matrix
All core accounting and inventory tables are protected against tampering:

```sql
-- 1. Ledger Entries Immutability
CREATE TRIGGER trg_ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on ledger_entries is forbidden.'); END;

CREATE TRIGGER trg_ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on ledger_entries is forbidden.'); END;

-- 2. Stock Movements Immutability
CREATE TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on stock_movements is forbidden.'); END;

CREATE TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on stock_movements is forbidden.'); END;

-- 3. Transaction Items Immutability
CREATE TRIGGER trg_transaction_items_no_update BEFORE UPDATE ON transaction_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: UPDATE on transaction_items is forbidden.'); END;

CREATE TRIGGER trg_transaction_items_no_delete BEFORE DELETE ON transaction_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on transaction_items is forbidden.'); END;

-- 4. Transactions Deletion Block
CREATE TRIGGER trg_transactions_no_delete BEFORE DELETE ON transactions
BEGIN SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: DELETE on transactions is forbidden; mark as CANCELLED instead.'); END;

-- 5. Transactions Selective Update Guard
-- UPDATE is permitted ONLY when transitioning status from POSTED to CANCELLED,
-- provided that EVERY other column remains strictly identical (OLD.col IS NEW.col).
CREATE TRIGGER trg_transactions_update_guard BEFORE UPDATE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'IMMUTABILITY_RULE_BROKEN: Only status transition from POSTED to CANCELLED is allowed; all other columns must remain unchanged.')
    WHERE NOT (
        OLD.status = 'POSTED' AND NEW.status = 'CANCELLED' AND
        OLD.id IS NEW.id AND
        OLD.seller_state_code IS NEW.seller_state_code AND
        OLD.place_of_supply_state_code IS NEW.place_of_supply_state_code AND
        OLD.series IS NEW.series AND
        OLD.invoice_number IS NEW.invoice_number AND
        OLD.entity_id IS NEW.entity_id AND
        OLD.subtotal_paise IS NEW.subtotal_paise AND
        OLD.discount_paise IS NEW.discount_paise AND
        OLD.taxable_paise IS NEW.taxable_paise AND
        OLD.cgst_paise IS NEW.cgst_paise AND
        OLD.sgst_paise IS NEW.sgst_paise AND
        OLD.igst_paise IS NEW.igst_paise AND
        OLD.total_amount_paise IS NEW.total_amount_paise AND
        OLD.notes IS NEW.notes AND
        OLD.created_by_user_id IS NEW.created_by_user_id AND
        OLD.created_at IS NEW.created_at AND
        OLD.transaction_type IS NEW.transaction_type AND
        OLD.original_transaction_id IS NEW.original_transaction_id AND
        OLD.invoice_date IS NEW.invoice_date AND
        OLD.round_off_paise IS NEW.round_off_paise
    );
END;
```

---

## 4. Gapless Indian Financial Year Series Allocation

Under Section 31 of the Central Goods and Services Tax (CGST) Act, 2017:
> *"Tax invoice shall contain a consecutive serial number not exceeding sixteen characters, in one or multiple series, containing alphabets or numerals or special characters like hyphen or slash symbol."*

### 4.1 FY Derivation Rules (`parse_financial_year`)
* In India, the Financial Year begins on **April 1** and concludes on **March 31** of the succeeding calendar year.
* Examples:
  * `2026-04-01` $\rightarrow$ `2026-27`
  * `2026-12-15` $\rightarrow$ `2026-27`
  * `2027-03-31` $\rightarrow$ `2026-27`
  * `2027-04-01` $\rightarrow$ `2027-28`

### 4.2 Atomic Gapless Allocation (`allocate_invoice_number`)
Inside an immediate transaction (`BEGIN IMMEDIATE`):
1. Query `number_series` for `(series_code, financial_year)` with `is_active = 1`.
2. Format the string: `{prefix}{zero_padded_number}` (e.g., `INV/26-27/0001`).
3. Assert total string length $\le 16$ characters.
4. Advance the sequence using `UPDATE number_series SET next_number = next_number + 1`.
5. The `trg_number_series_update_guard` trigger strictly aborts any update where `NEW.next_number != OLD.next_number + 1`, making manual number skipping or sequence manipulation impossible.

---

## 5. Double-Entry Invariant Verification (`verify_ledger`)

To ensure mathematical and relational integrity across the entire database, OmniBill provides the `verify_ledger` diagnostic engine. It audits the active database state in a single read transaction to detect any discrepancies.

```rust
pub fn verify_ledger(conn: &Connection) -> Result<Vec<LedgerDiscrepancy>>
```

### 5.1 Checked Invariants
1. **Transaction Balance Check**:
   $$\sum \text{debit\_paise} = \sum \text{credit\_paise} \quad \forall \; \text{transaction\_id}$$
   * Discrepancy: `LedgerDiscrepancy::UnbalancedTransaction { transaction_id, net_difference_paise }`
2. **Payment Balance Check**:
   $$\sum \text{debit\_paise} = \sum \text{credit\_paise} \quad \forall \; \text{payment\_id}$$
   * Discrepancy: `LedgerDiscrepancy::UnbalancedPayment { payment_id, net_difference_paise }`
3. **Global Ledger Balance Check**:
   $$\sum_{\text{all rows}} \text{debit\_paise} = \sum_{\text{all rows}} \text{credit\_paise}$$
   * Discrepancy: `LedgerDiscrepancy::GlobalImbalance { total_debit_paise, total_credit_paise }`
4. **Orphaned POSTED Transactions**:
   $$\forall \; t \in \text{transactions} \text{ where } t.\text{status} = \text{'POSTED'}, \; \exists \; l \in \text{ledger\_entries} \text{ where } l.\text{transaction\_id} = t.\text{id}$$
   * Discrepancy: `LedgerDiscrepancy::PostedTransactionWithoutEntries { transaction_id }`

---

## 6. Hardware Printing Pipeline (ESC/POS Raw Bytes)

Web-based ERP solutions rely on the browser's `window.print()` dialog, which suffers from:
* 3 to 5 second rendering lag.
* Pop-up dialogs blocking cashier entry.
* Unpredictable page breaks and font scaling.
* Inability to send hardware drawer kick pulses.

OmniBill bypasses the OS print spooler and communicates directly with POS hardware via raw ESC/POS byte streams.

```
+-----------------------------------------------------------+
|                   OmniBill Core (Rust)                    |
+-----------------------------------------------------------+
                             |
                             | Synthesizes Raw Bytes:
                             | [0x1B, 0x40, 0x1B, 0x45, 0x01, ...]
                             v
+-----------------------------------------------------------+
|                  ESC/POS Hardware Driver                  |
+-----------------------------------------------------------+
        |                    |                    |
        | USB Bulk           | Serial RS-232      | Raw TCP
        | (WinUSB/libusb)    | (COM1..COM16)      | (Port 9100)
        v                    v                    v
+-----------------------------------------------------------+
|               Thermal Receipt Printer (58mm/80mm)         |
+-----------------------------------------------------------+
                             |
                             | Pin 2/Pin 5 Solenoid Pulse
                             v
+-----------------------------------------------------------+
|                   RJ-11 Cash Drawer                       |
+-----------------------------------------------------------+
```

### 6.1 Command Byte Specifications
* **Printer Initialization**: `[0x1B, 0x40]` (`ESC @`) – Clears print buffer and resets font settings.
* **Emphasis / Bold**:
  * On: `[0x1B, 0x45, 0x01]` (`ESC E 1`)
  * Off: `[0x1B, 0x45, 0x00]` (`ESC E 0`)
* **Text Alignment**:
  * Left: `[0x1B, 0x61, 0x00]` (`ESC a 0`)
  * Center: `[0x1B, 0x61, 0x01]` (`ESC a 1`)
  * Right: `[0x1B, 0x61, 0x02]` (`ESC a 2`)
* **Cash Drawer Pulse**:
  * `[0x1B, 0x70, 0x00, 0x19, 0xFA]` (`ESC p 0 25 250`) – Fires a 50 ms electrical pulse to pin 2 of the RJ-11 connector to eject the drawer.
* **Paper Cut**:
  * Partial Cut: `[0x1D, 0x56, 0x01]` (`GS V 1`)
  * Full Cut with Feed: `[0x1D, 0x56, 0x42, 0x18]` (`GS V 66 24`)

### 6.2 Standard Thermal Width Formatting
* **80 mm Paper**: 48 columns in Standard Font A (12x24 dots).
  * Column Layout: `Qty (6) | Description (22) | Rate (10) | Amount (10)`.
* **58 mm Paper**: 32 columns in Standard Font A.
  * Column Layout: `Item (14) | Qty (5) | Price (6) | Total (7)`.

### 6.3 Dynamic UPI QR Code Generation
In compliance with the NPCI Unified Payments Interface specification, OmniBill formats a merchant payment payload:
```
upi://pay?pa={upi_vpa}&pn={legal_name}&am={amount_inr}&tr={invoice_number}&cu=INR
```
The string is rasterized in-memory into native ESC/POS QR Code modules (`GS ( k`) and printed directly at the bottom of the bill, enabling customers to scan and pay in seconds.
