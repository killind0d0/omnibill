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
import { INITIAL_WHOLESALE_CUSTOMERS } from './wholesaleData';
import { INITIAL_HOSPITAL_PATIENTS } from './hospitalData';

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

export const SEEDED_CUSTOMERS: WholesaleCustomer[] = INITIAL_WHOLESALE_CUSTOMERS;

export const SEEDED_STUDENTS: StudentEntity[] = [
  // 1. Nursery
  {
    id: 'ent_std_001',
    entity_code: 'STD-2026-001',
    entity_type: 'STUDENT',
    full_name: 'Vihaan Amit Sharma',
    roll_no: 'NUR-A-01',
    class_name: 'Nursery',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Amit Sharma',
    guardian_phone: '+91 98201 11223',
    admission_no: 'ADM-2026-001',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 4000000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 400000,
    address: 'Flat 102, Blue Ridge, Hinjewadi Phase 1, Pune',
  },
  {
    id: 'ent_std_002',
    entity_code: 'STD-2026-002',
    entity_type: 'STUDENT',
    full_name: 'Riya Manoj Patel',
    roll_no: 'NUR-B-08',
    class_name: 'Nursery',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Manoj Patel',
    guardian_phone: '+91 98192 33445',
    admission_no: 'ADM-2026-002',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 4400000,
    paid_months: ['Apr'],
    monthly_fee_paise: 400000,
    address: 'B-44, Clover Park, Viman Nagar, Pune',
  },

  // 2. LKG
  {
    id: 'ent_std_003',
    entity_code: 'STD-2025-015',
    entity_type: 'STUDENT',
    full_name: 'Advait Santosh Joshi',
    roll_no: 'LKG-A-03',
    class_name: 'LKG',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Santosh Joshi',
    guardian_phone: '+91 97654 11223',
    admission_no: 'ADM-2025-015',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 3780000,
    paid_months: ['Apr', 'May', 'Jun'],
    monthly_fee_paise: 420000,
    address: '14/3, Prabhat Road, Lane 5, Erandwane, Pune',
  },
  {
    id: 'ent_std_004',
    entity_code: 'STD-2025-022',
    entity_type: 'STUDENT',
    full_name: 'Kiara Harish Nair',
    roll_no: 'LKG-B-12',
    class_name: 'LKG',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Harish Nair',
    guardian_phone: '+91 98230 44556',
    admission_no: 'ADM-2025-022',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 5040000,
    paid_months: [],
    monthly_fee_paise: 420000,
    address: 'A-302, Rohan Tarang, Wakad, Pune',
  },

  // 3. UKG
  {
    id: 'ent_std_005',
    entity_code: 'STD-2024-031',
    entity_type: 'STUDENT',
    full_name: 'Kabir Rajesh Mehta',
    roll_no: 'UKG-A-05',
    class_name: 'UKG',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Rajesh Mehta',
    guardian_phone: '+91 99221 55667',
    admission_no: 'ADM-2024-031',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 3520000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul'],
    monthly_fee_paise: 440000,
    address: 'Flat 504, Windsor Park, Aundh, Pune',
  },
  {
    id: 'ent_std_006',
    entity_code: 'STD-2024-044',
    entity_type: 'STUDENT',
    full_name: 'Anaya Vikram Gupta',
    roll_no: 'UKG-B-14',
    class_name: 'UKG',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Vikram Gupta',
    guardian_phone: '+91 98901 66778',
    admission_no: 'ADM-2024-044',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 4400000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 440000,
    address: 'Bunglow 9, Nyati Estate, Mohammadwadi, Pune',
  },

  // 4. Class 1
  {
    id: 'ent_std_007',
    entity_code: 'STD-2023-010',
    entity_type: 'STUDENT',
    full_name: 'Aarav Anand Deshmukh',
    roll_no: '01-A-02',
    class_name: 'Class 1',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Anand Deshmukh',
    guardian_phone: '+91 98500 77889',
    admission_no: 'ADM-2023-010',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 3060000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
    monthly_fee_paise: 510000,
    address: 'C-7, Ganga Skies, Vallabh Nagar, Pimpri, Pune',
  },
  {
    id: 'ent_std_008',
    entity_code: 'STD-2023-024',
    entity_type: 'STUDENT',
    full_name: 'Ishaan Nitin Verma',
    roll_no: '01-B-11',
    class_name: 'Class 1',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Nitin Verma',
    guardian_phone: '+91 98223 88990',
    admission_no: 'ADM-2023-024',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 5100000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 510000,
    address: 'Flat 201, Ivy Estate, Wagholi, Pune',
  },

  // 5. Class 2
  {
    id: 'ent_std_009',
    entity_code: 'STD-2022-033',
    entity_type: 'STUDENT',
    full_name: 'Sanvi Pravin Kulkarni',
    roll_no: '02-A-06',
    class_name: 'Class 2',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Pravin Kulkarni',
    guardian_phone: '+91 97640 99001',
    admission_no: 'ADM-2022-033',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 4680000,
    paid_months: ['Apr', 'May', 'Jun'],
    monthly_fee_paise: 520000,
    address: 'Row House 18, Mayur Colony, Kothrud, Pune',
  },

  // 6. Class 3
  {
    id: 'ent_std_010',
    entity_code: 'STD-2022-048',
    entity_type: 'STUDENT',
    full_name: 'Atharva Sachin Patil',
    roll_no: '03-B-09',
    class_name: 'Class 3',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Sachin Patil',
    guardian_phone: '+91 98601 22334',
    admission_no: 'ADM-2022-048',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 5830000,
    paid_months: ['Apr'],
    monthly_fee_paise: 530000,
    address: 'B-102, Paranjape Blue Ridge, Hinjewadi, Pune',
  },

  // 7. Class 4
  {
    id: 'ent_std_011',
    entity_code: 'STD-2021-052',
    entity_type: 'STUDENT',
    full_name: 'Ananya Suresh Iyer',
    roll_no: '04-A-15',
    class_name: 'Class 4',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Suresh Iyer',
    guardian_phone: '+91 98211 33445',
    admission_no: 'ADM-2021-052',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 2800000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 560000,
    address: 'Flat 603, Kalpataru Harmony, Wakad, Pune',
  },

  // 8. Class 5
  {
    id: 'ent_std_012',
    entity_code: 'STD-2024-055',
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
    dues_balance_paise: 3000000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 600000,
    address: 'Row House 4, Kothrud, Pune',
  },

  // 9. Class 6
  {
    id: 'ent_std_013',
    entity_code: 'STD-2020-061',
    entity_type: 'STUDENT',
    full_name: 'Samaira Hemant Joshi',
    roll_no: '06-B-07',
    class_name: 'Class 6',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Hemant Joshi',
    guardian_phone: '+91 99234 44556',
    admission_no: 'ADM-2020-061',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 6500000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 650000,
    address: 'Flat 402, Rohan Mithila, Viman Nagar, Pune',
  },

  // 10. Class 7
  {
    id: 'ent_std_014',
    entity_code: 'STD-2019-073',
    entity_type: 'STUDENT',
    full_name: 'Neil Gautam Sengupta',
    roll_no: '07-A-10',
    class_name: 'Class 7',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Gautam Sengupta',
    guardian_phone: '+91 98205 55667',
    admission_no: 'ADM-2019-073',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 8040000,
    paid_months: [],
    monthly_fee_paise: 670000,
    address: 'Plot 15, Cosmos Society, Senapati Bapat Road, Pune',
  },

  // 11. Class 8
  {
    id: 'ent_std_015',
    entity_code: 'STD-2022-119',
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
    dues_balance_paise: 6900000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 690000,
    address: 'Bunglow 12, Shivaji Nagar, Pune',
  },

  // 12. Class 9
  {
    id: 'ent_std_016',
    entity_code: 'STD-2018-085',
    entity_type: 'STUDENT',
    full_name: 'Arjun Sanjay Rathi',
    roll_no: '09-A-04',
    class_name: 'Class 9',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Sanjay Rathi',
    guardian_phone: '+91 98902 66778',
    admission_no: 'ADM-2018-085',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 6240000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul'],
    monthly_fee_paise: 780000,
    address: 'Wing D, Marvel Cerise, Kharadi, Pune',
  },

  // 13. Class 10
  {
    id: 'ent_std_017',
    entity_code: 'STD-2020-044',
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
    dues_balance_paise: 4300000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul'],
    monthly_fee_paise: 860000,
    address: 'Flat 402, Green Valley Apartments, MG Road, Pune',
  },
  {
    id: 'ent_std_018',
    entity_code: 'STD-2017-092',
    entity_type: 'STUDENT',
    full_name: 'Shruti Venkat Nair',
    roll_no: '10-B-19',
    class_name: 'Class 10',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Venkat Nair',
    guardian_phone: '+91 98233 77889',
    admission_no: 'ADM-2017-092',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 4300000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 860000,
    address: 'B-14, Kumar Renaissance, Bavdhan, Pune',
  },

  // 14. Class 11
  {
    id: 'ent_std_019',
    entity_code: 'STD-2016-101',
    entity_type: 'STUDENT',
    full_name: 'Yashwardhan Digvijay Rathore',
    roll_no: '11-SCI-08',
    class_name: 'Class 11',
    section: 'A',
    academic_year: '2026-2027',
    guardian_name: 'Digvijay Rathore',
    guardian_phone: '+91 98504 88990',
    admission_no: 'ADM-2016-101',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 10200000,
    paid_months: ['Apr', 'May'],
    monthly_fee_paise: 1020000,
    address: 'Bunglow 4, Panchavati Society, Pashan, Pune',
  },

  // 15. Class 12
  {
    id: 'ent_std_020',
    entity_code: 'STD-2018-002',
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
    dues_balance_paise: 5600000,
    paid_months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    monthly_fee_paise: 1120000,
    address: 'Plot 88, Model Colony, Shivajinagar, Pune',
  },
  {
    id: 'ent_std_021',
    entity_code: 'STD-2016-115',
    entity_type: 'STUDENT',
    full_name: 'Sanya Rahul Mehra',
    roll_no: '12-COM-22',
    class_name: 'Class 12',
    section: 'B',
    academic_year: '2026-2027',
    guardian_name: 'Rahul Mehra',
    guardian_phone: '+91 98219 99001',
    admission_no: 'ADM-2016-115',
    state_code: '27',
    is_active: true,
    dues_balance_paise: 10080000,
    paid_months: ['Apr', 'May', 'Jun'],
    monthly_fee_paise: 1120000,
    address: 'Penthouse 12, Skyi Songbirds, Bhugaon, Pune',
  },
];

export const SEEDED_PATIENTS: PatientEntity[] = INITIAL_HOSPITAL_PATIENTS;

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
      const parsed = JSON.parse(raw);
      let needsSave = false;
      if (!parsed.patients || parsed.patients.length < SEEDED_PATIENTS.length) {
        parsed.patients = [...SEEDED_PATIENTS];
        needsSave = true;
      }
      if (!parsed.customers || parsed.customers.length < SEEDED_CUSTOMERS.length) {
        parsed.customers = [...SEEDED_CUSTOMERS];
        needsSave = true;
      }
      if (!parsed.students || parsed.students.length < SEEDED_STUDENTS.length) {
        parsed.students = [...SEEDED_STUDENTS];
        needsSave = true;
      }
      if (needsSave) {
        saveState(parsed);
      }
      return parsed;
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
