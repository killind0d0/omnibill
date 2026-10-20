export type PriceMode = 'EXCLUSIVE' | 'INCLUSIVE';

export interface ResourceItem {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  hsn: string;
  unit: string;
  tax_rate_bps: number; // e.g. 1800 = 18%, 500 = 5%, 0 = 0%, 1200 = 12%, 2800 = 28%
  base_price_paise: number; // Price in paise (e.g. 10000 = ₹100.00)
  cost_price_paise: number;
  stock_milli: number; // in milli-units (e.g. 50000 = 50.000 items)
}

export interface CartLineItem {
  id: string; // unique row id
  resource_id: string;
  sku: string;
  barcode: string;
  name: string;
  hsn: string;
  unit: string;
  quantity_milli: number; // integer milli-units (1000 = 1.000)
  unit_price_paise: number; // integer paise
  discount_paise: number; // integer paise
  tax_rate_bps: number; // integer basis points
  
  // Computed fields (mirroring tax.rs)
  gross_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
}

export interface ComputedDocumentTotals {
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_amount_paise: number;
}

export interface TaxComputation {
  lines: CartLineItem[];
  totals: ComputedDocumentTotals;
}

export interface BusinessProfile {
  id: string;
  legal_name: string;
  trade_name: string;
  gstin: string;
  state_code: string;
  phone: string;
  email: string;
  address_line1: string;
  city: string;
  postal_code: string;
  upi_vpa: string;
}

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'SPLIT' | 'CREDIT';

export interface PaymentDetails {
  mode: PaymentMode;
  amount_tendered_paise: number;
  cash_tendered_paise?: number;
  upi_amount_paise?: number;
  card_amount_paise?: number;
  change_due_paise: number;
  reference_number?: string;
}

export interface CompletedSale {
  transaction_id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_time: string;
  seller_state_code: string;
  place_of_supply_state_code: string;
  customer_name?: string;
  customer_phone?: string;
  price_mode: PriceMode;
  lines: CartLineItem[];
  totals: ComputedDocumentTotals;
  payment: PaymentDetails;
  business: BusinessProfile;
}
