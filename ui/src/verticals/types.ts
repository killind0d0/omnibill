// ui/src/verticals/types.ts
// Domain types for OmniBill ERP 4 Industry Verticals

export type VerticalMode = 'RETAIL' | 'WHOLESALE' | 'SCHOOL' | 'HOSPITAL';

export type EntityType = 'CUSTOMER' | 'SUPPLIER' | 'PATIENT' | 'STUDENT';

// ----------------------------------------------------------------------------
// 1. ENTITY DEFINITIONS
// ----------------------------------------------------------------------------

export interface BaseEntity {
  id: string;
  entity_code: string;
  entity_type: EntityType;
  full_name: string;
  phone?: string;
  email?: string;
  state_code: string;
  is_active: boolean;
  created_at?: string;
}

// B2B Wholesale Customer
export interface WholesaleCustomer extends BaseEntity {
  entity_type: 'CUSTOMER';
  trade_name?: string;
  gstin?: string;
  credit_limit_paise: number; // e.g. 20000000 = ₹2,00,000.00
  current_balance_paise: number; // outstanding dues in paise
  address_line1?: string;
  city?: string;
  pincode?: string;
}

// School Student
export interface StudentEntity extends BaseEntity {
  entity_type: 'STUDENT';
  roll_no: string;
  class_name: string; // e.g. "Class 10"
  section: string; // e.g. "A"
  academic_year: string; // e.g. "2026-2027"
  guardian_name: string;
  guardian_phone: string;
  admission_no: string;
  dues_balance_paise: number;
  address?: string;
  dob?: string;
  concession_category?: string;
  paid_months?: string[];
  monthly_fee_paise?: number;
}

// Class Fee Rule Preset
export interface ClassFeeRule {
  class_name: string;
  tuition_paise: number;
  computer_lab_paise: number;
  sports_activity_paise: number;
  exam_paise: number;
  transport_paise: number;
  total_monthly_paise: number;
}

// School Expense Record
export interface SchoolExpense {
  id: string;
  date: string;
  category: 'SALARIES' | 'UTILITIES' | 'MAINTENANCE' | 'LAB_SUPPLIES' | 'BOOKS_STATIONERY' | 'EVENTS' | 'MISC';
  payee_name: string;
  amount_paise: number;
  payment_mode: PaymentMode;
  voucher_no: string;
  remarks: string;
  created_by_staff: string;
}

// School Receipt Customization Settings
export interface SchoolReceiptSettings {
  school_name: string;
  affiliation_details: string;
  school_address: string;
  phone: string;
  email: string;
  receipt_title: string;
  receipt_terms: string;
  staff_signatory_title: string;
  watermark_enabled: boolean;
  watermark_text: string;
  watermark_opacity: number;
  watermark_angle_deg: number;
  logo_enabled: boolean;
  logo_preset: 'SHIELD' | 'TORCH' | 'CREST' | 'CUSTOM';
  custom_logo_url?: string;
  logo_size_px: number;
  logo_alignment: 'LEFT' | 'CENTER';
}

// School Fee Payment Audit Record
export interface SchoolFeePaymentRecord {
  id: string;
  receipt_no: string;
  date: string;
  time: string;
  student_id: string;
  admission_no: string;
  student_name: string;
  class_name: string;
  section: string;
  academic_year: string;
  months_paid: string[];
  fee_heads: Array<{ name: string; amount_paise: number }>;
  subtotal_paise: number;
  concession_type: string;
  concession_paise: number;
  net_amount_paise: number;
  payment_mode: PaymentMode;
  transaction_ref: string;
  staff_name: string;
  remarks?: string;
}

// Hospital Patient
export interface PatientEntity extends BaseEntity {
  entity_type: 'PATIENT';
  uhid: string; // Unique Health ID e.g. "UHID-2026-8812"
  opd_no: string; // e.g. "OPD-10492"
  age: number;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  doctor_name: string;
  department: string; // e.g. "General Medicine", "Cardiology"
  room_bed_no?: string; // e.g. "ICU-02", "General Ward Bed 14"
  admission_date?: string;
}

// ----------------------------------------------------------------------------
// 2. RESOURCE & LOT DEFINITIONS
// ----------------------------------------------------------------------------

export interface ResourceLot {
  id: string;
  resource_id: string;
  batch_number: string;
  expiry_date: string; // YYYY-MM-DD
  mrp_paise: number;
  stock_milli: number; // available lot stock
}

export interface ResourceItem {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  hsn_sac: string;
  tax_rate_bps: number; // 1800 = 18%, 500 = 5%, 0 = 0%
  base_price_paise: number;
  cost_price_paise?: number;
  mrp_paise?: number;
  unit: string;
  is_stock_tracked: boolean;
  category?: string;
  lots?: ResourceLot[];
}

// ----------------------------------------------------------------------------
// 3. VERTICAL-SPECIFIC LINE ITEMS & METADATA
// ----------------------------------------------------------------------------

export interface VerticalCartLine {
  id: string; // unique frontend line key
  resource_id: string;
  sku: string;
  barcode?: string;
  name: string;
  hsn_sac: string;
  unit: string;
  tax_rate_bps: number;
  quantity_milli: number; // 1000 = 1.000
  unit_price_paise: number;
  mrp_paise?: number;
  discount_paise: number;
  lot_id?: string;
  batch_number?: string;
  expiry_date?: string;

  // Hospital-specific line properties
  dosage_instructions?: string; // e.g. "1-0-1 After Food"
  days_count?: number; // for room/bed day charges

  // School-specific line properties
  fee_head_category?: 'Tuition' | 'Transport' | 'Examination' | 'Lab' | 'Sports' | 'Library' | 'Admission';
  term_name?: string; // e.g. "Term 1 (Apr-Jun)"

  // Computed values
  gross_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  line_total_paise: number;
}

// Wholesale e-Way Bill Metadata
export interface EWayBillDetails {
  distance_km: number;
  transporter_id: string; // 15-char GSTIN or Transporter ID
  transporter_name: string;
  transporter_doc_no: string; // LR / RR / Consignment note no
  vehicle_number: string; // e.g. "DL-01-AB-1234"
  eway_bill_no?: string;
  supply_type: 'Outward - Supply' | 'Outward - Export' | 'Outward - Job Work';
}

// Hospital Billing Specifics
export interface HospitalBillMeta {
  patient_id: string;
  uhid: string;
  opd_no: string;
  patient_name: string;
  age: number;
  gender: string;
  doctor_name: string;
  department: string;
  room_bed_no?: string;
  admission_date?: string;
  discharge_date?: string;
  days_stayed?: number;
  bed_rate_paise?: number;
  consultation_fee_paise?: number;
  pharmacy_total_paise?: number;
  bed_charges_total_paise?: number;
}

// School Billing Specifics
export interface SchoolFeeMeta {
  student_id: string;
  roll_no: string;
  student_name: string;
  class_name: string;
  section: string;
  academic_year: string;
  guardian_name: string;
  guardian_phone: string;
  term_name: string;
  concession_reason?: string;
  concession_amount_paise?: number;
}

// ----------------------------------------------------------------------------
// 4. TRANSACTION & PAYMENT PAYLOADS
// ----------------------------------------------------------------------------

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';

export interface PaymentDetails {
  mode: PaymentMode;
  amount_tendered_paise: number;
  cash_tendered_paise?: number;
  change_due_paise: number;
  reference_number?: string; // UPI txn ref, Cheque No, Bank Ref
  bank_name?: string;
}

export interface DocumentTotals {
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_amount_paise: number;
}

export interface PostedTransactionReceipt {
  transaction_id: string;
  invoice_number: string;
  series: string;
  invoice_date: string;
  invoice_time: string;
  vertical_mode: VerticalMode;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  entity_details: any;
  lines: VerticalCartLine[];
  totals: DocumentTotals;
  payment: PaymentDetails;
  eway_bill?: EWayBillDetails;
  notes?: string;
  created_at: string;
}
