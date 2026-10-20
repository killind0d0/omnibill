use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

/// Supported thermal paper widths and their character column limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaperWidth {
    /// 58mm thermal paper (32 characters per line)
    Mm58,
    /// 80mm thermal paper (48 characters per line)
    Mm80,
}

#[allow(non_upper_case_globals)]
impl PaperWidth {
    pub const Width58mm: Self = PaperWidth::Mm58;
    pub const Width80mm: Self = PaperWidth::Mm80;
    pub const MM58: Self = PaperWidth::Mm58;
    pub const MM80: Self = PaperWidth::Mm80;
    pub const WIDTH_58MM: Self = PaperWidth::Mm58;
    pub const WIDTH_80MM: Self = PaperWidth::Mm80;

    /// Number of monospaced character columns available for the paper width.
    pub fn columns(&self) -> usize {
        match self {
            PaperWidth::Mm58 => 32,
            PaperWidth::Mm80 => 48,
        }
    }

    /// Helper to resolve paper width from millimeter measurement.
    pub fn from_mm(mm: u32) -> Option<Self> {
        match mm {
            58 => Some(PaperWidth::Mm58),
            80 => Some(PaperWidth::Mm80),
            _ => None,
        }
    }

    /// Helper to resolve paper width from character column count.
    pub fn from_cols(cols: usize) -> Option<Self> {
        match cols {
            32 => Some(PaperWidth::Mm58),
            48 => Some(PaperWidth::Mm80),
            _ => None,
        }
    }
}

/// An individual line item on a thermal receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptItem {
    pub name: String,
    pub quantity_milli: i64,
    pub unit_price_paise: i64,
    pub tax_rate_bps: i64,
    pub line_total_paise: i64,
}

impl ReceiptItem {
    pub fn new(
        name: impl Into<String>,
        quantity_milli: i64,
        unit_price_paise: i64,
        tax_rate_bps: i64,
        line_total_paise: i64,
    ) -> Self {
        Self {
            name: name.into(),
            quantity_milli,
            unit_price_paise,
            tax_rate_bps,
            line_total_paise,
        }
    }
}

/// Tax summary and financial totals for a receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ReceiptTaxSummary {
    pub subtotal_paise: i64,
    pub discount_paise: i64,
    pub taxable_paise: i64,
    pub cgst_paise: i64,
    pub sgst_paise: i64,
    pub igst_paise: i64,
    pub round_off_paise: i64,
    pub total_amount_paise: i64,
}

pub type TaxSummary = ReceiptTaxSummary;

impl ReceiptTaxSummary {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        subtotal_paise: i64,
        discount_paise: i64,
        taxable_paise: i64,
        cgst_paise: i64,
        sgst_paise: i64,
        igst_paise: i64,
        round_off_paise: i64,
        total_amount_paise: i64,
    ) -> Self {
        Self {
            subtotal_paise,
            discount_paise,
            taxable_paise,
            cgst_paise,
            sgst_paise,
            igst_paise,
            round_off_paise,
            total_amount_paise,
        }
    }
}

impl From<crate::posting::PostedSaleTotals> for ReceiptTaxSummary {
    fn from(totals: crate::posting::PostedSaleTotals) -> Self {
        Self {
            subtotal_paise: totals.subtotal_paise,
            discount_paise: totals.discount_paise,
            taxable_paise: totals.taxable_paise,
            cgst_paise: totals.cgst_paise,
            sgst_paise: totals.sgst_paise,
            igst_paise: totals.igst_paise,
            round_off_paise: totals.round_off_paise,
            total_amount_paise: totals.total_amount_paise,
        }
    }
}

/// Complete dataset required to generate a formatted thermal receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptData {
    // Store information
    pub store_name: String,
    pub address: Option<String>,
    pub gstin: Option<String>,
    pub phone: Option<String>,
    pub trade_name: Option<String>,

    // Invoice information
    pub invoice_number: String,
    pub invoice_date: String,
    pub customer_name: Option<String>,
    pub customer_gstin: Option<String>,

    // Items
    pub items: Vec<ReceiptItem>,

    // Tax summary
    pub tax_summary: ReceiptTaxSummary,

    // UPI payment QR code string
    pub upi_qr_string: Option<String>,

    // Footer note / terms
    pub footer_note: Option<String>,
}

impl ReceiptData {
    pub fn new(
        store_name: impl Into<String>,
        invoice_number: impl Into<String>,
        invoice_date: impl Into<String>,
        items: Vec<ReceiptItem>,
        tax_summary: ReceiptTaxSummary,
    ) -> Self {
        Self {
            store_name: store_name.into(),
            address: None,
            gstin: None,
            phone: None,
            trade_name: None,
            invoice_number: invoice_number.into(),
            invoice_date: invoice_date.into(),
            customer_name: None,
            customer_gstin: None,
            items,
            tax_summary,
            upi_qr_string: None,
            footer_note: None,
        }
    }

    pub fn builder() -> ReceiptDataBuilder {
        ReceiptDataBuilder::new()
    }

    pub fn generate_escpos_bytes(&self, width: PaperWidth) -> Vec<u8> {
        generate_escpos_bytes(self, width)
    }

    pub fn store_address(&self) -> Option<&str> {
        self.address.as_deref()
    }

    pub fn store_gstin(&self) -> Option<&str> {
        self.gstin.as_deref()
    }

    pub fn store_phone(&self) -> Option<&str> {
        self.phone.as_deref()
    }

    pub fn footer_terms(&self) -> Option<&str> {
        self.footer_note.as_deref()
    }

    pub fn terms(&self) -> Option<&str> {
        self.footer_note.as_deref()
    }

    pub fn upi_payment_qr(&self) -> Option<&str> {
        self.upi_qr_string.as_deref()
    }

    pub fn subtotal_paise(&self) -> i64 {
        self.tax_summary.subtotal_paise
    }

    pub fn discount_paise(&self) -> i64 {
        self.tax_summary.discount_paise
    }

    pub fn taxable_paise(&self) -> i64 {
        self.tax_summary.taxable_paise
    }

    pub fn cgst_paise(&self) -> i64 {
        self.tax_summary.cgst_paise
    }

    pub fn sgst_paise(&self) -> i64 {
        self.tax_summary.sgst_paise
    }

    pub fn igst_paise(&self) -> i64 {
        self.tax_summary.igst_paise
    }

    pub fn round_off_paise(&self) -> i64 {
        self.tax_summary.round_off_paise
    }

    pub fn total_amount_paise(&self) -> i64 {
        self.tax_summary.total_amount_paise
    }
}

/// Fluent builder for constructing `ReceiptData`.
#[derive(Debug, Default)]
pub struct ReceiptDataBuilder {
    store_name: String,
    address: Option<String>,
    gstin: Option<String>,
    phone: Option<String>,
    trade_name: Option<String>,
    invoice_number: String,
    invoice_date: String,
    customer_name: Option<String>,
    customer_gstin: Option<String>,
    items: Vec<ReceiptItem>,
    tax_summary: ReceiptTaxSummary,
    upi_qr_string: Option<String>,
    footer_note: Option<String>,
}

impl ReceiptDataBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn store_name(mut self, val: impl Into<String>) -> Self {
        self.store_name = val.into();
        self
    }

    pub fn address(mut self, val: impl Into<String>) -> Self {
        self.address = Some(val.into());
        self
    }

    pub fn gstin(mut self, val: impl Into<String>) -> Self {
        self.gstin = Some(val.into());
        self
    }

    pub fn phone(mut self, val: impl Into<String>) -> Self {
        self.phone = Some(val.into());
        self
    }

    pub fn trade_name(mut self, val: impl Into<String>) -> Self {
        self.trade_name = Some(val.into());
        self
    }

    pub fn invoice_number(mut self, val: impl Into<String>) -> Self {
        self.invoice_number = val.into();
        self
    }

    pub fn invoice_date(mut self, val: impl Into<String>) -> Self {
        self.invoice_date = val.into();
        self
    }

    pub fn customer_name(mut self, val: impl Into<String>) -> Self {
        self.customer_name = Some(val.into());
        self
    }

    pub fn customer_gstin(mut self, val: impl Into<String>) -> Self {
        self.customer_gstin = Some(val.into());
        self
    }

    pub fn item(mut self, item: ReceiptItem) -> Self {
        self.items.push(item);
        self
    }

    pub fn items(mut self, items: Vec<ReceiptItem>) -> Self {
        self.items = items;
        self
    }

    pub fn tax_summary(mut self, summary: ReceiptTaxSummary) -> Self {
        self.tax_summary = summary;
        self
    }

    pub fn upi_qr_string(mut self, qr: impl Into<String>) -> Self {
        self.upi_qr_string = Some(qr.into());
        self
    }

    pub fn footer_note(mut self, note: impl Into<String>) -> Self {
        self.footer_note = Some(note.into());
        self
    }

    pub fn footer_terms(mut self, terms: impl Into<String>) -> Self {
        self.footer_note = Some(terms.into());
        self
    }

    pub fn terms(mut self, terms: impl Into<String>) -> Self {
        self.footer_note = Some(terms.into());
        self
    }

    pub fn build(self) -> ReceiptData {
        ReceiptData {
            store_name: self.store_name,
            address: self.address,
            gstin: self.gstin,
            phone: self.phone,
            trade_name: self.trade_name,
            invoice_number: self.invoice_number,
            invoice_date: self.invoice_date,
            customer_name: self.customer_name,
            customer_gstin: self.customer_gstin,
            items: self.items,
            tax_summary: self.tax_summary,
            upi_qr_string: self.upi_qr_string,
            footer_note: self.footer_note,
        }
    }
}

// ==========================================
// ESC/POS Command Byte Constants and Enums
// ==========================================

/// Initialize printer: `\x1b@`
pub const CMD_INIT: &[u8] = b"\x1b@";

/// Align left: `\x1ba\x00`
pub const CMD_ALIGN_LEFT: &[u8] = b"\x1ba\x00";

/// Align center: `\x1ba\x01`
pub const CMD_ALIGN_CENTER: &[u8] = b"\x1ba\x01";

/// Align right: `\x1ba\x02`
pub const CMD_ALIGN_RIGHT: &[u8] = b"\x1ba\x02";

/// Bold text on: `\x1bE\x01`
pub const CMD_BOLD_ON: &[u8] = b"\x1bE\x01";

/// Bold text off: `\x1bE\x00`
pub const CMD_BOLD_OFF: &[u8] = b"\x1bE\x00";

/// Character size: Normal
pub const CMD_DOUBLE_SIZE_OFF: &[u8] = b"\x1d!\x00";

/// Character size: Double-height only
pub const CMD_DOUBLE_HEIGHT_ON: &[u8] = b"\x1d!\x01";

/// Character size: Double-width only
pub const CMD_DOUBLE_WIDTH_ON: &[u8] = b"\x1d!\x10";

/// Character size: Double-height and Double-width
pub const CMD_DOUBLE_SIZE_ON: &[u8] = b"\x1d!\x11";

/// Full paper cut command: `\x1dV\x00`
pub const CMD_CUT_FULL: &[u8] = b"\x1dV\x00";

/// Partial paper cut command: `\x1dV\x01`
pub const CMD_CUT_PARTIAL: &[u8] = b"\x1dV\x01";

/// Cash drawer kick pulse: `\x1bp\x00\x19\xfa`
pub const CMD_DRAWER_KICK: &[u8] = b"\x1bp\x00\x19\xfa";

/// ESC/POS text alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alignment {
    Left,
    Center,
    Right,
}

impl Alignment {
    pub fn to_bytes(&self) -> &'static [u8] {
        match self {
            Alignment::Left => CMD_ALIGN_LEFT,
            Alignment::Center => CMD_ALIGN_CENTER,
            Alignment::Right => CMD_ALIGN_RIGHT,
        }
    }
}

/// ESC/POS text sizing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextSize {
    Normal,
    DoubleHeight,
    DoubleWidth,
    DoubleHeightWidth,
}

impl TextSize {
    pub fn to_bytes(&self) -> &'static [u8] {
        match self {
            TextSize::Normal => CMD_DOUBLE_SIZE_OFF,
            TextSize::DoubleHeight => CMD_DOUBLE_HEIGHT_ON,
            TextSize::DoubleWidth => CMD_DOUBLE_WIDTH_ON,
            TextSize::DoubleHeightWidth => CMD_DOUBLE_SIZE_ON,
        }
    }
}

pub fn init_printer() -> &'static [u8] {
    CMD_INIT
}

pub fn set_alignment(alignment: Alignment) -> &'static [u8] {
    alignment.to_bytes()
}

pub fn set_bold(bold: bool) -> &'static [u8] {
    if bold { CMD_BOLD_ON } else { CMD_BOLD_OFF }
}

pub fn set_text_size(size: TextSize) -> &'static [u8] {
    size.to_bytes()
}

pub fn cut_paper(full: bool) -> &'static [u8] {
    if full { CMD_CUT_FULL } else { CMD_CUT_PARTIAL }
}

pub fn cash_drawer_kick() -> &'static [u8] {
    CMD_DRAWER_KICK
}

/// Generates native ESC/POS QR code command sequence (`GS ( k`).
///
/// Steps:
/// 1. Function 165: Select Model (Model 2) -> `GS ( k 4 0 49 65 50 0`
/// 2. Function 167: Set module size (dots)  -> `GS ( k 3 0 49 67 size`
/// 3. Function 169: Set error correction   -> `GS ( k 3 0 49 69 49` (Level M)
/// 4. Function 180: Store data             -> `GS ( k pL pH 49 80 48 <data>`
/// 5. Function 181: Print symbol data      -> `GS ( k 3 0 49 81 48`
pub fn generate_qr_code_commands(data: &str, module_size: u8) -> Vec<u8> {
    let mut bytes = Vec::new();

    // 1. Function 165: Select Model 2 (0x32)
    bytes.extend_from_slice(&[0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);

    // 2. Function 167: Set module size (dots)
    let size = if module_size == 0 { 4 } else { module_size };
    bytes.extend_from_slice(&[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);

    // 3. Function 169: Select error correction level (0x31 = Level M)
    bytes.extend_from_slice(&[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);

    // 4. Function 180: Store data in symbol storage area
    let payload = data.as_bytes();
    let length = payload.len() + 3;
    let pl = (length & 0xff) as u8;
    let ph = ((length >> 8) & 0xff) as u8;
    bytes.extend_from_slice(&[0x1d, 0x28, 0x6b, pl, ph, 0x31, 0x50, 0x30]);
    bytes.extend_from_slice(payload);

    // 5. Function 181: Print the symbol data
    bytes.extend_from_slice(&[0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);

    bytes
}

// ==========================================
// Formatting Helpers (Integer-exact, No Float)
// ==========================================

/// Formats paise integer into currency string (e.g. 11800 -> "118.00").
pub fn format_paise(paise: i64) -> String {
    let sign = if paise < 0 { "-" } else { "" };
    let abs: u64 = paise.unsigned_abs();
    let rupees = abs / 100;
    let cents = abs % 100;
    format!("{}{}.{:02}", sign, rupees, cents)
}

/// Formats quantity milli integer into string (e.g. 1000 -> "1", 2500 -> "2.5").
pub fn format_quantity_milli(milli: i64) -> String {
    let sign = if milli < 0 { "-" } else { "" };
    let abs: u64 = milli.unsigned_abs();
    let whole = abs / 1000;
    let frac = abs % 1000;
    if frac == 0 {
        format!("{}{}", sign, whole)
    } else if frac.is_multiple_of(100) {
        format!("{}{}.{}", sign, whole, frac / 100)
    } else if frac.is_multiple_of(10) {
        format!("{}{}.{:02}", sign, whole, frac / 10)
    } else {
        format!("{}{}.{:03}", sign, whole, frac)
    }
}

/// Formats two strings on the same line, left and right aligned, padded to width.
/// If the text exceeds the column width, splits cleanly into two lines.
pub fn format_two_column(left: &str, right: &str, width: usize) -> String {
    let left_len = left.chars().count();
    let right_len = right.chars().count();
    if left_len + right_len >= width {
        format!("{}\n{:>width$}", left, right, width = width)
    } else {
        let spaces = width - left_len - right_len;
        format!("{}{:spaces$}{}", left, "", right, spaces = spaces)
    }
}

/// Wraps text cleanly at word boundaries to fit within max_width.
pub fn wrap_text(text: &str, max_width: usize) -> Vec<String> {
    let mut result = Vec::new();
    for raw_line in text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() <= max_width {
            result.push(trimmed.to_string());
        } else {
            let mut current = String::new();
            for word in trimmed.split_whitespace() {
                if current.is_empty() {
                    current.push_str(word);
                } else if current.chars().count() + 1 + word.chars().count() <= max_width {
                    current.push(' ');
                    current.push_str(word);
                } else {
                    result.push(current);
                    current = word.to_string();
                }
            }
            if !current.is_empty() {
                result.push(current);
            }
        }
    }
    result
}

// ==========================================
// Generator & Dispatcher
// ==========================================

/// Generates a complete, ready-to-print ESC/POS byte vector for a receipt.
pub fn generate_escpos_bytes(data: &ReceiptData, width: PaperWidth) -> Vec<u8> {
    let cols = width.columns();
    let mut bytes = Vec::with_capacity(1024);

    // 1. Initialize printer
    bytes.extend_from_slice(CMD_INIT);

    // 2. Header: Store Information (Centered)
    bytes.extend_from_slice(CMD_ALIGN_CENTER);

    // Store Name: Double height & width, bold
    bytes.extend_from_slice(CMD_DOUBLE_SIZE_ON);
    bytes.extend_from_slice(CMD_BOLD_ON);
    bytes.extend_from_slice(data.store_name.as_bytes());
    bytes.push(b'\n');
    bytes.extend_from_slice(CMD_DOUBLE_SIZE_OFF);
    bytes.extend_from_slice(CMD_BOLD_OFF);

    // Trade Name (if present)
    if let Some(ref trade) = data.trade_name {
        bytes.extend_from_slice(trade.as_bytes());
        bytes.push(b'\n');
    }

    // Address (if present)
    if let Some(ref addr) = data.address {
        let lines = wrap_text(addr, cols);
        for line in lines {
            bytes.extend_from_slice(line.as_bytes());
            bytes.push(b'\n');
        }
    }

    // Phone (if present)
    if let Some(ref phone) = data.phone {
        bytes.extend_from_slice(format!("Ph: {}\n", phone).as_bytes());
    }

    // GSTIN (if present)
    if let Some(ref gstin) = data.gstin {
        bytes.extend_from_slice(CMD_BOLD_ON);
        bytes.extend_from_slice(format!("GSTIN: {}\n", gstin).as_bytes());
        bytes.extend_from_slice(CMD_BOLD_OFF);
    }

    // Divider
    bytes.extend_from_slice(CMD_ALIGN_LEFT);
    let divider = "-".repeat(cols) + "\n";
    let double_divider = "=".repeat(cols) + "\n";
    bytes.extend_from_slice(divider.as_bytes());

    // 3. Invoice & Customer details
    match width {
        PaperWidth::Mm80 => {
            let inv_str = format!("Invoice: {}", data.invoice_number);
            let date_str = format!("Date: {}", data.invoice_date);
            bytes.extend_from_slice(
                (format_two_column(&inv_str, &date_str, cols) + "\n").as_bytes(),
            );
        }
        PaperWidth::Mm58 => {
            bytes.extend_from_slice(format!("Invoice: {}\n", data.invoice_number).as_bytes());
            bytes.extend_from_slice(format!("Date: {}\n", data.invoice_date).as_bytes());
        }
    }

    if let Some(ref cust) = data.customer_name {
        bytes.extend_from_slice(format!("Customer: {}\n", cust).as_bytes());
    }
    if let Some(ref cust_gstin) = data.customer_gstin {
        bytes.extend_from_slice(format!("Cust GSTIN: {}\n", cust_gstin).as_bytes());
    }

    bytes.extend_from_slice(divider.as_bytes());

    // 4. Items Table
    match width {
        PaperWidth::Mm80 => {
            bytes.extend_from_slice(CMD_BOLD_ON);
            // 20 + 1 + 6 + 1 + 9 + 1 + 10 = 48 cols
            let header = format!(
                "{:<20} {:>6} {:>9} {:>10}\n",
                "Item", "Qty", "Price", "Total"
            );
            bytes.extend_from_slice(header.as_bytes());
            bytes.extend_from_slice(CMD_BOLD_OFF);
            bytes.extend_from_slice(divider.as_bytes());

            for item in &data.items {
                let qty_str = format_quantity_milli(item.quantity_milli);
                let price_str = format_paise(item.unit_price_paise);
                let total_str = format_paise(item.line_total_paise);

                if item.name.chars().count() <= 20 {
                    let line = format!(
                        "{:<20} {:>6} {:>9} {:>10}\n",
                        item.name, qty_str, price_str, total_str
                    );
                    bytes.extend_from_slice(line.as_bytes());
                } else {
                    bytes.extend_from_slice(format!("{}\n", item.name).as_bytes());
                    let line = format!(
                        "{:<20} {:>6} {:>9} {:>10}\n",
                        "", qty_str, price_str, total_str
                    );
                    bytes.extend_from_slice(line.as_bytes());
                }
            }
        }
        PaperWidth::Mm58 => {
            bytes.extend_from_slice(CMD_BOLD_ON);
            bytes.extend_from_slice(b"Item\n");
            let sub_header = format_two_column("  Qty x Price", "Total", cols) + "\n";
            bytes.extend_from_slice(sub_header.as_bytes());
            bytes.extend_from_slice(CMD_BOLD_OFF);
            bytes.extend_from_slice(divider.as_bytes());

            for item in &data.items {
                let qty_str = format_quantity_milli(item.quantity_milli);
                let price_str = format_paise(item.unit_price_paise);
                let total_str = format_paise(item.line_total_paise);

                let name_lines = wrap_text(&item.name, cols);
                for line in name_lines {
                    bytes.extend_from_slice(line.as_bytes());
                    bytes.push(b'\n');
                }
                let details = format!("  {} x {}", qty_str, price_str);
                let line = format_two_column(&details, &total_str, cols) + "\n";
                bytes.extend_from_slice(line.as_bytes());
            }
        }
    }

    bytes.extend_from_slice(divider.as_bytes());

    // 5. Tax Summary / Totals
    // Subtotal
    bytes.extend_from_slice(
        (format_two_column(
            "Subtotal:",
            &format_paise(data.tax_summary.subtotal_paise),
            cols,
        ) + "\n")
            .as_bytes(),
    );

    // Discount (if > 0)
    if data.tax_summary.discount_paise > 0 {
        let disc_str = format!("-{}", format_paise(data.tax_summary.discount_paise));
        bytes
            .extend_from_slice((format_two_column("Discount:", &disc_str, cols) + "\n").as_bytes());
    }

    // Taxable Value
    bytes.extend_from_slice(
        (format_two_column(
            "Taxable Value:",
            &format_paise(data.tax_summary.taxable_paise),
            cols,
        ) + "\n")
            .as_bytes(),
    );

    // CGST
    if data.tax_summary.cgst_paise > 0 {
        bytes.extend_from_slice(
            (format_two_column("CGST:", &format_paise(data.tax_summary.cgst_paise), cols) + "\n")
                .as_bytes(),
        );
    }

    // SGST
    if data.tax_summary.sgst_paise > 0 {
        bytes.extend_from_slice(
            (format_two_column("SGST:", &format_paise(data.tax_summary.sgst_paise), cols) + "\n")
                .as_bytes(),
        );
    }

    // IGST
    if data.tax_summary.igst_paise > 0 {
        bytes.extend_from_slice(
            (format_two_column("IGST:", &format_paise(data.tax_summary.igst_paise), cols) + "\n")
                .as_bytes(),
        );
    }

    // Round Off (if != 0)
    if data.tax_summary.round_off_paise != 0 {
        bytes.extend_from_slice(
            (format_two_column(
                "Round Off:",
                &format_paise(data.tax_summary.round_off_paise),
                cols,
            ) + "\n")
                .as_bytes(),
        );
    }

    // Total Amount
    bytes.extend_from_slice(double_divider.as_bytes());
    bytes.extend_from_slice(CMD_BOLD_ON);
    let total_str = format!("INR {}", format_paise(data.tax_summary.total_amount_paise));
    bytes.extend_from_slice(
        (format_two_column("TOTAL AMOUNT:", &total_str, cols) + "\n").as_bytes(),
    );
    bytes.extend_from_slice(CMD_BOLD_OFF);
    bytes.extend_from_slice(double_divider.as_bytes());

    // 6. UPI Payment QR code (if present)
    if let Some(ref upi_str) = data.upi_qr_string {
        bytes.push(b'\n');
        bytes.extend_from_slice(CMD_ALIGN_CENTER);
        bytes.extend_from_slice(CMD_BOLD_ON);
        bytes.extend_from_slice(b"Scan & Pay via UPI\n");
        bytes.extend_from_slice(CMD_BOLD_OFF);

        let module_size = match width {
            PaperWidth::Mm58 => 4,
            PaperWidth::Mm80 => 5,
        };
        let qr_cmd = generate_qr_code_commands(upi_str, module_size);
        bytes.extend_from_slice(&qr_cmd);
        bytes.push(b'\n');
        bytes.extend_from_slice(CMD_ALIGN_LEFT);
    }

    // 7. Footer Note / Terms (if present)
    if let Some(ref note) = data.footer_note {
        bytes.push(b'\n');
        bytes.extend_from_slice(CMD_ALIGN_CENTER);
        let note_lines = wrap_text(note, cols);
        for line in note_lines {
            bytes.extend_from_slice(line.as_bytes());
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(CMD_ALIGN_LEFT);
    }

    // 8. Feed and paper cut
    bytes.extend_from_slice(b"\n\n\n\n");
    bytes.extend_from_slice(CMD_CUT_FULL);

    bytes
}

/// Dispatches raw bytes to a target printer device or file path.
///
/// Works with direct device files (e.g. `/dev/usb/lp0`, `/dev/ttyUSB0`)
/// or local receipt spool files.
pub fn print_to_file(path: &str, raw_bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent()
        && !parent.as_os_str().is_empty() && !parent.exists() {
            let _ = std::fs::create_dir_all(parent);
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .map_err(|e| format!("Failed to open printer device/file '{}': {}", path, e))?;

    file.write_all(raw_bytes)
        .map_err(|e| format!("Failed to write to printer device/file '{}': {}", path, e))?;

    file.flush()
        .map_err(|e| format!("Failed to flush printer device/file '{}': {}", path, e))?;

    Ok(())
}

/// Printer dispatcher struct providing convenient associated methods.
pub struct PrinterDispatcher;

impl PrinterDispatcher {
    pub fn print_to_file(path: &str, raw_bytes: &[u8]) -> Result<(), String> {
        print_to_file(path, raw_bytes)
    }

    pub fn generate_escpos_bytes(data: &ReceiptData, width: PaperWidth) -> Vec<u8> {
        generate_escpos_bytes(data, width)
    }

    pub fn kick_cash_drawer(path: &str) -> Result<(), String> {
        print_to_file(path, CMD_DRAWER_KICK)
    }
}

// ==========================================
// Unit Tests
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_receipt() -> ReceiptData {
        ReceiptData::builder()
            .store_name("Fresh Foods Supermarket")
            .trade_name("Fresh Foods Retail")
            .address("123 Market Road, Indiranagar, Bangalore - 560038")
            .phone("+91 98765 43210")
            .gstin("29ABCDE1234F1Z5")
            .invoice_number("INV-2026-0001")
            .invoice_date("2026-10-20")
            .customer_name("Rahul Sharma")
            .customer_gstin("29XYZPA5678B1Z2")
            .item(ReceiptItem::new(
                "Aashirvaad Atta 5kg",
                1000,
                27500,
                500,
                27500,
            ))
            .item(ReceiptItem::new(
                "Amul Butter 500g",
                2000,
                25000,
                1200,
                50000,
            ))
            .tax_summary(ReceiptTaxSummary::new(
                77500, 2500, 75000, 4500, 4500, 0, 0, 84000,
            ))
            .upi_qr_string("upi://pay?pa=freshfoods@upi&pn=FreshFoods&am=840.00&cu=INR")
            .footer_note("Thank you for shopping with us! No returns on perishable items.")
            .build()
    }

    #[test]
    fn test_58mm_receipt_generation() {
        let receipt = sample_receipt();
        let bytes = generate_escpos_bytes(&receipt, PaperWidth::Mm58);

        // 1. Initializer command \x1b@
        assert!(
            bytes.starts_with(CMD_INIT),
            "Output must start with ESC @ printer initialization"
        );

        // 2. Paper cut command \x1dV\x00 at the end
        assert!(
            bytes.ends_with(CMD_CUT_FULL),
            "Output must end with full cut command GS V 0"
        );

        let text = String::from_utf8_lossy(&bytes);

        // 3. Header fields
        assert!(
            text.contains("Fresh Foods Supermarket"),
            "Must contain store name"
        );
        assert!(
            text.contains("Fresh Foods Retail"),
            "Must contain trade name"
        );
        assert!(text.contains("Market Road"), "Must contain store address");
        assert!(text.contains("+91 98765 43210"), "Must contain store phone");
        assert!(text.contains("29ABCDE1234F1Z5"), "Must contain store GSTIN");

        // 4. Invoice & customer
        assert!(
            text.contains("INV-2026-0001"),
            "Must contain invoice number"
        );
        assert!(text.contains("2026-10-20"), "Must contain invoice date");
        assert!(text.contains("Rahul Sharma"), "Must contain customer name");
        assert!(
            text.contains("29XYZPA5678B1Z2"),
            "Must contain customer GSTIN"
        );

        // 5. Items
        assert!(text.contains("Aashirvaad Atta 5kg"), "Must contain item 1");
        assert!(text.contains("Amul Butter 500g"), "Must contain item 2");
        assert!(text.contains("275.00"), "Must contain item 1 rate/total");
        assert!(text.contains("500.00"), "Must contain item 2 total");

        // 6. Totals
        assert!(text.contains("Subtotal:"), "Must contain Subtotal label");
        assert!(text.contains("775.00"), "Must contain subtotal amount");
        assert!(text.contains("Discount:"), "Must contain Discount label");
        assert!(text.contains("-25.00"), "Must contain discount amount");
        assert!(
            text.contains("Taxable Value:"),
            "Must contain Taxable Value label"
        );
        assert!(text.contains("750.00"), "Must contain taxable amount");
        assert!(text.contains("CGST:"), "Must contain CGST label");
        assert!(text.contains("45.00"), "Must contain CGST amount");
        assert!(text.contains("SGST:"), "Must contain SGST label");
        assert!(
            text.contains("TOTAL AMOUNT:"),
            "Must contain TOTAL AMOUNT label"
        );
        assert!(text.contains("840.00"), "Must contain total amount");

        // 7. UPI QR label and Footer
        assert!(
            text.contains("Scan & Pay via UPI"),
            "Must contain UPI prompt"
        );
        assert!(
            text.contains("Thank you for shopping with us!"),
            "Must contain footer terms"
        );

        // 8. ESC/POS command sequences verification
        assert!(
            bytes
                .windows(CMD_ALIGN_CENTER.len())
                .any(|w| w == CMD_ALIGN_CENTER),
            "Must contain center alignment command"
        );
        assert!(
            bytes
                .windows(CMD_ALIGN_LEFT.len())
                .any(|w| w == CMD_ALIGN_LEFT),
            "Must contain left alignment command"
        );
        assert!(
            bytes.windows(CMD_BOLD_ON.len()).any(|w| w == CMD_BOLD_ON),
            "Must contain bold on command"
        );
        assert!(
            bytes.windows(CMD_BOLD_OFF.len()).any(|w| w == CMD_BOLD_OFF),
            "Must contain bold off command"
        );
        assert!(
            bytes
                .windows(CMD_DOUBLE_SIZE_ON.len())
                .any(|w| w == CMD_DOUBLE_SIZE_ON),
            "Must contain double size on command"
        );
        assert!(
            bytes
                .windows(CMD_DOUBLE_SIZE_OFF.len())
                .any(|w| w == CMD_DOUBLE_SIZE_OFF),
            "Must contain double size off command"
        );

        // 9. QR code command sequence verification (GS ( k)
        assert!(
            bytes.windows(3).any(|w| w == [0x1d, 0x28, 0x6b]),
            "Must contain native QR code command GS ( k"
        );
    }

    #[test]
    fn test_80mm_receipt_formatting() {
        let receipt = sample_receipt();
        let bytes = generate_escpos_bytes(&receipt, PaperWidth::Mm80);

        // Verify start and end
        assert!(bytes.starts_with(CMD_INIT));
        assert!(bytes.ends_with(CMD_CUT_FULL));

        let text = String::from_utf8_lossy(&bytes);

        // Verify 80mm divider lines (48 characters)
        let divider_48 = "-".repeat(48);
        let double_divider_48 = "=".repeat(48);
        assert!(
            text.contains(&divider_48),
            "80mm receipt must have 48-char divider"
        );
        assert!(
            text.contains(&double_divider_48),
            "80mm receipt must have 48-char double divider"
        );

        // Verify 80mm table header layout: "Item                 Qty     Price      Total"
        assert!(text.contains("Item"), "80mm must contain Item header");
        assert!(text.contains("Qty"), "80mm must contain Qty header");
        assert!(text.contains("Price"), "80mm must contain Price header");
        assert!(text.contains("Total"), "80mm must contain Total header");

        // Verify items and totals formatted
        assert!(text.contains("Aashirvaad Atta 5kg"));
        assert!(text.contains("Amul Butter 500g"));
        assert!(text.contains("INR 840.00"));

        // Verify invoice and date fit in 48-col two-column line
        assert!(text.contains("Invoice: INV-2026-0001"));
        assert!(text.contains("Date: 2026-10-20"));
    }

    #[test]
    fn test_qr_code_generation() {
        let payload = "upi://pay?pa=store@upi&pn=StoreName&am=118.00&cu=INR";
        let module_size = 4;
        let qr_bytes = generate_qr_code_commands(payload, module_size);

        // 1. Function 165: Model selection (Model 2)
        // GS ( k \x04\x00\x31\x41\x32\x00
        let expected_fn165 = [0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00];
        assert!(
            qr_bytes
                .windows(expected_fn165.len())
                .any(|w| w == expected_fn165),
            "QR command stream must contain Function 165 (Model 2)"
        );

        // 2. Function 167: Module size
        // GS ( k \x03\x00\x31\x43\x04
        let expected_fn167 = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, module_size];
        assert!(
            qr_bytes
                .windows(expected_fn167.len())
                .any(|w| w == expected_fn167),
            "QR command stream must contain Function 167 (Module size)"
        );

        // 3. Function 169: Error correction Level M
        // GS ( k \x03\x00\x31\x45\x31
        let expected_fn169 = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31];
        assert!(
            qr_bytes
                .windows(expected_fn169.len())
                .any(|w| w == expected_fn169),
            "QR command stream must contain Function 169 (Error correction Level M)"
        );

        // 4. Function 180: Store data
        let length = payload.len() + 3;
        let pl = (length & 0xff) as u8;
        let ph = ((length >> 8) & 0xff) as u8;
        let expected_fn180_prefix = [0x1d, 0x28, 0x6b, pl, ph, 0x31, 0x50, 0x30];
        assert!(
            qr_bytes
                .windows(expected_fn180_prefix.len())
                .any(|w| w == expected_fn180_prefix),
            "QR command stream must contain Function 180 header with correct length"
        );
        assert!(
            qr_bytes
                .windows(payload.len())
                .any(|w| w == payload.as_bytes()),
            "QR command stream must contain the exact payload string bytes"
        );

        // 5. Function 181: Print symbol
        let expected_fn181 = [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30];
        assert!(
            qr_bytes
                .windows(expected_fn181.len())
                .any(|w| w == expected_fn181),
            "QR command stream must contain Function 181 (Print symbol)"
        );
    }

    #[test]
    fn test_cash_drawer_kick_command() {
        let kick = cash_drawer_kick();
        assert_eq!(kick, &[0x1b, 0x70, 0x00, 0x19, 0xfa]);
        assert_eq!(CMD_DRAWER_KICK, &[0x1b, 0x70, 0x00, 0x19, 0xfa]);
    }

    #[test]
    fn test_paper_width_columns() {
        assert_eq!(PaperWidth::Mm58.columns(), 32);
        assert_eq!(PaperWidth::Mm80.columns(), 48);
        assert_eq!(PaperWidth::Width58mm.columns(), 32);
        assert_eq!(PaperWidth::Width80mm.columns(), 48);
        assert_eq!(PaperWidth::from_mm(58), Some(PaperWidth::Mm58));
        assert_eq!(PaperWidth::from_mm(80), Some(PaperWidth::Mm80));
        assert_eq!(PaperWidth::from_mm(100), None);
        assert_eq!(PaperWidth::from_cols(32), Some(PaperWidth::Mm58));
        assert_eq!(PaperWidth::from_cols(48), Some(PaperWidth::Mm80));
        assert_eq!(PaperWidth::from_cols(40), None);
    }

    #[test]
    fn test_formatting_helpers() {
        assert_eq!(format_paise(0), "0.00");
        assert_eq!(format_paise(50), "0.50");
        assert_eq!(format_paise(100), "1.00");
        assert_eq!(format_paise(11800), "118.00");
        assert_eq!(format_paise(-10), "-0.10");

        assert_eq!(format_quantity_milli(1000), "1");
        assert_eq!(format_quantity_milli(2500), "2.5");
        assert_eq!(format_quantity_milli(2250), "2.25");
        assert_eq!(format_quantity_milli(1125), "1.125");
        assert_eq!(format_quantity_milli(0), "0");

        let two_col_32 = format_two_column("Subtotal:", "100.00", 32);
        assert_eq!(two_col_32.chars().count(), 32);
        assert!(two_col_32.starts_with("Subtotal:"));
        assert!(two_col_32.ends_with("100.00"));

        let two_col_48 = format_two_column("Subtotal:", "100.00", 48);
        assert_eq!(two_col_48.chars().count(), 48);
        assert!(two_col_48.starts_with("Subtotal:"));
        assert!(two_col_48.ends_with("100.00"));

        let long_line = format_two_column("Very Long Description That Exceeds Width", "500.00", 32);
        assert!(long_line.contains('\n'));
    }

    #[test]
    fn test_print_to_file() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("omnibill_test_print.bin");
        let path_str = file_path.to_str().expect("valid temp path");

        let test_bytes = vec![0x1b, 0x40, b'H', b'e', b'l', b'l', b'o', 0x1d, 0x56, 0x00];
        let result = print_to_file(path_str, &test_bytes);
        assert!(result.is_ok(), "print_to_file should succeed");

        let read_bytes = std::fs::read(&file_path).expect("file should be readable");
        assert_eq!(read_bytes, test_bytes);

        // Also test PrinterDispatcher wrapper
        let disp_result = PrinterDispatcher::print_to_file(path_str, &test_bytes);
        assert!(disp_result.is_ok());

        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn test_minimal_receipt() {
        let minimal = ReceiptData::new(
            "Corner Kiosk",
            "INV-001",
            "2026-10-20",
            vec![ReceiptItem::new("Matchbox", 1000, 200, 0, 200)],
            ReceiptTaxSummary::new(200, 0, 200, 0, 0, 0, 0, 200),
        );

        let bytes_58 = generate_escpos_bytes(&minimal, PaperWidth::Mm58);
        assert!(bytes_58.starts_with(CMD_INIT));
        assert!(bytes_58.ends_with(CMD_CUT_FULL));

        let text = String::from_utf8_lossy(&bytes_58);
        assert!(text.contains("Corner Kiosk"));
        assert!(text.contains("INV-001"));
        assert!(text.contains("Matchbox"));
        assert!(text.contains("2.00"));
        // Does not contain absent optional fields
        assert!(!text.contains("Cust GSTIN"));
        assert!(!text.contains("Scan & Pay via UPI"));

        let bytes_80 = generate_escpos_bytes(&minimal, PaperWidth::Mm80);
        assert!(bytes_80.starts_with(CMD_INIT));
        assert!(bytes_80.ends_with(CMD_CUT_FULL));
    }

    #[test]
    fn test_interstate_tax_and_round_off() {
        let receipt = ReceiptData::builder()
            .store_name("Interstate Electronics")
            .invoice_number("INV-IS-101")
            .invoice_date("2026-10-20")
            .item(ReceiptItem::new("USB Cable", 1000, 10000, 1800, 10000))
            .tax_summary(ReceiptTaxSummary::new(
                10000, 0, 10000, 0, 0, 1800, -10, 11790,
            ))
            .build();

        let bytes = generate_escpos_bytes(&receipt, PaperWidth::Mm80);
        let text = String::from_utf8_lossy(&bytes);

        // IGST should be present, CGST/SGST omitted since 0
        assert!(text.contains("IGST:"), "Should include IGST");
        assert!(text.contains("18.00"), "Should include IGST amount 18.00");
        assert!(!text.contains("CGST:"), "CGST should be omitted when 0");
        assert!(!text.contains("SGST:"), "SGST should be omitted when 0");
        assert!(text.contains("Round Off:"), "Should include Round Off");
        assert!(
            text.contains("-0.10"),
            "Should format negative round off as -0.10"
        );
        assert!(text.contains("117.90"), "Should include final total 117.90");
    }

    #[test]
    fn test_conversions_and_methods() {
        let totals = crate::posting::PostedSaleTotals {
            subtotal_paise: 10000,
            discount_paise: 500,
            taxable_paise: 9500,
            cgst_paise: 855,
            sgst_paise: 855,
            igst_paise: 0,
            round_off_paise: -10,
            total_amount_paise: 11200,
        };

        let summary = ReceiptTaxSummary::from(totals);
        assert_eq!(summary.subtotal_paise, 10000);
        assert_eq!(summary.discount_paise, 500);
        assert_eq!(summary.taxable_paise, 9500);
        assert_eq!(summary.cgst_paise, 855);
        assert_eq!(summary.sgst_paise, 855);
        assert_eq!(summary.igst_paise, 0);
        assert_eq!(summary.round_off_paise, -10);
        assert_eq!(summary.total_amount_paise, 11200);

        let data = ReceiptData::new("Store", "INV", "2026", vec![], summary);
        assert_eq!(data.subtotal_paise(), 10000);
        assert_eq!(data.discount_paise(), 500);
        assert_eq!(data.taxable_paise(), 9500);
        assert_eq!(data.cgst_paise(), 855);
        assert_eq!(data.sgst_paise(), 855);
        assert_eq!(data.igst_paise(), 0);
        assert_eq!(data.round_off_paise(), -10);
        assert_eq!(data.total_amount_paise(), 11200);

        let bytes = data.generate_escpos_bytes(PaperWidth::Mm58);
        assert!(!bytes.is_empty());

        let disp_bytes = PrinterDispatcher::generate_escpos_bytes(&data, PaperWidth::Mm58);
        assert_eq!(bytes, disp_bytes);

        assert_eq!(set_alignment(Alignment::Left), CMD_ALIGN_LEFT);
        assert_eq!(set_alignment(Alignment::Center), CMD_ALIGN_CENTER);
        assert_eq!(set_alignment(Alignment::Right), CMD_ALIGN_RIGHT);
        assert_eq!(set_bold(true), CMD_BOLD_ON);
        assert_eq!(set_bold(false), CMD_BOLD_OFF);
        assert_eq!(set_text_size(TextSize::Normal), CMD_DOUBLE_SIZE_OFF);
        assert_eq!(set_text_size(TextSize::DoubleHeight), CMD_DOUBLE_HEIGHT_ON);
        assert_eq!(set_text_size(TextSize::DoubleWidth), CMD_DOUBLE_WIDTH_ON);
        assert_eq!(
            set_text_size(TextSize::DoubleHeightWidth),
            CMD_DOUBLE_SIZE_ON
        );
        assert_eq!(cut_paper(true), CMD_CUT_FULL);
        assert_eq!(cut_paper(false), CMD_CUT_PARTIAL);
        assert_eq!(init_printer(), CMD_INIT);
    }
}
