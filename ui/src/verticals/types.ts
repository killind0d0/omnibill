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
  payment_terms_days?: number; // e.g. 15, 30, 45 days
  pan?: string;
  contact_person?: string;
  billing_address?: string;
  shipping_address?: string;
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

// Class Fee Rule Preset (Class Summary)
export interface ClassFeeRule {
  class_name: string;
  tuition_paise: number;
  computer_lab_paise: number;
  sports_activity_paise: number;
  exam_paise: number;
  transport_paise: number;
  total_monthly_paise: number;
}

// Class-Wise AND Month-Wise Fee Rule Preset (Specific to every Month)
export interface MonthlyClassFeeRule {
  class_name: string;
  month: string; // 'Apr' | 'May' | 'Jun' | 'Jul' | 'Aug' | 'Sep' | 'Oct' | 'Nov' | 'Dec' | 'Jan' | 'Feb' | 'Mar'
  tuition_paise: number;
  computer_lab_paise: number;
  sports_activity_paise: number;
  exam_paise: number;
  transport_paise: number;
  annual_charge_paise: number;
  total_paise: number;
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
  blood_group?: string; // e.g. "O+", "A+", "B+", "AB-"
  diagnosis?: string;
  dues_balance_paise?: number;
  last_visit_date?: string;
  emergency_contact?: string;
  ipd_admitted?: boolean;
}

// Doctor Consultation & Department Fee Preset
export interface DoctorConsultationRule {
  id: string;
  doctor_name: string;
  degree: string;
  specialization: string;
  department: string;
  opd_fee_paise: number;
  emergency_fee_paise: number;
  follow_up_fee_paise: number;
  room_no: string;
}

// Hospital Bed & Room Category Rule
export interface BedCategoryRule {
  id: string;
  category_name: string;
  room_type: 'GENERAL_WARD' | 'SEMI_PRIVATE' | 'DELUXE_PRIVATE' | 'ICU' | 'NICU';
  daily_bed_rate_paise: number;
  daily_nursing_paise: number;
  total_daily_paise: number;
  description: string;
}

// Hospital Diagnostic Test Master
export interface DiagnosticTestItem {
  id: string;
  test_code: string;
  test_name: string;
  department: 'PATHOLOGY' | 'RADIOLOGY' | 'CARDIOLOGY' | 'BIOCHEMISTRY' | 'MICROBIOLOGY';
  fee_paise: number;
  sample_type: string;
  turnaround_hours: number;
}

// Hospital Medical Pharmacy & Consumables Stock Item
export interface HospitalMedicalStockItem {
  id: string;
  item_code: string;
  name: string;
  category: 'INJECTIONS' | 'IV_FLUIDS' | 'ANTIBIOTICS' | 'CONSUMABLES' | 'SURGICAL' | 'MEDICINES';
  unit: string;
  current_stock: number;
  cost_price_paise: number; // Purchase Rate
  billing_rate_paise: number; // Patient Billing Rate
  batch_no: string;
  expiry_date: string;
  reorder_level: number;
}

// Hospital Expense & Operational Voucher
export interface HospitalExpense {
  id: string;
  date: string;
  payee: string;
  category: 'OXYGEN_CYLINDERS' | 'BIOMEDICAL_WASTE' | 'SURGICAL_DISPOSABLES' | 'PHARMACY_RESTOCK' | 'DOCTOR_PAYOUTS' | 'UTILITIES' | 'HOUSEKEEPING' | 'MAINTENANCE';
  amount_paise: number;
  payment_mode: PaymentMode;
  voucher_no: string;
  remarks?: string;
}

// Hospital Medical Receipt & Watermark Settings
export interface HospitalReceiptSettings {
  hospital_name: string;
  registration_number: string;
  nabh_accreditation_no: string;
  address: string;
  phone: string;
  emergency_helpline: string;
  email: string;
  logo_url: string;
  show_watermark: boolean;
  watermark_text: string;
  watermark_opacity: number;
  paper_size: '80MM' | 'A4';
  show_doctor_signature: boolean;
  discharge_instructions: string;
  terms_conditions: string;
}

// Hospital Bill Payment Record
export interface HospitalBillPaymentRecord {
  id: string;
  receipt_no: string;
  date: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  opd_no: string;
  doctor_name: string;
  department: string;
  bill_type: 'OPD_CONSULT' | 'PHARMACY_DISPENSE' | 'DIAGNOSTICS' | 'IPD_DISCHARGE' | 'COMPOSITE';
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  net_paid_paise: number;
  payment_mode: PaymentMode;
  transaction_ref: string;
  staff_name: string;
  remarks?: string;
}

// Wholesale Volume Pricing Rule
export interface WholesalePricingRule {
  id: string;
  category: string;
  tier_a_discount_bps: number; // e.g. 500 = 5% for orders > 50 units
  tier_b_discount_bps: number; // e.g. 800 = 8% for orders > 200 units
  min_bulk_units: number;
  payment_credit_days: number;
}

// Wholesale Inventory Stock Item
export interface WholesaleStockItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  purchase_rate_paise: number; // Inward Purchase Rate (Cost)
  wholesale_rate_paise: number; // Outward B2B Rate (Selling)
  mrp_paise: number;
  reorder_level: number;
}

// Wholesale Logistics & Distribution Expense
export interface WholesaleExpense {
  id: string;
  date: string;
  payee: string;
  category: 'FREIGHT_LOGISTICS' | 'DIESEL_FLEET' | 'WAREHOUSE_RENT' | 'PALLET_PACKAGING' | 'LOADING_LABOUR' | 'TOLL_CHARGES' | 'UTILITIES' | 'MISCELLANEOUS';
  amount_paise: number;
  payment_mode: PaymentMode;
  voucher_no: string;
  remarks?: string;
}

// Wholesale Tax Invoice & Watermark Settings
export interface WholesaleInvoiceSettings {
  company_name: string;
  trade_name: string;
  gstin: string;
  pan: string;
  cin_no?: string;
  address: string;
  phone: string;
  email: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  branch: string;
  upi_id: string;
  logo_url: string;
  show_watermark: boolean;
  watermark_text: string;
  watermark_opacity: number;
  declaration: string;
  terms_conditions: string;
  show_authorised_signatory: boolean;
}

// Wholesale B2B Invoice Audit Record
export interface WholesaleInvoiceRecord {
  id: string;
  invoice_number: string;
  date: string;
  customer_id: string;
  customer_name: string;
  customer_gstin: string;
  state_code: string;
  is_interstate: boolean;
  subtotal_paise: number;
  discount_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  eway_bill_no?: string;
  vehicle_number?: string;
  payment_mode: PaymentMode;
  payment_status: 'PAID' | 'CREDIT' | 'PARTIAL';
  due_date: string;
  staff_name: string;
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

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'CREDIT';

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
