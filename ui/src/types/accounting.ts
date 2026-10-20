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
