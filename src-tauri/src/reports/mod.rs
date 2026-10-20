use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::ops::Deref;

/// Errors that can occur during financial report generation.
#[derive(Debug)]
pub enum ReportError {
    Database(rusqlite::Error),
    InvalidDate(String),
    MathOverflow,
}

impl std::fmt::Display for ReportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReportError::Database(err) => write!(f, "Database error: {}", err),
            ReportError::InvalidDate(d) => write!(f, "Invalid date: {}", d),
            ReportError::MathOverflow => write!(f, "Math overflow in report computation"),
        }
    }
}

impl std::error::Error for ReportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ReportError::Database(err) => Some(err),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for ReportError {
    fn from(err: rusqlite::Error) -> Self {
        ReportError::Database(err)
    }
}

// ----------------------------------------------------------------------------
// Date & Fiscal Year Helpers
// ----------------------------------------------------------------------------

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn validate_date(date: &str) -> Result<(), ReportError> {
    if date.len() != 10 {
        return Err(ReportError::InvalidDate(date.to_string()));
    }
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return Err(ReportError::InvalidDate(date.to_string()));
    }
    let year: i32 = parts[0]
        .parse()
        .map_err(|_| ReportError::InvalidDate(date.to_string()))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| ReportError::InvalidDate(date.to_string()))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| ReportError::InvalidDate(date.to_string()))?;

    if !(1000..=9999).contains(&year) || !(1..=12).contains(&month) {
        return Err(ReportError::InvalidDate(date.to_string()));
    }

    let max_day = days_in_month(year, month);
    if day < 1 || day > max_day {
        return Err(ReportError::InvalidDate(date.to_string()));
    }

    Ok(())
}

fn parse_fy(fy: &str) -> Result<(i32, i32), ReportError> {
    let parts: Vec<&str> = fy.split('-').collect();
    if parts.len() != 2 {
        return Err(ReportError::InvalidDate(fy.to_string()));
    }
    let start_year: i32 = parts[0]
        .parse()
        .map_err(|_| ReportError::InvalidDate(fy.to_string()))?;
    if !(1000..=9999).contains(&start_year) {
        return Err(ReportError::InvalidDate(fy.to_string()));
    }

    let end_year: i32 = if parts[1].len() == 2 {
        let suffix: i32 = parts[1]
            .parse()
            .map_err(|_| ReportError::InvalidDate(fy.to_string()))?;
        let century = (start_year / 100) * 100;
        let mut ey = century + suffix;
        if ey < start_year {
            ey = ey.checked_add(100).ok_or(ReportError::MathOverflow)?;
        }
        ey
    } else if parts[1].len() == 4 {
        parts[1]
            .parse()
            .map_err(|_| ReportError::InvalidDate(fy.to_string()))?
    } else {
        return Err(ReportError::InvalidDate(fy.to_string()));
    };

    if end_year != start_year + 1 {
        return Err(ReportError::InvalidDate(fy.to_string()));
    }

    Ok((start_year, end_year))
}

// ----------------------------------------------------------------------------
// 1. TRIAL BALANCE
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountBalance {
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub account_type: String,
    pub total_debit_paise: i64,
    pub total_credit_paise: i64,
    pub net_balance_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrialBalanceReport {
    pub accounts: Vec<AccountBalance>,
    pub total_debit_paise: i64,
    pub total_credit_paise: i64,
    pub total_debits_paise: i64,
    pub total_credits_paise: i64,
    pub total_debits: i64,
    pub total_credits: i64,
    pub is_balanced: bool,
}

impl Deref for TrialBalanceReport {
    type Target = [AccountBalance];
    fn deref(&self) -> &Self::Target {
        &self.accounts
    }
}

impl TrialBalanceReport {
    pub fn rows(&self) -> &[AccountBalance] {
        &self.accounts
    }
}

/// Queries `ledger_entries` grouped by `accounts`.
/// Computes total debit, total credit, net balance per account.
/// Calculates grand totals and asserts `is_balanced = (total_debits == total_credits)`.
pub fn get_trial_balance(conn: &Connection) -> Result<TrialBalanceReport, ReportError> {
    let mut stmt = conn.prepare(
        "SELECT
            a.id,
            a.code,
            a.name,
            a.type,
            SUM(l.debit_paise) AS total_debit,
            SUM(l.credit_paise) AS total_credit
         FROM ledger_entries l
         JOIN accounts a ON l.account_id = a.id
         GROUP BY a.id, a.code, a.name, a.type
         ORDER BY a.code ASC",
    )?;

    let mut accounts = Vec::new();
    let mut total_debit_paise: i64 = 0;
    let mut total_credit_paise: i64 = 0;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    })?;

    for r in rows {
        let (id, code, name, acc_type, debit, credit) = r?;
        total_debit_paise = total_debit_paise
            .checked_add(debit)
            .ok_or(ReportError::MathOverflow)?;
        total_credit_paise = total_credit_paise
            .checked_add(credit)
            .ok_or(ReportError::MathOverflow)?;
        let net_balance_paise = debit.checked_sub(credit).ok_or(ReportError::MathOverflow)?;

        accounts.push(AccountBalance {
            account_id: id,
            account_code: code,
            account_name: name,
            account_type: acc_type,
            total_debit_paise: debit,
            total_credit_paise: credit,
            net_balance_paise,
        });
    }

    let is_balanced = total_debit_paise == total_credit_paise;

    Ok(TrialBalanceReport {
        accounts,
        total_debit_paise,
        total_credit_paise,
        total_debits_paise: total_debit_paise,
        total_credits_paise: total_credit_paise,
        total_debits: total_debit_paise,
        total_credits: total_credit_paise,
        is_balanced,
    })
}

// ----------------------------------------------------------------------------
// 2. DAY BOOK
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayBookTransactionEntry {
    pub id: String,
    pub transaction_type: String,
    pub invoice_number: String,
    pub invoice_date: String,
    pub entity_id: String,
    pub entity_name: String,
    pub total_amount_paise: i64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayBookPaymentEntry {
    pub id: String,
    pub payment_number: String,
    pub entity_id: String,
    pub entity_name: String,
    pub entity_type: String,
    pub payment_mode: String,
    pub amount_paise: i64,
    pub reference_number: Option<String>,
    pub created_at: String,
    pub is_receipt: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayBookReport {
    pub date: String,
    pub sales: Vec<DayBookTransactionEntry>,
    pub purchases: Vec<DayBookTransactionEntry>,
    pub credit_notes: Vec<DayBookTransactionEntry>,
    pub debit_notes: Vec<DayBookTransactionEntry>,
    pub payments: Vec<DayBookPaymentEntry>,
    pub transactions: Vec<DayBookTransactionEntry>,
    pub total_sales_paise: i64,
    pub total_purchases_paise: i64,
    pub total_receipts_paise: i64,
    pub total_payments_paise: i64,
    pub total_sales: i64,
    pub total_purchases: i64,
    pub total_receipts: i64,
    pub total_payments: i64,
}

/// Returns all sales, purchases, credit notes, debit notes with `invoice_date = date`.
/// Returns all payments with `date(created_at) = date`.
/// Summarizes total sales, total purchases, total receipts, total payments.
pub fn get_day_book(conn: &Connection, date: &str) -> Result<DayBookReport, ReportError> {
    validate_date(date)?;

    let mut tx_stmt = conn.prepare(
        "SELECT
            t.id,
            t.transaction_type,
            t.invoice_number,
            t.invoice_date,
            t.entity_id,
            e.full_name AS entity_name,
            t.total_amount_paise,
            t.status
         FROM transactions t
         JOIN entities e ON t.entity_id = e.id
         WHERE t.invoice_date = ?1 AND t.status = 'POSTED'
         ORDER BY t.created_at ASC, t.invoice_number ASC",
    )?;

    let mut sales = Vec::new();
    let mut purchases = Vec::new();
    let mut credit_notes = Vec::new();
    let mut debit_notes = Vec::new();
    let mut transactions = Vec::new();

    let mut total_sales_paise: i64 = 0;
    let mut total_purchases_paise: i64 = 0;

    let tx_rows = tx_stmt.query_map(params![date], |row| {
        Ok(DayBookTransactionEntry {
            id: row.get(0)?,
            transaction_type: row.get(1)?,
            invoice_number: row.get(2)?,
            invoice_date: row.get(3)?,
            entity_id: row.get(4)?,
            entity_name: row.get(5)?,
            total_amount_paise: row.get(6)?,
            status: row.get(7)?,
        })
    })?;

    for r in tx_rows {
        let entry = r?;
        match entry.transaction_type.as_str() {
            "SALE" => {
                total_sales_paise = total_sales_paise
                    .checked_add(entry.total_amount_paise)
                    .ok_or(ReportError::MathOverflow)?;
                sales.push(entry.clone());
            }
            "PURCHASE" => {
                total_purchases_paise = total_purchases_paise
                    .checked_add(entry.total_amount_paise)
                    .ok_or(ReportError::MathOverflow)?;
                purchases.push(entry.clone());
            }
            "SALE_RETURN" => {
                credit_notes.push(entry.clone());
            }
            "PURCHASE_RETURN" => {
                debit_notes.push(entry.clone());
            }
            _ => {}
        }
        transactions.push(entry);
    }

    let mut pay_stmt = conn.prepare(
        "SELECT
            p.id,
            p.payment_number,
            p.entity_id,
            e.full_name AS entity_name,
            e.entity_type AS entity_type,
            p.payment_mode,
            p.amount_paise,
            p.reference_number,
            p.created_at
         FROM payments p
         JOIN entities e ON p.entity_id = e.id
         WHERE date(p.created_at) = ?1
         ORDER BY p.created_at ASC, p.payment_number ASC",
    )?;

    let mut payments = Vec::new();
    let mut total_receipts_paise: i64 = 0;
    let mut total_payments_paise: i64 = 0;

    let pay_rows = pay_stmt.query_map(params![date], |row| {
        let id: String = row.get(0)?;
        let payment_number: String = row.get(1)?;
        let entity_id: String = row.get(2)?;
        let entity_name: String = row.get(3)?;
        let entity_type: String = row.get(4)?;
        let payment_mode: String = row.get(5)?;
        let amount_paise: i64 = row.get(6)?;
        let reference_number: Option<String> = row.get(7)?;
        let created_at: String = row.get(8)?;
        let is_receipt = entity_type != "SUPPLIER";

        Ok(DayBookPaymentEntry {
            id,
            payment_number,
            entity_id,
            entity_name,
            entity_type,
            payment_mode,
            amount_paise,
            reference_number,
            created_at,
            is_receipt,
        })
    })?;

    for r in pay_rows {
        let entry = r?;
        if entry.is_receipt {
            total_receipts_paise = total_receipts_paise
                .checked_add(entry.amount_paise)
                .ok_or(ReportError::MathOverflow)?;
        } else {
            total_payments_paise = total_payments_paise
                .checked_add(entry.amount_paise)
                .ok_or(ReportError::MathOverflow)?;
        }
        payments.push(entry);
    }

    Ok(DayBookReport {
        date: date.to_string(),
        sales,
        purchases,
        credit_notes,
        debit_notes,
        payments,
        transactions,
        total_sales_paise,
        total_purchases_paise,
        total_receipts_paise,
        total_payments_paise,
        total_sales: total_sales_paise,
        total_purchases: total_purchases_paise,
        total_receipts: total_receipts_paise,
        total_payments: total_payments_paise,
    })
}

// ----------------------------------------------------------------------------
// 3. GSTR-1 SUMMARY
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gstr1InvoiceEntry {
    pub transaction_id: String,
    pub transaction_type: String,
    pub invoice_number: String,
    pub invoice_date: String,
    pub entity_id: String,
    pub entity_name: String,
    pub gstin: Option<String>,
    pub place_of_supply_state_code: String,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_amount_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Gstr1CategorySummary {
    pub invoices: Vec<Gstr1InvoiceEntry>,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_amount_paise: i64,
    pub total_taxable_paise: i64,
    pub total_cgst_paise: i64,
    pub total_sgst_paise: i64,
    pub total_igst_paise: i64,
}

impl Deref for Gstr1CategorySummary {
    type Target = [Gstr1InvoiceEntry];
    fn deref(&self) -> &Self::Target {
        &self.invoices
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gstr1HsnEntry {
    pub hsn_code: String,
    pub hsn_sac: String,
    pub total_quantity_milli: i64,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub total_taxable_paise: i64,
    pub total_cgst_paise: i64,
    pub total_sgst_paise: i64,
    pub total_igst_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Gstr1Report {
    pub fy: String,
    pub financial_year: String,
    pub month: Option<u32>,
    pub b2b: Gstr1CategorySummary,
    pub b2c_large: Gstr1CategorySummary,
    pub b2c_small: Gstr1CategorySummary,
    pub hsn_summary: Vec<Gstr1HsnEntry>,
    pub hsn_wise_summary: Vec<Gstr1HsnEntry>,
    pub total_taxable_paise: i64,
    pub total_cgst_paise: i64,
    pub total_sgst_paise: i64,
    pub total_igst_paise: i64,
}

fn add_invoice_to_category(
    cat: &mut Gstr1CategorySummary,
    inv: Gstr1InvoiceEntry,
) -> Result<(), ReportError> {
    cat.taxable_paise = cat
        .taxable_paise
        .checked_add(inv.taxable_paise)
        .ok_or(ReportError::MathOverflow)?;
    cat.cgst_paise = cat
        .cgst_paise
        .checked_add(inv.cgst_paise)
        .ok_or(ReportError::MathOverflow)?;
    cat.sgst_paise = cat
        .sgst_paise
        .checked_add(inv.sgst_paise)
        .ok_or(ReportError::MathOverflow)?;
    cat.igst_paise = cat
        .igst_paise
        .checked_add(inv.igst_paise)
        .ok_or(ReportError::MathOverflow)?;
    cat.total_amount_paise = cat
        .total_amount_paise
        .checked_add(inv.total_amount_paise)
        .ok_or(ReportError::MathOverflow)?;

    cat.total_taxable_paise = cat.taxable_paise;
    cat.total_cgst_paise = cat.cgst_paise;
    cat.total_sgst_paise = cat.sgst_paise;
    cat.total_igst_paise = cat.igst_paise;

    cat.invoices.push(inv);
    Ok(())
}

/// Filters transactions for OUTWARD supplies (`SALE` and `SALE_RETURN`).
/// Categorizes into:
/// - B2B: entities with non-empty GSTIN.
/// - B2C Large: inter-state, invoice amount > 250,000 INR (25,000,000 paise), unregistered.
/// - B2C Small: intra-state or inter-state <= 250,000 INR unregistered.
/// - HSN-wise summary: grouped by HSN code, total quantity, taxable, CGST, SGST, IGST.
pub fn get_gstr1_summary(
    conn: &Connection,
    fy: &str,
    month: Option<u32>,
) -> Result<Gstr1Report, ReportError> {
    let (start_year, end_year) = parse_fy(fy)?;

    let (start_date, end_date) = match month {
        Some(m) => {
            if !(1..=12).contains(&m) {
                return Err(ReportError::InvalidDate(format!("Invalid month: {}", m)));
            }
            let cal_year = if m >= 4 { start_year } else { end_year };
            let last_day = days_in_month(cal_year, m);
            (
                format!("{:04}-{:02}-01", cal_year, m),
                format!("{:04}-{:02}-{:02}", cal_year, m, last_day),
            )
        }
        None => (
            format!("{:04}-04-01", start_year),
            format!("{:04}-03-31", end_year),
        ),
    };

    let mut stmt = conn.prepare(
        "SELECT
            t.id,
            t.transaction_type,
            t.invoice_number,
            t.invoice_date,
            t.entity_id,
            e.full_name AS entity_name,
            e.gstin AS gstin,
            t.seller_state_code,
            t.place_of_supply_state_code,
            t.taxable_paise,
            t.cgst_paise,
            t.sgst_paise,
            t.igst_paise,
            t.total_amount_paise
         FROM transactions t
         JOIN entities e ON t.entity_id = e.id
         WHERE t.transaction_type IN ('SALE', 'SALE_RETURN')
           AND t.status = 'POSTED'
           AND t.invoice_date >= ?1
           AND t.invoice_date <= ?2
         ORDER BY t.invoice_date ASC, t.invoice_number ASC",
    )?;

    let mut b2b = Gstr1CategorySummary::default();
    let mut b2c_large = Gstr1CategorySummary::default();
    let mut b2c_small = Gstr1CategorySummary::default();

    let rows = stmt.query_map(params![&start_date, &end_date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, String>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, i64>(9)?,
            row.get::<_, i64>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, i64>(12)?,
            row.get::<_, i64>(13)?,
        ))
    })?;

    for r in rows {
        let (
            tx_id,
            tx_type,
            inv_num,
            inv_date,
            ent_id,
            ent_name,
            gstin,
            seller_state,
            pos_state,
            taxable,
            cgst,
            sgst,
            igst,
            total,
        ) = r?;

        let entry = Gstr1InvoiceEntry {
            transaction_id: tx_id,
            transaction_type: tx_type,
            invoice_number: inv_num,
            invoice_date: inv_date,
            entity_id: ent_id,
            entity_name: ent_name,
            gstin: gstin.clone(),
            place_of_supply_state_code: pos_state.clone(),
            taxable_paise: taxable,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            total_amount_paise: total,
        };

        let has_gstin = gstin
            .as_ref()
            .map(|g| !g.trim().is_empty())
            .unwrap_or(false);

        if has_gstin {
            add_invoice_to_category(&mut b2b, entry)?;
        } else {
            let is_inter_state = seller_state != pos_state;
            if is_inter_state && total > 25_000_000 {
                add_invoice_to_category(&mut b2c_large, entry)?;
            } else {
                add_invoice_to_category(&mut b2c_small, entry)?;
            }
        }
    }

    // HSN-wise summary
    let mut hsn_stmt = conn.prepare(
        "SELECT
            r.hsn_sac AS hsn_code,
            SUM(ti.quantity_milli) AS total_quantity_milli,
            SUM(ti.taxable_paise) AS taxable_paise,
            SUM(ti.cgst_paise) AS cgst_paise,
            SUM(ti.sgst_paise) AS sgst_paise,
            SUM(ti.igst_paise) AS igst_paise
         FROM transaction_items ti
         JOIN transactions t ON ti.transaction_id = t.id
         JOIN resources r ON ti.resource_id = r.id
         WHERE t.transaction_type IN ('SALE', 'SALE_RETURN')
           AND t.status = 'POSTED'
           AND t.invoice_date >= ?1
           AND t.invoice_date <= ?2
         GROUP BY r.hsn_sac
         ORDER BY r.hsn_sac ASC",
    )?;

    let mut hsn_summary = Vec::new();
    let hsn_rows = hsn_stmt.query_map(params![&start_date, &end_date], |row| {
        let hsn: String = row.get(0)?;
        let qty: i64 = row.get(1)?;
        let taxable: i64 = row.get(2)?;
        let cgst: i64 = row.get(3)?;
        let sgst: i64 = row.get(4)?;
        let igst: i64 = row.get(5)?;
        Ok(Gstr1HsnEntry {
            hsn_code: hsn.clone(),
            hsn_sac: hsn,
            total_quantity_milli: qty,
            taxable_paise: taxable,
            cgst_paise: cgst,
            sgst_paise: sgst,
            igst_paise: igst,
            total_taxable_paise: taxable,
            total_cgst_paise: cgst,
            total_sgst_paise: sgst,
            total_igst_paise: igst,
        })
    })?;

    for hr in hsn_rows {
        hsn_summary.push(hr?);
    }

    let total_taxable_paise = b2b
        .taxable_paise
        .checked_add(b2c_large.taxable_paise)
        .and_then(|x| x.checked_add(b2c_small.taxable_paise))
        .ok_or(ReportError::MathOverflow)?;

    let total_cgst_paise = b2b
        .cgst_paise
        .checked_add(b2c_large.cgst_paise)
        .and_then(|x| x.checked_add(b2c_small.cgst_paise))
        .ok_or(ReportError::MathOverflow)?;

    let total_sgst_paise = b2b
        .sgst_paise
        .checked_add(b2c_large.sgst_paise)
        .and_then(|x| x.checked_add(b2c_small.sgst_paise))
        .ok_or(ReportError::MathOverflow)?;

    let total_igst_paise = b2b
        .igst_paise
        .checked_add(b2c_large.igst_paise)
        .and_then(|x| x.checked_add(b2c_small.igst_paise))
        .ok_or(ReportError::MathOverflow)?;

    Ok(Gstr1Report {
        fy: fy.to_string(),
        financial_year: fy.to_string(),
        month,
        b2b,
        b2c_large,
        b2c_small,
        hsn_summary: hsn_summary.clone(),
        hsn_wise_summary: hsn_summary,
        total_taxable_paise,
        total_cgst_paise,
        total_sgst_paise,
        total_igst_paise,
    })
}

// ----------------------------------------------------------------------------
// 4. STOCK SUMMARY
// ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockItemSummary {
    pub sku: String,
    pub sku_or_code: String,
    pub name: String,
    pub batch_number: String,
    pub expiry_date: Option<String>,
    pub current_quantity_milli: i64,
    pub valuation_paise: i64,
    pub cost_price_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StockSummaryReport {
    pub items: Vec<StockItemSummary>,
    pub total_quantity_milli: i64,
    pub total_valuation_paise: i64,
    pub total_valuation: i64,
}

impl Deref for StockSummaryReport {
    type Target = [StockItemSummary];
    fn deref(&self) -> &Self::Target {
        &self.items
    }
}

impl StockSummaryReport {
    pub fn rows(&self) -> &[StockItemSummary] {
        &self.items
    }
}

/// Queries `resources` joined with `resource_lots` and aggregated `stock_movements`.
/// Returns SKU, name, lot batch_number, expiry_date, current_quantity_milli, valuation_paise.
pub fn get_stock_summary(conn: &Connection) -> Result<StockSummaryReport, ReportError> {
    let mut stmt = conn.prepare(
        "SELECT
            r.sku_or_code AS sku,
            r.name AS name,
            rl.batch_number AS batch_number,
            rl.expiry_date AS expiry_date,
            COALESCE(SUM(sm.quantity_delta_milli), 0) AS current_quantity_milli,
            r.cost_price_paise,
            r.base_price_paise
         FROM resources r
         JOIN resource_lots rl ON r.id = rl.resource_id
         LEFT JOIN stock_movements sm ON rl.id = sm.lot_id
         GROUP BY r.id, r.sku_or_code, r.name, rl.id, rl.batch_number, rl.expiry_date, r.cost_price_paise, r.base_price_paise
         ORDER BY r.sku_or_code ASC, rl.batch_number ASC",
    )?;

    let mut items = Vec::new();
    let mut total_quantity_milli: i64 = 0;
    let mut total_valuation_paise: i64 = 0;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })?;

    for r in rows {
        let (sku, name, batch, expiry, qty_milli, cost_paise, base_paise) = r?;

        let unit_cost = if cost_paise > 0 {
            cost_paise
        } else {
            base_paise
        };

        let valuation_paise = if qty_milli <= 0 || unit_cost == 0 {
            0
        } else {
            let q_i128 = qty_milli as i128;
            let p_i128 = unit_cost as i128;
            let mult = q_i128
                .checked_mul(p_i128)
                .ok_or(ReportError::MathOverflow)?;
            let rounded = if mult >= 0 {
                mult.checked_add(500).ok_or(ReportError::MathOverflow)? / 1000
            } else {
                mult.checked_sub(500).ok_or(ReportError::MathOverflow)? / 1000
            };
            i64::try_from(rounded).map_err(|_| ReportError::MathOverflow)?
        };

        total_quantity_milli = total_quantity_milli
            .checked_add(qty_milli)
            .ok_or(ReportError::MathOverflow)?;
        total_valuation_paise = total_valuation_paise
            .checked_add(valuation_paise)
            .ok_or(ReportError::MathOverflow)?;

        items.push(StockItemSummary {
            sku: sku.clone(),
            sku_or_code: sku,
            name,
            batch_number: batch,
            expiry_date: expiry,
            current_quantity_milli: qty_milli,
            valuation_paise,
            cost_price_paise: cost_paise,
        });
    }

    Ok(StockSummaryReport {
        items,
        total_quantity_milli,
        total_valuation_paise,
        total_valuation: total_valuation_paise,
    })
}

// ----------------------------------------------------------------------------
// UNIT TESTS
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::{MIGRATIONS, run_migrations};
    use crate::database::open_connection;
    use crate::posting::{
        LineInput, PaymentAllocationInput, PaymentInput, PaymentMode, PriceMode, SaleInput,
        post_payment, post_sale,
    };

    fn setup_test_environment() -> Connection {
        let mut conn = open_connection(":memory:").expect("Open in-memory db with pragmas");
        run_migrations(&mut conn, MIGRATIONS).expect("Run schema migrations");

        // 1. Business Profile (State 27 - Maharashtra)
        conn.execute(
            "INSERT INTO business_profiles (
                id, legal_name, trade_name, gstin, state_code, phone, email, address_line1, city, postal_code
            ) VALUES (
                'biz_main', 'OmniBill Retail Ltd', 'OmniMart', '27AABCU9603R1ZM', '27',
                '9876543210', 'ops@omnibill.io', '123 Market St', 'Mumbai', '400001'
            )",
            [],
        )
        .expect("Seed business profile");

        // 2. Active User
        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_admin', 'admin', 'hash123', 'Administrator', 'ADMIN')",
            [],
        )
        .expect("Seed user");

        // 3. Entities:
        // (a) B2B Customer (with GSTIN)
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
             VALUES ('ent_b2b', 'CUST-B2B', 'CUSTOMER', 'Acme Enterprises', '9111111111', '27AABCA1234A1Z5', '27')",
            [],
        )
        .expect("Seed B2B entity");

        // (b) Local B2C Customer (intra-state, unregistered)
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
             VALUES ('ent_b2c_local', 'CUST-LOC', 'CUSTOMER', 'Local Shopper', '9222222222', NULL, '27')",
            [],
        )
        .expect("Seed B2C local entity");

        // (c) Inter-state B2C Customer (state 29 - Karnataka, unregistered)
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
             VALUES ('ent_b2c_inter', 'CUST-INTER', 'CUSTOMER', 'Interstate Shopper', '9333333333', NULL, '29')",
            [],
        )
        .expect("Seed B2C interstate entity");

        // (d) Supplier
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, phone, gstin, state_code)
             VALUES ('ent_supp', 'SUPP-001', 'SUPPLIER', 'National Wholesale Ltd', '9444444444', '27SUPPL1234A1Z9', '27')",
            [],
        )
        .expect("Seed supplier entity");

        // 4. Resources:
        // Res 1: Tracked widget (HSN 1234, 18% tax, Cost ₹80.00, Base ₹100.00)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_1', 'SKU-001', 'Widget Standard', '1234', 1800, 10000, 8000, 1)",
            [],
        )
        .expect("Seed resource 1");

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_1', 'res_1', 'BATCH-A1', '2028-12-31', 15000)",
            [],
        )
        .expect("Seed lot 1");

        // Res 2: Tracked gadget (HSN 5678, 12% tax, Cost ₹40.00, Base ₹50.00)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_2', 'SKU-002', 'Gadget Basic', '5678', 1200, 5000, 4000, 1)",
            [],
        )
        .expect("Seed resource 2");

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_2', 'res_2', 'BATCH-B2', '2027-06-30', 7500)",
            [],
        )
        .expect("Seed lot 2");

        // Res 3: High value machinery for B2C Large test (HSN 8471, 18% tax, Cost ₹200,000, Base ₹260,000)
        conn.execute(
            "INSERT INTO resources (id, sku_or_code, name, hsn_sac, tax_rate_bps, base_price_paise, cost_price_paise, is_stock_tracked)
             VALUES ('res_3', 'SKU-HV1', 'High Value Server', '8471', 1800, 26000000, 20000000, 1)",
            [],
        )
        .expect("Seed resource 3");

        conn.execute(
            "INSERT INTO resource_lots (id, resource_id, batch_number, expiry_date, mrp_paise)
             VALUES ('lot_3', 'res_3', 'BATCH-HV1', '2030-01-01', 35000000)",
            [],
        )
        .expect("Seed lot 3");

        // 5. Initial stock movements from supplier purchases:
        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_p1', 'res_1', 'lot_1', NULL, 'PURCHASE', 50000)",
            [],
        )
        .expect("Seed initial stock 1");

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_p2', 'res_2', 'lot_2', NULL, 'PURCHASE', 20000)",
            [],
        )
        .expect("Seed initial stock 2");

        conn.execute(
            "INSERT INTO stock_movements (id, resource_id, lot_id, transaction_id, reason, quantity_delta_milli)
             VALUES ('sm_p3', 'res_3', 'lot_3', NULL, 'PURCHASE', 5000)",
            [],
        )
        .expect("Seed initial stock 3");

        // 6. Record a purchase transaction on 2026-04-15 (debit Inventory, credit Accounts Payable)
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                'tx_purchase_1', 'POSTED', '27', '27', 'PUR/26-27/',
                'PUR/26-27/0001', 'ent_supp', 480000, 0, 480000,
                0, 0, 0, 0, 480000,
                'PURCHASE', NULL, '2026-04-15', 'usr_admin'
            )",
            [],
        )
        .expect("Seed purchase transaction");

        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('le_pur_deb', 'tx_purchase_1', NULL, 'acc_1200', 480000, 0, 'Purchase goods')",
            [],
        )
        .expect("Seed purchase ledger debit");

        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('le_pur_crd', 'tx_purchase_1', NULL, 'acc_2000', 0, 480000, 'Payable to supplier')",
            [],
        )
        .expect("Seed purchase ledger credit");

        conn
    }

    #[test]
    fn test_trial_balance_balanced_ledger() {
        let mut conn = setup_test_environment();

        // 1. Post Sale 1: Local B2C sale on 2026-04-15
        let sale_b2c = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_b2c_local".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 2000, // 2 units
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post B2C sale");

        // 2. Post Customer Payment (Receipt) for Sale 1
        post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_b2c_local".to_string(),
                payment_mode: PaymentMode::Cash,
                amount_paise: sale_b2c.totals.total_amount_paise,
                reference_number: Some("REC-CASH-001".to_string()),
                payment_date: "2026-04-15".to_string(),
                allocations: vec![PaymentAllocationInput {
                    transaction_id: sale_b2c.transaction_id.clone(),
                    amount_paise: sale_b2c.totals.total_amount_paise,
                }],
            },
        )
        .expect("Post customer receipt");

        // 3. Post Supplier Payment (Payout Voucher)
        post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_supp".to_string(),
                payment_mode: PaymentMode::BankTransfer,
                amount_paise: 200000, // ₹2,000 paid to supplier
                reference_number: Some("UTR99887766".to_string()),
                payment_date: "2026-04-15".to_string(),
                allocations: vec![],
            },
        )
        .expect("Post supplier payment");

        // Query Trial Balance
        let tb = get_trial_balance(&conn).expect("Get trial balance");

        // Requirement assertions:
        assert!(tb.is_balanced, "Trial balance MUST be balanced");
        assert_eq!(
            tb.total_debits, tb.total_credits,
            "Total debits must strictly equal total credits"
        );
        assert!(tb.total_debits > 0, "Total debits must be positive");
        assert!(!tb.accounts.is_empty(), "Must have active account rows");

        // Verify each individual account net balance equals debit - credit
        let mut net_sum = 0i64;
        for acc in tb.rows() {
            assert_eq!(
                acc.net_balance_paise,
                acc.total_debit_paise - acc.total_credit_paise,
                "Account {} net balance mismatch",
                acc.account_code
            );
            net_sum += acc.net_balance_paise;
        }
        assert_eq!(net_sum, 0, "Sum of all net balances must be zero");
    }

    #[test]
    fn test_trial_balance_empty_ledger() {
        let mut conn = open_connection(":memory:").expect("Open in-memory db");
        run_migrations(&mut conn, MIGRATIONS).expect("Run migrations");

        let tb = get_trial_balance(&conn).expect("Get trial balance on empty ledger");
        assert!(tb.is_balanced);
        assert_eq!(tb.total_debits, 0);
        assert_eq!(tb.total_credits, 0);
        assert_eq!(tb.accounts.len(), 0);
    }

    #[test]
    fn test_trial_balance_detects_imbalance() {
        let mut conn = open_connection(":memory:").expect("Open in-memory db");
        run_migrations(&mut conn, MIGRATIONS).expect("Run migrations");

        // Insert required user for foreign key
        conn.execute(
            "INSERT INTO users (id, username, password_hash, full_name, role)
             VALUES ('usr_admin', 'admin', 'hash', 'Admin', 'ADMIN')",
            [],
        )
        .unwrap();

        // Insert a dummy entity
        conn.execute(
            "INSERT INTO entities (id, entity_code, entity_type, full_name, state_code)
             VALUES ('ent_tmp', 'TMP', 'CUSTOMER', 'Temp', '27')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                total_amount_paise, transaction_type, invoice_date, created_by_user_id
            ) VALUES (
                'tx_unbalanced', 'POSTED', '27', '27', 'INV/26-27/',
                'INV/26-27/9999', 'ent_tmp', 5000, 0, 5000,
                5000, 'SALE', '2026-04-15', 'usr_admin'
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO ledger_entries (
                id, transaction_id, payment_id, account_id, debit_paise, credit_paise, narration
            ) VALUES ('le_unbal_1', 'tx_unbalanced', NULL, 'acc_1000', 5000, 0, 'Unbalanced debit')",
            [],
        )
        .unwrap();

        let tb = get_trial_balance(&conn).expect("Query TB");
        assert!(!tb.is_balanced, "Must detect imbalance");
        assert_ne!(tb.total_debits, tb.total_credits);
    }

    #[test]
    fn test_day_book_sales_purchases_payments() {
        let mut conn = setup_test_environment();

        // Query today's date from SQLite to align with payments.created_at default (strftime now)
        let today: String = conn
            .query_row("SELECT date('now')", [], |r| r.get(0))
            .expect("Get current date from sqlite");

        // Sale on today's date
        let sale = post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: today.clone(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_b2c_local".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 1000, // 1 unit = ₹100 + 18% tax = ₹118 (11800 paise)
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post sale");

        // Customer receipt on today's date
        post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_b2c_local".to_string(),
                payment_mode: PaymentMode::Cash,
                amount_paise: 11800,
                reference_number: None,
                payment_date: today.clone(),
                allocations: vec![PaymentAllocationInput {
                    transaction_id: sale.transaction_id,
                    amount_paise: 11800,
                }],
            },
        )
        .expect("Post receipt");

        // Supplier payout on today's date
        post_payment(
            &mut conn,
            &PaymentInput {
                entity_id: "ent_supp".to_string(),
                payment_mode: PaymentMode::BankTransfer,
                amount_paise: 50000,
                reference_number: Some("BANK-REF-1".to_string()),
                payment_date: today.clone(),
                allocations: vec![],
            },
        )
        .expect("Post supplier payment");

        // Purchase on today's date
        conn.execute(
            "INSERT INTO transactions (
                id, status, seller_state_code, place_of_supply_state_code, series,
                invoice_number, entity_id, subtotal_paise, discount_paise, taxable_paise,
                cgst_paise, sgst_paise, igst_paise, round_off_paise, total_amount_paise,
                transaction_type, original_transaction_id, invoice_date, created_by_user_id
            ) VALUES (
                'tx_purchase_today', 'POSTED', '27', '27', 'PUR/26-27/',
                'PUR/26-27/0099', 'ent_supp', 200000, 0, 200000,
                0, 0, 0, 0, 200000,
                'PURCHASE', NULL, ?1, 'usr_admin'
            )",
            params![&today],
        )
        .expect("Seed purchase on today's date");

        // Query Day Book for today
        let day_book = get_day_book(&conn, &today).expect("Get Day Book");

        assert_eq!(day_book.date, today);
        assert_eq!(day_book.sales.len(), 1);
        assert_eq!(day_book.purchases.len(), 1);
        assert_eq!(day_book.payments.len(), 2);
        assert_eq!(day_book.transactions.len(), 2); // 1 sale + 1 purchase

        assert_eq!(day_book.total_sales_paise, 11800);
        assert_eq!(day_book.total_purchases_paise, 200000);
        assert_eq!(day_book.total_receipts_paise, 11800);
        assert_eq!(day_book.total_payments_paise, 50000);

        // Aliases
        assert_eq!(day_book.total_sales, 11800);
        assert_eq!(day_book.total_purchases, 200000);
        assert_eq!(day_book.total_receipts, 11800);
        assert_eq!(day_book.total_payments, 50000);

        // Also test historical date with explicitly timestamped payments
        conn.execute(
            "INSERT INTO payments (
                id, payment_number, entity_id, payment_mode, amount_paise,
                reference_number, created_by_user_id, created_at
            ) VALUES (
                'pay_hist', 'PAY/26-27/0999', 'ent_b2c_local', 'CASH', 5000,
                NULL, 'usr_admin', '2026-04-15T12:00:00.000Z'
            )",
            [],
        )
        .unwrap();

        let db_hist = get_day_book(&conn, "2026-04-15").expect("Get historical Day Book");
        assert_eq!(db_hist.purchases.len(), 1); // purchase from setup_test_environment
        assert_eq!(db_hist.payments.len(), 1);
        assert_eq!(db_hist.total_receipts_paise, 5000);
    }

    #[test]
    fn test_day_book_empty_day() {
        let conn = setup_test_environment();
        let day_book = get_day_book(&conn, "2026-04-16").expect("Get Day Book for empty day");

        assert_eq!(day_book.sales.len(), 0);
        assert_eq!(day_book.purchases.len(), 0);
        assert_eq!(day_book.payments.len(), 0);
        assert_eq!(day_book.total_sales_paise, 0);
        assert_eq!(day_book.total_purchases_paise, 0);
        assert_eq!(day_book.total_receipts_paise, 0);
        assert_eq!(day_book.total_payments_paise, 0);
    }

    #[test]
    fn test_day_book_invalid_date_format() {
        let conn = setup_test_environment();
        assert!(matches!(
            get_day_book(&conn, "invalid-date"),
            Err(ReportError::InvalidDate(_))
        ));
        assert!(matches!(
            get_day_book(&conn, "2026-13-01"),
            Err(ReportError::InvalidDate(_))
        ));
        assert!(matches!(
            get_day_book(&conn, "2026-02-30"),
            Err(ReportError::InvalidDate(_))
        ));
    }

    #[test]
    fn test_gstr1_b2b_b2c_large_b2c_small_and_hsn() {
        let mut conn = setup_test_environment();

        // 1. B2B Outward Sale: Customer has GSTIN (27AABCA1234A1Z5)
        // 1 unit of Res 1: Taxable ₹100 (10,000 paise), 18% intra-state (CGST ₹9, SGST ₹9)
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-10".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_b2b".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post B2B sale");

        // 2. B2C Small Sale: Local unregistered customer, intra-state
        // 2 units of Res 2: Taxable ₹100 (10,000 paise), 12% intra-state (CGST ₹6, SGST ₹6)
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-12".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_b2c_local".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_2".to_string(),
                    quantity_milli: 2000,
                    unit_price_paise: 5000,
                    discount_paise: 0,
                    tax_rate_bps: 1200,
                }],
            },
        )
        .expect("Post B2C Small intra-state sale");

        // 3. B2C Small Sale: Inter-state unregistered customer, invoice amount <= ₹250,000 (25,000,000 paise)
        // 1 unit of Res 1: Taxable ₹100 (10,000 paise), 18% inter-state (IGST ₹18 = 1800 paise)
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "29".to_string(),
                customer: Some("ent_b2c_inter".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post B2C Small inter-state sale");

        // 4. B2C Large Sale: Inter-state unregistered customer, invoice amount > ₹250,000
        // 1 unit of Res 3: Taxable ₹260,000 (26,000,000 paise), 18% IGST = ₹46,800 (4,680,000 paise)
        // Total = ₹306,800 (30,680,000 paise) > 25,000,000 paise
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-20".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "29".to_string(),
                customer: Some("ent_b2c_inter".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_3".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 26000000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post B2C Large inter-state sale");

        // 5. Another sale in May 2026 to verify month filtering
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-05-05".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: Some("ent_b2b".to_string()),
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 1000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post May sale");

        // Query GSTR-1 for April 2026 (month = Some(4))
        let april_gstr1 = get_gstr1_summary(&conn, "2026-27", Some(4)).expect("Get April GSTR-1");

        // Verify Categorization
        assert_eq!(april_gstr1.b2b.len(), 1, "April must have 1 B2B invoice");
        assert_eq!(april_gstr1.b2b[0].entity_name, "Acme Enterprises");
        assert_eq!(april_gstr1.b2b.taxable_paise, 10000);
        assert_eq!(april_gstr1.b2b.cgst_paise, 900);
        assert_eq!(april_gstr1.b2b.sgst_paise, 900);
        assert_eq!(april_gstr1.b2b.igst_paise, 0);

        assert_eq!(
            april_gstr1.b2c_small.len(),
            2,
            "April must have 2 B2C Small invoices"
        );
        assert_eq!(
            april_gstr1.b2c_small.taxable_paise, 20000,
            "10000 from local + 10000 from inter"
        );
        assert_eq!(april_gstr1.b2c_small.cgst_paise, 600);
        assert_eq!(april_gstr1.b2c_small.sgst_paise, 600);
        assert_eq!(april_gstr1.b2c_small.igst_paise, 1800);

        assert_eq!(
            april_gstr1.b2c_large.len(),
            1,
            "April must have 1 B2C Large invoice"
        );
        assert_eq!(april_gstr1.b2c_large[0].taxable_paise, 26000000);
        assert_eq!(april_gstr1.b2c_large[0].igst_paise, 4680000);
        assert_eq!(april_gstr1.b2c_large[0].total_amount_paise, 30680000);

        // Verify HSN Summary
        assert_eq!(april_gstr1.hsn_summary.len(), 3);
        let hsn_1234 = april_gstr1
            .hsn_summary
            .iter()
            .find(|h| h.hsn_code == "1234")
            .expect("Find HSN 1234");
        assert_eq!(hsn_1234.total_quantity_milli, 2000); // 1 B2B + 1 B2C inter
        assert_eq!(hsn_1234.taxable_paise, 20000);
        assert_eq!(hsn_1234.cgst_paise, 900);
        assert_eq!(hsn_1234.sgst_paise, 900);
        assert_eq!(hsn_1234.igst_paise, 1800);

        let hsn_8471 = april_gstr1
            .hsn_summary
            .iter()
            .find(|h| h.hsn_code == "8471")
            .expect("Find HSN 8471");
        assert_eq!(hsn_8471.total_quantity_milli, 1000);
        assert_eq!(hsn_8471.taxable_paise, 26000000);
        assert_eq!(hsn_8471.igst_paise, 4680000);

        // Verify May sale is included when querying full FY (month = None)
        let fy_gstr1 = get_gstr1_summary(&conn, "2026-27", None).expect("Get full FY GSTR-1");
        assert_eq!(fy_gstr1.b2b.len(), 2, "Full FY must have 2 B2B invoices");
        assert_eq!(fy_gstr1.b2b.taxable_paise, 20000);
    }

    #[test]
    fn test_gstr1_invalid_dates() {
        let conn = setup_test_environment();
        assert!(matches!(
            get_gstr1_summary(&conn, "2026-29", None),
            Err(ReportError::InvalidDate(_))
        ));
        assert!(matches!(
            get_gstr1_summary(&conn, "2026", None),
            Err(ReportError::InvalidDate(_))
        ));
        assert!(matches!(
            get_gstr1_summary(&conn, "2026-27", Some(13)),
            Err(ReportError::InvalidDate(_))
        ));
        assert!(matches!(
            get_gstr1_summary(&conn, "2026-27", Some(0)),
            Err(ReportError::InvalidDate(_))
        ));
    }

    #[test]
    fn test_stock_summary_lots_and_valuation() {
        let mut conn = setup_test_environment();

        // Initial stock in setup:
        // Res 1 (lot_1): 50,000 milli @ cost ₹80 (8000 paise)
        // Res 2 (lot_2): 20,000 milli @ cost ₹40 (4000 paise)
        // Res 3 (lot_3): 5,000 milli @ cost ₹200,000 (20,000,000 paise)

        // Post a sale consuming 10,000 milli (10 units) of Res 1
        post_sale(
            &mut conn,
            &SaleInput {
                invoice_date: "2026-04-15".to_string(),
                seller_state_code: "27".to_string(),
                place_of_supply_state_code: "27".to_string(),
                customer: None,
                price_mode: PriceMode::Exclusive,
                lines: vec![LineInput {
                    resource_id: "res_1".to_string(),
                    quantity_milli: 10000,
                    unit_price_paise: 10000,
                    discount_paise: 0,
                    tax_rate_bps: 1800,
                }],
            },
        )
        .expect("Post sale for stock reduction");

        // Query Stock Summary
        let stock_report = get_stock_summary(&conn).expect("Get stock summary");

        assert_eq!(stock_report.items.len(), 3);

        // Find Res 1 (lot_1)
        let item_1 = stock_report
            .items
            .iter()
            .find(|i| i.sku == "SKU-001")
            .expect("Find SKU-001");
        assert_eq!(item_1.name, "Widget Standard");
        assert_eq!(item_1.batch_number, "BATCH-A1");
        assert_eq!(item_1.expiry_date.as_deref(), Some("2028-12-31"));
        assert_eq!(item_1.current_quantity_milli, 40000); // 50,000 - 10,000
        // Valuation: (40,000 milli * 8,000 paise) / 1000 = 320,000 paise (₹3,200.00)
        assert_eq!(item_1.valuation_paise, 320000);

        // Find Res 2 (lot_2)
        let item_2 = stock_report
            .items
            .iter()
            .find(|i| i.sku == "SKU-002")
            .expect("Find SKU-002");
        assert_eq!(item_2.name, "Gadget Basic");
        assert_eq!(item_2.batch_number, "BATCH-B2");
        assert_eq!(item_2.expiry_date.as_deref(), Some("2027-06-30"));
        assert_eq!(item_2.current_quantity_milli, 20000);
        // Valuation: (20,000 * 4,000) / 1000 = 80,000 paise (₹800.00)
        assert_eq!(item_2.valuation_paise, 80000);

        // Find Res 3 (lot_3)
        let item_3 = stock_report
            .items
            .iter()
            .find(|i| i.sku == "SKU-HV1")
            .expect("Find SKU-HV1");
        assert_eq!(item_3.current_quantity_milli, 5000);
        // Valuation: (5,000 * 20,000,000) / 1000 = 100,000,000 paise (₹1,000,000.00)
        assert_eq!(item_3.valuation_paise, 100000000);

        // Verify Grand Totals
        assert_eq!(stock_report.total_quantity_milli, 40000 + 20000 + 5000);
        assert_eq!(
            stock_report.total_valuation_paise,
            320000 + 80000 + 100000000
        );
        assert_eq!(
            stock_report.total_valuation,
            stock_report.total_valuation_paise
        );
    }
}
