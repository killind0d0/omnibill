// ui/src/verticals/ipc.ts
// Central State & IPC Bridge for OmniBill ERP Industry Verticals

import {
  VerticalMode,
  EntityType,
  WholesaleCustomer,
  StudentEntity,
  PatientEntity,
  ResourceItem,
  PostedTransactionReceipt,
  VerticalCartLine,
  DocumentTotals,
  PaymentDetails,
  EWayBillDetails,
} from './types';
import { getDbPath } from '../lib/api';

// Detect whether running in Tauri desktop runtime
declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

const isTauri = (): boolean => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

// ----------------------------------------------------------------------------
// SEED DATA FOR DEMO & IN-MEMORY SQLITE EMULATION
// ----------------------------------------------------------------------------

export const SEEDED_CUSTOMERS: WholesaleCustomer[] = [
  {
    id: 'ent_b2b_001',
    entity_code: 'CUST-B2B-01',
    entity_type: 'CUSTOMER',
    full_name: 'Metro MegaMart Distributors Pvt Ltd',
    trade_name: 'Metro MegaMart',
    gstin: '27AABCU9603R1ZM',
    phone: '+91 98200 12345',
    email: 'accounts@metromegamart.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 25000000, // ₹2,50,000.00
    current_balance_paise: 18500000, // ₹1,85,000.00
    address_line1: 'Plot 44, MIDC Industrial Area, Andheri East',
    city: 'Mumbai',
    pincode: '400093',
  },
  {
    id: 'ent_b2b_002',
    entity_code: 'CUST-B2B-02',
    entity_type: 'CUSTOMER',
    full_name: 'Apex Supermarket & Traders',
    trade_name: 'Apex Traders',
    gstin: '27AADCA3412B1Z8',
    phone: '+91 94220 56789',
    email: 'billing@apextraders.in',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 10000000, // ₹1,00,000.00
    current_balance_paise: 9200000, // ₹92,000.00 (Near limit!)
    address_line1: 'Shop 12-14, Commercial Market, Shivaji Chowk',
    city: 'Pune',
    pincode: '411001',
  },
  {
    id: 'ent_b2b_003',
    entity_code: 'CUST-B2B-03',
    entity_type: 'CUSTOMER',
    full_name: 'Bharat Wholesale Agencies',
    trade_name: 'Bharat Agencies',
    gstin: '07AAAAA0000A1Z5', // Delhi (Inter-state for Maharashtra seller)
    phone: '+91 98110 99887',
    email: 'info@bharatwholesale.com',
    state_code: '07', // Delhi
    is_active: true,
    credit_limit_paise: 50000000, // ₹5,00,000.00
    current_balance_paise: 12000000, // ₹1,20,000.00
    address_line1: 'B-88, Okhla Industrial Area Phase 1',
    city: 'New Delhi',
    pincode: '110020',
  },
];

export const SEEDED_STUDENTS: StudentEntity[] = [
  {
    id: 'ent_std_001',
    entity_code: 'STD-2026-101',
    entity_type: 'STUDENT',
    full_name: 'Aarav Rajesh Sharma',
    roll_no: '10-A-04',
    class_name: 'Class 10',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Rajesh Sharma',
    guardian_phone: '+91 98201 11223',
    admission_no: 'ADM-2020-044',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 1720000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul'],
    monthly_fee_paise: 860000,
    address: 'Flat 402, Green Valley Apartments, MG Road, Pune',
  },
  {
    id: 'ent_std_002',
    entity_code: 'STD-2026-102',
    entity_type: 'STUDENT',
    full_name: 'Ananya Vikrant Deshmukh',
    roll_no: '08-B-18',
    class_name: 'Class 8',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Vikrant Deshmukh',
    guardian_phone: '+91 98765 43210',
    admission_no: 'ADM-2022-119',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 2760000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 690000,
    address: 'Bunglow 12, Shivaji Nagar, Pune',
  },
  {
    id: 'ent_std_003',
    entity_code: 'STD-2026-103',
    entity_type: 'STUDENT',
    full_name: 'Rohan Sunil Verma',
    roll_no: '12-SCI-09',
    class_name: 'Class 12',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Sunil Verma',
    guardian_phone: '+91 93214 88776',
    admission_no: 'ADM-2018-002',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 0,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 1120000,
    address: 'Plot 88, Model Colony, Pune',
  },
  {
    id: 'ent_std_004',
    entity_code: 'STD-2026-104',
    entity_type: 'STUDENT',
    full_name: 'Priya Manish Kapoor',
    roll_no: '05-A-12',
    class_name: 'Class 5',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Manish Kapoor',
    guardian_phone: '+91 98111 22334',
    admission_no: 'ADM-2024-055',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 0,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 600000,
    address: 'Row House 4, Kothrud, Pune',
  },
  {
    id: 'ent_std_005',
    entity_code: 'STD-2026-105',
    entity_type: 'STUDENT',
    full_name: 'Kabir Devendra Nair',
    roll_no: 'NUR-A-07',
    class_name: 'Nursery',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Devendra Nair',
    guardian_phone: '+91 97654 32109',
    admission_no: 'ADM-2025-012',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 2400000,
    paid_months: ['Apr'],
    monthly_fee_paise: 400000,
    address: 'Sunrise Towers, Baner, Pune',
  },
];

export const SEEDED_PATIENTS: PatientEntity[] = [
  {
    id: 'ent_pat_001',
    entity_code: 'PAT-2026-081',
    entity_type: 'PATIENT',
    full_name: 'Rameshwar Nath Kulkarni',
    uhid: 'UHID-2026-1081',
    opd_no: 'OPD-8821',
    age: 58,
    gender: 'MALE',
    doctor_name: 'Dr. Anita Joshi, MD (Medicine)',
    department: 'General Medicine',
    room_bed_no: 'OPD Consultation Rm 3',
    phone: '+91 98199 44332',
    state_code: '27',
    is_active: true,
  },
  {
    id: 'ent_pat_002',
    entity_code: 'PAT-2026-082',
    entity_type: 'PATIENT',
    full_name: 'Meenakshi Sundaram',
    uhid: 'UHID-2026-1082',
    opd_no: 'IPD-4410',
    age: 42,
    gender: 'FEMALE',
    doctor_name: 'Dr. Vivek Malhotra, MS, MCh (Cardio)',
    department: 'Cardiology',
    room_bed_no: 'Semi-Private Bed 204',
    admission_date: '2026-10-17',
    phone: '+91 99887 76655',
    state_code: '27',
    is_active: true,
  },
  {
    id: 'ent_pat_003',
    entity_code: 'PAT-2026-083',
    entity_type: 'PATIENT',
    full_name: 'Master Reyansh Gupta',
    uhid: 'UHID-2026-1083',
    opd_no: 'OPD-8829',
    age: 6,
    gender: 'MALE',
    doctor_name: 'Dr. Sneha Patil, DCH (Pediatrics)',
    department: 'Pediatrics',
    room_bed_no: 'OPD Clinic 2',
    phone: '+91 91234 56789',
    state_code: '27',
    is_active: true,
  },
];

export const SEEDED_RESOURCES: Record<VerticalMode, ResourceItem[]> = {
  RETAIL: [
    {
      id: 'res_ret_001',
      sku: 'SKU-FMCG-01',
      barcode: '8901030000001',
      name: 'Tata Tea Gold Premium 500g',
      hsn_sac: '0902',
      tax_rate_bps: 500, // 5% GST
      base_price_paise: 29500, // ₹295.00
      mrp_paise: 35000, // ₹350.00 (Save ₹55)
      unit: 'PACK',
      is_stock_tracked: true,
      category: 'Beverages',
    },
    {
      id: 'res_ret_002',
      sku: 'SKU-FMCG-02',
      barcode: '8901234567890',
      name: 'Amul Pure Ghee Pouch 1L',
      hsn_sac: '0405',
      tax_rate_bps: 1200, // 12% GST
      base_price_paise: 59000, // ₹590.00
      mrp_paise: 65000, // ₹650.00 (Save ₹60)
      unit: 'PACK',
      is_stock_tracked: true,
      category: 'Dairy',
    },
    {
      id: 'res_ret_003',
      sku: 'SKU-FMCG-03',
      barcode: '8901012345678',
      name: 'Fortune Sunlite Refined Oil 1L',
      hsn_sac: '1512',
      tax_rate_bps: 500, // 5% GST
      base_price_paise: 13500, // ₹135.00
      mrp_paise: 16500, // ₹165.00 (Save ₹30)
      unit: 'BOTTLE',
      is_stock_tracked: true,
      category: 'Cooking Oils',
    },
    {
      id: 'res_ret_004',
      sku: 'SKU-FMCG-04',
      barcode: '8902045612345',
      name: 'Dettol Original Germ Protection Soap (Buy 3 Get 1)',
      hsn_sac: '3401',
      tax_rate_bps: 1800, // 18% GST
      base_price_paise: 18000, // ₹180.00
      mrp_paise: 21000, // ₹210.00
      unit: 'PACK',
      is_stock_tracked: true,
      category: 'Personal Care',
    },
    {
      id: 'res_ret_005',
      sku: 'SKU-FMCG-05',
      barcode: '8906001234567',
      name: 'Aashirvaad Shudh Chakki Atta 5kg',
      hsn_sac: '1101',
      tax_rate_bps: 0, // 0% GST (branded unpacked/exempt standard flour)
      base_price_paise: 24000, // ₹240.00
      mrp_paise: 27500, // ₹275.00
      unit: 'BAG',
      is_stock_tracked: true,
      category: 'Grains & Flours',
    },
    {
      id: 'res_ret_006',
      sku: 'SKU-FMCG-06',
      barcode: '8901719108044',
      name: 'Britannia Good Day Butter Cookies 200g',
      hsn_sac: '1905',
      tax_rate_bps: 1800, // 18% GST
      base_price_paise: 3800, // ₹38.00
      mrp_paise: 5000, // ₹50.00
      unit: 'PACK',
      is_stock_tracked: true,
      category: 'Bakery & Snacks',
    },
  ],

  WHOLESALE: [
    {
      id: 'res_whs_001',
      sku: 'WHS-OIL-CRTN',
      name: 'Fortune Sunflower Oil (Case of 12 x 1L)',
      hsn_sac: '1512',
      tax_rate_bps: 500, // 5% GST
      base_price_paise: 156000, // ₹1,560.00 per carton
      mrp_paise: 198000,
      unit: 'CASE',
      is_stock_tracked: true,
      category: 'Edible Oils',
      lots: [
        {
          id: 'lot_whs_101',
          resource_id: 'res_whs_001',
          batch_number: 'BT-OIL-2026/A1',
          expiry_date: '2027-03-31',
          mrp_paise: 198000,
          stock_milli: 450000, // 450 cases
        },
        {
          id: 'lot_whs_102',
          resource_id: 'res_whs_001',
          batch_number: 'BT-OIL-2026/B4',
          expiry_date: '2027-08-31',
          mrp_paise: 198000,
          stock_milli: 800000, // 800 cases
        },
      ],
    },
    {
      id: 'res_whs_002',
      sku: 'WHS-RICE-50KG',
      name: 'Daawat Rozana Super Basmati Rice (50kg Master Bag)',
      hsn_sac: '1006',
      tax_rate_bps: 500,
      base_price_paise: 375000, // ₹3,750.00
      mrp_paise: 440000,
      unit: 'BAG',
      is_stock_tracked: true,
      category: 'Grains & Pulses',
      lots: [
        {
          id: 'lot_whs_201',
          resource_id: 'res_whs_002',
          batch_number: 'LOT-RICE-99B',
          expiry_date: '2028-06-30',
          mrp_paise: 440000,
          stock_milli: 320000, // 320 bags
        },
      ],
    },
    {
      id: 'res_whs_003',
      sku: 'WHS-SOAP-BULK',
      name: 'Lifebuoy Total Germ Protection (Master Carton 72 Pcs)',
      hsn_sac: '3401',
      tax_rate_bps: 1800,
      base_price_paise: 216000, // ₹2,160.00
      mrp_paise: 288000,
      unit: 'CARTON',
      is_stock_tracked: true,
      category: 'Soaps & Detergents',
      lots: [
        {
          id: 'lot_whs_301',
          resource_id: 'res_whs_003',
          batch_number: 'BT-LFB-OCT26',
          expiry_date: '2028-10-31',
          mrp_paise: 288000,
          stock_milli: 180000,
        },
      ],
    },
    {
      id: 'res_whs_004',
      sku: 'WHS-SUGAR-50K',
      name: 'M-30 Refined Crystal Sugar (50kg Jute Bag)',
      hsn_sac: '1701',
      tax_rate_bps: 500,
      base_price_paise: 195000, // ₹1,950.00
      mrp_paise: 220000,
      unit: 'BAG',
      is_stock_tracked: true,
      category: 'Commodities',
      lots: [
        {
          id: 'lot_whs_401',
          resource_id: 'res_whs_004',
          batch_number: 'MILL-SUG-2026',
          expiry_date: '2027-12-31',
          mrp_paise: 220000,
          stock_milli: 500000,
        },
      ],
    },
  ],

  SCHOOL: [
    {
      id: 'res_sch_001',
      sku: 'FEE-TUITION',
      name: 'Tuition & Academic Instructional Fee',
      hsn_sac: '999293', // Educational Services
      tax_rate_bps: 0, // Exempt under GST Notification 12/2017
      base_price_paise: 1800000, // ₹18,000.00 per term
      unit: 'TERM',
      is_stock_tracked: false,
      category: 'Tuition',
    },
    {
      id: 'res_sch_002',
      sku: 'FEE-TRANSPORT',
      name: 'School Bus & Transport Fee (Zone A - 5km)',
      hsn_sac: '999294',
      tax_rate_bps: 0,
      base_price_paise: 450000, // ₹4,500.00
      unit: 'TERM',
      is_stock_tracked: false,
      category: 'Transport',
    },
    {
      id: 'res_sch_003',
      sku: 'FEE-EXAM',
      name: 'Term Examination & Assessment Fee',
      hsn_sac: '999293',
      tax_rate_bps: 0,
      base_price_paise: 150000, // ₹1,500.00
      unit: 'TERM',
      is_stock_tracked: false,
      category: 'Examination',
    },
    {
      id: 'res_sch_004',
      sku: 'FEE-LAB-COMP',
      name: 'Computer & AI Innovation Lab Fee',
      hsn_sac: '999293',
      tax_rate_bps: 0,
      base_price_paise: 220000, // ₹2,200.00
      unit: 'TERM',
      is_stock_tracked: false,
      category: 'Lab',
    },
    {
      id: 'res_sch_005',
      sku: 'FEE-SPORTS',
      name: 'Sports Complex, Swimming & Activity Fee',
      hsn_sac: '999293',
      tax_rate_bps: 0,
      base_price_paise: 180000, // ₹1,800.00
      unit: 'TERM',
      is_stock_tracked: false,
      category: 'Sports',
    },
    {
      id: 'res_sch_006',
      sku: 'FEE-ANNUAL-DEV',
      name: 'Annual Infrastructure & Smart Campus Development',
      hsn_sac: '999293',
      tax_rate_bps: 0,
      base_price_paise: 800000, // ₹8,000.00
      unit: 'ANNUAL',
      is_stock_tracked: false,
      category: 'Admission',
    },
  ],

  HOSPITAL: [
    {
      id: 'res_hosp_001',
      sku: 'MED-CONSULT-OPD',
      name: 'Doctor OPD Specialist Consultation (General / Cardio)',
      hsn_sac: '999312', // Medical Consulting Services
      tax_rate_bps: 0, // Healthcare service exempt from GST
      base_price_paise: 80000, // ₹800.00
      unit: 'VISIT',
      is_stock_tracked: false,
      category: 'Consultation',
    },
    {
      id: 'res_hosp_002',
      sku: 'MED-CONSULT-EMERG',
      name: 'Emergency / Trauma Triage Consultation',
      hsn_sac: '999312',
      tax_rate_bps: 0,
      base_price_paise: 150000, // ₹1,500.00
      unit: 'VISIT',
      is_stock_tracked: false,
      category: 'Consultation',
    },
    {
      id: 'res_hosp_003',
      sku: 'PHARM-AUG-625',
      name: 'Augmentin 625 Duo Tablets (Strip of 10)',
      hsn_sac: '3004', // Medicaments
      tax_rate_bps: 1200, // 12% GST
      base_price_paise: 19800, // ₹198.00
      mrp_paise: 22000,
      unit: 'STRIP',
      is_stock_tracked: true,
      category: 'Pharmacy',
      lots: [
        {
          id: 'lot_med_01',
          resource_id: 'res_hosp_003',
          batch_number: 'AUG-26A09',
          expiry_date: '2027-11-30',
          mrp_paise: 22000,
          stock_milli: 120000,
        },
      ],
    },
    {
      id: 'res_hosp_004',
      sku: 'PHARM-PAN-40',
      name: 'Pan-D Gastro-Resistant Capsules (Strip of 15)',
      hsn_sac: '3004',
      tax_rate_bps: 1200,
      base_price_paise: 18500, // ₹185.00
      mrp_paise: 21500,
      unit: 'STRIP',
      is_stock_tracked: true,
      category: 'Pharmacy',
      lots: [
        {
          id: 'lot_med_02',
          resource_id: 'res_hosp_004',
          batch_number: 'PAN-9941K',
          expiry_date: '2028-02-28',
          mrp_paise: 21500,
          stock_milli: 250000,
        },
      ],
    },
    {
      id: 'res_hosp_005',
      sku: 'BED-GEN-WARD',
      name: 'General Inpatient Bed & Ward Care (Per Day)',
      hsn_sac: '999311',
      tax_rate_bps: 0,
      base_price_paise: 150000, // ₹1,500.00 / day
      unit: 'DAY',
      is_stock_tracked: false,
      category: 'Bed Charges',
    },
    {
      id: 'res_hosp_006',
      sku: 'BED-SEMI-PVT',
      name: 'Semi-Private Room & Monitored Bed (Per Day)',
      hsn_sac: '999311',
      tax_rate_bps: 0,
      base_price_paise: 350000, // ₹3,500.00 / day
      unit: 'DAY',
      is_stock_tracked: false,
      category: 'Bed Charges',
    },
    {
      id: 'res_hosp_007',
      sku: 'BED-ICU-CARE',
      name: 'Intensive Care Unit (ICU) Critical Bed (Per Day)',
      hsn_sac: '999311',
      tax_rate_bps: 0,
      base_price_paise: 950000, // ₹9,500.00 / day
      unit: 'DAY',
      is_stock_tracked: false,
      category: 'Bed Charges',
    },
  ],
};

// ----------------------------------------------------------------------------
// IN-MEMORY / LOCAL STORAGE PERSISTENCE STATE
// ----------------------------------------------------------------------------

interface CentralState {
  customers: WholesaleCustomer[];
  students: StudentEntity[];
  patients: PatientEntity[];
  receipts: PostedTransactionReceipt[];
  sequenceNumbers: Record<string, number>;
}

const STORAGE_KEY = 'omnibill_vertical_state_v1';

function loadState(): CentralState {
  if (typeof window === 'undefined') {
    return {
      customers: [...SEEDED_CUSTOMERS],
      students: [...SEEDED_STUDENTS],
      patients: [...SEEDED_PATIENTS],
      receipts: [],
      sequenceNumbers: { RETAIL: 1001, WHOLESALE: 2001, SCHOOL: 3001, HOSPITAL: 4001 },
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not read state from localStorage:', err);
  }

  const initial: CentralState = {
    customers: [...SEEDED_CUSTOMERS],
    students: [...SEEDED_STUDENTS],
    patients: [...SEEDED_PATIENTS],
    receipts: [],
    sequenceNumbers: { RETAIL: 1001, WHOLESALE: 2001, SCHOOL: 3001, HOSPITAL: 4001 },
  };
  saveState(initial);
  return initial;
}

function saveState(state: CentralState) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save vertical state:', e);
    }
  }
}

let currentState: CentralState = loadState();

// ----------------------------------------------------------------------------
// CENTRAL STATE & IPC BRIDGE API
// ----------------------------------------------------------------------------

export const VerticalIPCBridge = {
  /**
   * Get all entities of a given entity type
   */
  async getEntities(entityType: EntityType): Promise<any[]> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<any[]>('cmd_get_entities', { db_path: getDbPath() });
        if (Array.isArray(res) && res.length > 0) {
          const filtered = res.filter((e) => e.entity_type === entityType);
          if (filtered.length > 0) return filtered;
        }
      } catch (err) {
        console.warn('Tauri cmd_get_entities invoke failed:', err);
      }
    }

    // Local fallback with deep cloning to prevent shared reference mutation
    if (entityType === 'CUSTOMER') return currentState.customers.map((c) => ({ ...c }));
    if (entityType === 'STUDENT') return currentState.students.map((s) => ({ ...s }));
    if (entityType === 'PATIENT') return currentState.patients.map((p) => ({ ...p }));
    return [];
  },

  /**
   * Save / Register a new entity (Customer, Student, Patient)
   */
  async createEntity(entity: WholesaleCustomer | StudentEntity | PatientEntity): Promise<any> {
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cmd_create_entity', {
          db_path: getDbPath(),
          input: {
            id: entity.id,
            entity_code: entity.entity_code,
            entity_type: entity.entity_type,
            full_name: 'full_name' in entity ? entity.full_name : '',
            phone: 'phone' in entity ? entity.phone : undefined,
            gstin: 'gstin' in entity ? entity.gstin : undefined,
            state_code: entity.state_code || '27',
          },
        });
      } catch (err) {
        console.error('Tauri cmd_create_entity invoke error:', err);
        throw new Error(`Failed to create entity: ${err}`);
      }
    }

    if (entity.entity_type === 'CUSTOMER') {
      currentState.customers = [entity as WholesaleCustomer, ...currentState.customers];
    } else if (entity.entity_type === 'STUDENT') {
      currentState.students = [entity as StudentEntity, ...currentState.students];
    } else if (entity.entity_type === 'PATIENT') {
      currentState.patients = [entity as PatientEntity, ...currentState.patients];
    }

    saveState(currentState);
    return entity;
  },

  /**
   * Search / retrieve resources for a vertical
   */
  async getResources(vertical: VerticalMode, query = ''): Promise<ResourceItem[]> {
    const list = SEEDED_RESOURCES[vertical] || [];
    if (!query.trim()) return list;
    const q = query.toLowerCase().trim();
    return list.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q))
    );
  },

  /**
   * Post a transaction from any vertical mode directly to the central ledger
   */
  async postTransaction(payload: {
    verticalMode: VerticalMode;
    entityType: EntityType;
    entityId: string;
    entityName: string;
    entityDetails: any;
    lines: VerticalCartLine[];
    totals: DocumentTotals;
    payment: PaymentDetails;
    ewayBill?: EWayBillDetails;
    notes?: string;
  }): Promise<PostedTransactionReceipt> {
    const now = new Date();
    const invoiceDate = now.toISOString().split('T')[0];
    const invoiceTime = now.toTimeString().split(' ')[0];

    // Determine prefix and series
    const seriesMap: Record<VerticalMode, string> = {
      RETAIL: 'RET',
      WHOLESALE: 'WHS',
      SCHOOL: 'SCH',
      HOSPITAL: 'HOS',
    };
    const series = seriesMap[payload.verticalMode] || 'INV';
    const nextSeq = (currentState.sequenceNumbers[payload.verticalMode] || 1000) + 1;
    currentState.sequenceNumbers[payload.verticalMode] = nextSeq;

    const invoiceNumber = `${series}-26-${String(nextSeq).padStart(4, '0')}`;
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const receipt: PostedTransactionReceipt = {
      transaction_id: transactionId,
      invoice_number: invoiceNumber,
      series,
      invoice_date: invoiceDate,
      invoice_time: invoiceTime,
      vertical_mode: payload.verticalMode,
      entity_type: payload.entityType,
      entity_id: payload.entityId,
      entity_name: payload.entityName,
      entity_details: payload.entityDetails,
      lines: payload.lines,
      totals: payload.totals,
      payment: payload.payment,
      eway_bill: payload.ewayBill,
      notes: payload.notes,
      created_at: now.toISOString(),
    };

    // If running inside Tauri desktop app, bridge into `cmd_post_sale` and `cmd_post_payment`
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Transform lines for SQLite schema
        const lineInputs = payload.lines.map((l) => ({
          resource_id: l.resource_id,
          quantity_milli: l.quantity_milli,
          unit_price_paise: l.unit_price_paise,
          discount_paise: l.discount_paise,
          tax_rate_bps: l.tax_rate_bps,
        }));

        const postedSale = await invoke<any>('cmd_post_sale', {
          db_path: getDbPath(),
          input: {
            invoice_date: invoiceDate,
            seller_state_code: '27',
            place_of_supply_state_code: payload.entityDetails?.state_code || '27',
            customer: payload.entityId,
            price_mode: 'Exclusive',
            lines: lineInputs,
          },
        });

        if (postedSale?.invoice_number) {
          receipt.invoice_number = postedSale.invoice_number;
          receipt.transaction_id = postedSale.transaction_id;
        }

        const modeMap: Record<string, string> = {
          CASH: 'Cash',
          UPI: 'Upi',
          CARD: 'Card',
          BANK_TRANSFER: 'BankTransfer',
        };

        // Also post immediate payment allocation
        await invoke('cmd_post_payment', {
          db_path: getDbPath(),
          input: {
            entity_id: payload.entityId,
            payment_mode: modeMap[payload.payment.mode] || 'Cash',
            amount_paise: payload.payment.amount_tendered_paise,
            reference_number: payload.payment.reference_number || receipt.invoice_number,
            allocations: [
              {
                invoice_number: receipt.invoice_number,
                amount_allocated_paise: payload.totals.total_amount_paise,
              },
            ],
          },
        });
      } catch (err: any) {
        const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
        console.error('Tauri IPC transaction error:', errMsg);
        throw new Error(`Transaction failed in SQLite backend: ${errMsg}`);
      }
    }

    // Update customer outstanding balance if credit was used
    if (payload.entityType === 'CUSTOMER' && payload.payment.mode === 'BANK_TRANSFER') {
      const idx = currentState.customers.findIndex((c) => c.id === payload.entityId);
      if (idx !== -1) {
        currentState.customers[idx] = {
          ...currentState.customers[idx],
          current_balance_paise:
            currentState.customers[idx].current_balance_paise + payload.totals.total_amount_paise,
        };
      }
    }

    // Persist to central history
    currentState.receipts = [receipt, ...currentState.receipts];
    saveState(currentState);

    return receipt;
  },

  /**
   * Get transaction history
   */
  getTransactionHistory(vertical?: VerticalMode): PostedTransactionReceipt[] {
    if (!vertical) return currentState.receipts;
    return currentState.receipts.filter((r) => r.vertical_mode === vertical);
  },
};
