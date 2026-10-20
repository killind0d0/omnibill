pub mod sale;
pub mod series;
pub mod tax;

pub use sale::post_sale;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriceMode {
    Exclusive,
    Inclusive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineInput {
    pub resource_id: String,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub discount_paise: i64,
    pub tax_rate_bps: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SaleInput {
    pub invoice_date: String,
    pub seller_state_code: String,
    pub place_of_supply_state_code: String,
    pub customer: Option<String>,
    pub price_mode: PriceMode,
    pub lines: Vec<LineInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostedSale {
    pub transaction_id: String,
    pub invoice_number: String,
    pub totals: PostedSaleTotals,
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
        }
    }
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
