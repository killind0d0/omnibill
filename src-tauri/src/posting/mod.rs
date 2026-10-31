pub mod payment;
pub mod purchase;
pub mod returns;
pub mod sale;
pub mod series;
pub mod tax;

pub use payment::{PaymentAllocationInput, PaymentInput, PaymentMode, PostedPayment, post_payment};
pub use purchase::{PostedPurchase, PurchaseInput, PurchaseLineInput, post_purchase};
pub use returns::{
    PostedReturn, PurchaseReturnInput, ReturnLineInput, SaleReturnInput, post_purchase_return,
    post_sale_return,
};
pub use sale::{post_sale, post_sale_with_payments};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PriceMode {
    #[serde(alias = "Exclusive", alias = "exclusive")]
    Exclusive,
    #[serde(alias = "Inclusive", alias = "inclusive")]
    Inclusive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LineInput {
    pub resource_id: String,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub discount_paise: i64,
    pub tax_rate_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaleInput {
    pub invoice_date: String,
    pub seller_state_code: String,
    pub place_of_supply_state_code: String,
    pub customer: Option<String>,
    pub price_mode: PriceMode,
    pub lines: Vec<LineInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedSaleTotals {
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub round_off_paise: i64,
    pub total_amount_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedSale {
    pub transaction_id: String,
    pub invoice_number: String,
    pub totals: PostedSaleTotals,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentTenderInput {
    pub mode: payment::PaymentMode,
    pub amount_paise: i64,
    pub reference_number: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SaleWithPaymentsInput {
    pub sale: SaleInput,
    pub payments: Vec<PaymentTenderInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostedSaleWithPayments {
    pub sale: PostedSale,
    pub payment_ids: Vec<String>,
}

#[derive(Debug)]
pub enum PostingError {
    Database(rusqlite::Error),
    InsecureConnection {
        recursive_triggers: i64,
        foreign_keys: i64,
    },
    EmptyLines,
    InvalidQuantity(i64),
    InvalidUnitPrice(i64),
    InvalidDiscount {
        discount_paise: i64,
        gross_paise: i64,
    },
    InvalidTaxRate(i64),
    MathOverflow,
    DivisionByZero,
    InvalidDateFormat(String),
    InvoiceNumberExceedsLimit(String),
    ResourceNotFound(String),
    InsufficientStock {
        resource_id: String,
        requested_milli: i64,
        available_milli: i64,
    },
    ActiveSeriesNotFound {
        series_code: String,
        financial_year: String,
    },
    InvalidAmount(i64),
    EntityNotFound(String),
    TransactionNotFound(String),
    AllocationExceedsPayment {
        allocated_paise: i64,
        payment_paise: i64,
    },
    InvalidOriginalTransaction(String),
    ReturnQuantityExceedsOriginal {
        resource_id: String,
        requested_milli: i64,
        available_milli: i64,
    },
    AllocationExceedsInvoiceBalance {
        transaction_id: String,
        allocated_paise: i64,
        unpaid_balance_paise: i64,
    },
    UnbalancedLedger {
        debit_paise: i64,
        credit_paise: i64,
    },
    PaymentMismatch {
        total_amount_paise: i64,
        tendered_paise: i64,
    },
    PeriodLocked {
        invoice_date: String,
        lock_date: String,
    },
}

impl std::fmt::Display for PostingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PostingError::Database(err) => write!(f, "Database error: {}", err),
            PostingError::InsecureConnection {
                recursive_triggers,
                foreign_keys,
            } => write!(
                f,
                "Insecure connection pragmas: recursive_triggers={}, foreign_keys={}",
                recursive_triggers, foreign_keys
            ),
            PostingError::EmptyLines => write!(f, "Sale must have at least one line"),
            PostingError::InvalidQuantity(q) => {
                write!(f, "Invalid quantity: {} (must be > 0)", q)
            }
            PostingError::InvalidUnitPrice(p) => {
                write!(f, "Invalid unit price: {} (must be >= 0)", p)
            }
            PostingError::InvalidDiscount {
                discount_paise,
                gross_paise,
            } => write!(
                f,
                "Invalid discount: {} (gross is {})",
                discount_paise, gross_paise
            ),
            PostingError::InvalidTaxRate(r) => {
                write!(f, "Invalid tax rate: {} bps (must be 0..=10000)", r)
            }
            PostingError::MathOverflow => write!(f, "Arithmetic overflow in posting calculation"),
            PostingError::DivisionByZero => write!(f, "Division by zero in posting calculation"),
            PostingError::InvalidDateFormat(d) => {
                write!(f, "Invalid date format: '{}' (expected YYYY-MM-DD)", d)
            }
            PostingError::InvoiceNumberExceedsLimit(n) => {
                write!(f, "Invoice number '{}' exceeds 16 character limit", n)
            }
            PostingError::ResourceNotFound(id) => write!(f, "Resource '{}' not found", id),
            PostingError::InsufficientStock {
                resource_id,
                requested_milli,
                available_milli,
            } => write!(
                f,
                "Insufficient stock for resource '{}': requested {}, available {}",
                resource_id, requested_milli, available_milli
            ),
            PostingError::ActiveSeriesNotFound {
                series_code,
                financial_year,
            } => write!(
                f,
                "Active number series not found for series '{}' and FY '{}'",
                series_code, financial_year
            ),
            PostingError::InvalidAmount(a) => {
                write!(f, "Invalid amount: {} paise (must be > 0)", a)
            }
            PostingError::EntityNotFound(e) => write!(f, "Entity '{}' not found", e),
            PostingError::TransactionNotFound(t) => write!(f, "Transaction '{}' not found", t),
            PostingError::AllocationExceedsPayment {
                allocated_paise,
                payment_paise,
            } => write!(
                f,
                "Total allocated amount ({} paise) exceeds payment amount ({} paise)",
                allocated_paise, payment_paise
            ),
            PostingError::InvalidOriginalTransaction(msg) => {
                write!(f, "Invalid original transaction: {}", msg)
            }
            PostingError::ReturnQuantityExceedsOriginal {
                resource_id,
                requested_milli,
                available_milli,
            } => write!(
                f,
                "Return quantity for resource '{}' ({} milli) exceeds available original quantity ({} milli)",
                resource_id, requested_milli, available_milli
            ),
            PostingError::AllocationExceedsInvoiceBalance {
                transaction_id,
                allocated_paise,
                unpaid_balance_paise,
            } => write!(
                f,
                "Payment allocation ({} paise) exceeds unpaid invoice balance ({} paise) for transaction '{}'",
                allocated_paise, unpaid_balance_paise, transaction_id
            ),
            PostingError::UnbalancedLedger {
                debit_paise,
                credit_paise,
            } => write!(
                f,
                "Ledger entries do not balance: total debits = {} paise, total credits = {} paise",
                debit_paise, credit_paise
            ),
            PostingError::PaymentMismatch {
                total_amount_paise,
                tendered_paise,
            } => write!(
                f,
                "Payment tender total ({} paise) does not match invoice total ({} paise)",
                tendered_paise, total_amount_paise
            ),
            PostingError::PeriodLocked {
                invoice_date,
                lock_date,
            } => write!(
                f,
                "Period is locked: Transaction date '{}' falls into closed accounting period locked up to '{}'",
                invoice_date, lock_date
            ),
        }
    }
}

pub fn check_period_lock(conn: &rusqlite::Connection, tx_date: &str) -> Result<(), PostingError> {
    if tx_date.is_empty() {
        return Ok(());
    }
    let lock_query: Result<Option<String>, rusqlite::Error> = conn.query_row(
        "SELECT val FROM app_shared_kv WHERE key LIKE '%period_lock%' ORDER BY updated_at DESC LIMIT 1",
        [],
        |r| r.get(0),
    );

    if let Ok(Some(lock_json)) = lock_query {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&lock_json) {
            if let Some(lock_date) = val.get("lock_date").and_then(|v| v.as_str()) {
                let check_date = if tx_date.len() >= 10 { &tx_date[..10] } else { tx_date };
                let closed_date = if lock_date.len() >= 10 { &lock_date[..10] } else { lock_date };
                if !closed_date.is_empty() && check_date <= closed_date {
                    return Err(PostingError::PeriodLocked {
                        invoice_date: tx_date.to_string(),
                        lock_date: lock_date.to_string(),
                    });
                }
            }
        }
    }
    Ok(())
}

impl std::error::Error for PostingError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            PostingError::Database(err) => Some(err),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for PostingError {
    fn from(err: rusqlite::Error) -> Self {
        PostingError::Database(err)
    }
}
