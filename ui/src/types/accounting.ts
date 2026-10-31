export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type EntityType = 'CUSTOMER' | 'SUPPLIER' | 'PATIENT' | 'STUDENT';
export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
export type VoucherType = 'SALE' | 'PURCHASE' | 'PAYMENT' | 'RECEIPT' | 'SALE_RETURN' | 'PURCHASE_RETURN' | 'JOURNAL';

export interface ResourceLot {
  id: string;
  resource_id: string;
  batch_number: string;
  expiry_date: string; // YYYY-MM-DD
  mrp_paise: number;
  cost_price_paise: number;
  current_stock_milli: number;
  created_at: string;
}

export interface ResourceItem {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  hsn_sac: string;
  tax_rate_bps: number; // 0, 500, 1200, 1800, 2800
  base_price_paise: number;
  cost_price_paise: number;
  unit: string;
  is_stock_tracked: boolean;
  reorder_level_milli: number;
  category: string;
  lots: ResourceLot[];
  created_at: string;
}

export interface Entity {
  id: string;
  entity_code: string;
  entity_type: EntityType;
  full_name: string;
  phone: string;
  email?: string;
  gstin?: string;
  state_code: string;
  address?: string;
  opening_balance_paise: number; // + for debit (receivable), - for credit (payable)
  current_balance_paise: number;
  is_active: boolean;
  created_at: string;
}

export interface LedgerStatementRow {
  id: string;
  entity_id: string;
  date: string; // YYYY-MM-DD
  voucher_number: string;
  voucher_type: VoucherType;
  narration: string;
  debit_paise: number; // Customer sale / Supplier payment
  credit_paise: number; // Customer payment receipt / Supplier bill
  running_balance_paise: number;
  payment_mode?: PaymentMode;
  reference_no?: string;
}

export interface TrialBalanceAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit_paise: number;
  credit_paise: number;
  net_balance_paise: number; // positive = debit normal, negative = credit normal
}

export interface DayBookEntry {
  id: string;
  time: string;
  date: string; // YYYY-MM-DD
  voucher_number: string;
  type: VoucherType;
  party_name: string;
  party_id?: string;
  narration: string;
  payment_mode: PaymentMode | 'CREDIT';
  inflow_paise: number; // receipts or cash sales
  outflow_paise: number; // payments or cash purchases
  tax_paise: number;
  net_amount_paise: number;
}

export interface DayBookSummary {
  date: string;
  total_sales_paise: number;
  total_purchases_paise: number;
  total_receipts_paise: number;
  total_payments_paise: number;
  net_cash_flow_paise: number;
  entry_count: number;
}

export interface Gstr1B2BInvoice {
  id: string;
  gstin: string;
  recipient_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_value_paise: number;
  pos_state_code: string;
  reverse_charge: 'Y' | 'N';
  taxable_value_paise: number;
  tax_rate_bps: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
}

export interface Gstr1B2CEntry {
  id: string;
  type: 'B2C_LARGE' | 'B2C_SMALL';
  pos_state_code: string;
  tax_rate_bps: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  invoice_count: number;
}

export interface Gstr1HsnSummary {
  hsn_sac: string;
  description: string;
  uqc: string;
  total_quantity_milli: number;
  total_value_paise: number;
  taxable_value_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
}

export interface StockValuationItem {
  resource_id: string;
  sku: string;
  name: string;
  hsn_sac: string;
  category: string;
  unit: string;
  total_stock_milli: number;
  cost_price_paise: number;
  base_price_paise: number;
  valuation_cost_paise: number;
  valuation_retail_paise: number;
  reorder_threshold_milli: number;
  is_low_stock: boolean;
  lots: ResourceLot[];
}

export interface RecordPaymentPayload {
  entity_id: string;
  amount_paise: number;
  payment_mode: PaymentMode;
  date: string;
  reference_number?: string;
  narration: string;
  allocated_voucher_no?: string;
}

export interface PeriodLockState {
  lock_date: string | null; // YYYY-MM-DD
  locked_by: string;
  locked_at: string;
  reason: string;
  audit_history?: Array<{
    action: 'LOCK' | 'UNLOCK';
    lock_date: string | null;
    user: string;
    timestamp: string;
    reason: string;
  }>;
}

export interface Gstr3BTable31 {
  taxable_paise: number;
  igst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  cess_paise: number;
}

export interface Gstr3BReport {
  period: string; // YYYY-MM
  outward_taxable: Gstr3BTable31; // 3.1(a)
  outward_zero_rated: Gstr3BTable31; // 3.1(b)
  outward_nil_exempt: Gstr3BTable31; // 3.1(c)
  inward_rcm: Gstr3BTable31; // 3.1(d)
  non_gst_outward: Gstr3BTable31; // 3.1(e)
  itc_available: {
    import_goods: Gstr3BTable31;
    import_services: Gstr3BTable31;
    inward_rcm: Gstr3BTable31;
    inward_isd: Gstr3BTable31;
    all_other_itc: Gstr3BTable31;
  };
  itc_reversed: {
    rule_42_43: Gstr3BTable31;
    others: Gstr3BTable31;
  };
  net_itc_available: Gstr3BTable31;
  gl_reconciliation: {
    gl_output_cgst_paise: number;
    gl_output_sgst_paise: number;
    gl_output_igst_paise: number;
    gstr3b_output_cgst_paise: number;
    gstr3b_output_sgst_paise: number;
    gstr3b_output_igst_paise: number;
    discrepancy_output_paise: number;
    gl_itc_paise: number;
    gstr3b_itc_paise: number;
    discrepancy_itc_paise: number;
    is_tied_to_gl: boolean;
  };
}

export interface BankVoucherItem {
  id: string;
  voucher_number: string;
  date: string;
  party_name: string;
  type: 'PAYMENT' | 'RECEIPT' | 'CONTRA';
  amount_paise: number;
  narration: string;
  is_cleared: boolean;
  cleared_date?: string;
  reference_no?: string;
}

export interface BrsSummary {
  bank_account_id: string;
  bank_account_name: string;
  statement_date: string;
  balance_per_books_paise: number;
  unpresented_cheques_paise: number; // Add: Payments issued not yet cleared
  uncleared_deposits_paise: number; // Less: Receipts/Deposits not yet cleared
  balance_per_bank_statement_paise: number;
  reconciled_count: number;
  pending_count: number;
}

export interface FinancialStatements {
  trading: {
    gross_sales_paise: number;
    sales_returns_paise: number;
    net_sales_revenue_paise: number;
    cogs_paise: number;
    gross_profit_paise: number;
    gross_margin_bps: number;
  };
  pnl: {
    gross_profit_paise: number;
    operating_expenses_paise: number;
    other_income_paise: number;
    net_profit_paise: number;
    net_margin_bps: number;
  };
  balance_sheet: {
    current_assets_paise: number;
    fixed_assets_paise: number;
    total_assets_paise: number;
    current_liabilities_paise: number;
    total_liabilities_paise: number;
    capital_paise: number;
    retained_earnings_paise: number;
    current_net_profit_paise: number;
    total_equity_paise: number;
    total_liabilities_and_equity_paise: number;
    is_balanced: boolean;
    difference_paise: number;
  };
}

export interface StocktakeItem {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  book_stock_milli: number;
  physical_stock_milli: number;
  unit_cost_paise: number;
  variance_milli: number;
  variance_value_paise: number;
  status: 'MATCHED' | 'SHORTAGE' | 'SURPLUS';
}

export interface StocktakeSummary {
  freeze_timestamp: string;
  total_skus: number;
  matched_skus: number;
  variance_skus: number;
  total_shortage_paise: number;
  total_surplus_paise: number;
  net_variance_paise: number;
}

export interface CustomerLoyalty {
  phone: string;
  name?: string;
  points_balance: number;
  tier: 'SILVER' | 'GOLD' | 'PLATINUM';
  total_spent_paise: number;
  updated_at: string;
}

export interface AuditChainStatus {
  is_valid: boolean;
  total_records: number;
  last_hash: string;
  broken_index?: number;
  failure_reason?: string;
}

