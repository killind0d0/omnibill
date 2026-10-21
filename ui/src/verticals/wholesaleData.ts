// ui/src/verticals/wholesaleData.ts
// Wholesale & B2B Distribution Suite Data Service: 20 B2B Customers, Volume Slabs, Logistics Expenses, Tax Invoice Customizer, and CSV/WhatsApp Exports

import {
  WholesaleCustomer,
  WholesalePricingRule,
  WholesaleExpense,
  WholesaleInvoiceSettings,
  WholesaleInvoiceRecord,
  PaymentMode,
  WholesaleStockItem,
} from './types';
import { PurchaseExpenseVoucher } from '../components/common/PurchaseExpenseBillModal';
import { formatPaise } from '../lib/tax';

// ----------------------------------------------------------------------------
// 1. SEEDED B2B WHOLESALE CUSTOMERS DIRECTORY (20 VERIFIED PARTIES)
// ----------------------------------------------------------------------------
export const INITIAL_WHOLESALE_CUSTOMERS: WholesaleCustomer[] = [
  {
    id: 'ent_b2b_001',
    entity_code: 'CUST-B2B-01',
    entity_type: 'CUSTOMER',
    full_name: 'Metro MegaMart Distributors Pvt Ltd',
    trade_name: 'Metro MegaMart',
    gstin: '27AABCU9603R1ZM',
    phone: '+91 98200 12345',
    email: 'accounts@metromegamart.com',
    state_code: '27', // Maharashtra (Intra-State)
    is_active: true,
    credit_limit_paise: 25000000, // ₹2,50,000.00
    current_balance_paise: 18500000, // ₹1,85,000.00
    payment_terms_days: 30,
    pan: 'AABCU9603R',
    contact_person: 'Rajesh Agrawal (Procurement Head)',
    address_line1: 'Plot 44, MIDC Industrial Area, Andheri East',
    city: 'Mumbai',
    pincode: '400093',
    billing_address: 'Plot 44, MIDC Industrial Area, Andheri East, Mumbai, MH - 400093',
    shipping_address: 'Warehouse No 12, Logistics Park, Bhiwandi, Thane, MH - 421302',
  },
  {
    id: 'ent_b2b_002',
    entity_code: 'CUST-B2B-02',
    entity_type: 'CUSTOMER',
    full_name: 'Apex Supermarket & Retail Traders',
    trade_name: 'Apex Traders',
    gstin: '27AADCA3412B1Z8',
    phone: '+91 94220 56789',
    email: 'billing@apextraders.in',
    state_code: '27', // Maharashtra (Intra-State)
    is_active: true,
    credit_limit_paise: 10000000, // ₹1,00,000.00
    current_balance_paise: 9200000, // ₹92,000.00 (Near limit!)
    payment_terms_days: 15,
    pan: 'AADCA3412B',
    contact_person: 'Manoj Patel (Store Owner)',
    address_line1: 'Shop 12-14, Commercial Market, Shivaji Chowk',
    city: 'Pune',
    pincode: '411001',
    billing_address: 'Shop 12-14, Commercial Market, Shivaji Chowk, Pune, MH - 411001',
    shipping_address: 'Shop 12-14, Commercial Market, Shivaji Chowk, Pune, MH - 411001',
  },
  {
    id: 'ent_b2b_003',
    entity_code: 'CUST-B2B-03',
    entity_type: 'CUSTOMER',
    full_name: 'Bharat Wholesale Agencies',
    trade_name: 'Bharat Agencies',
    gstin: '07AAAAA0000A1Z5', // Delhi (Inter-state IGST)
    phone: '+91 98110 99887',
    email: 'info@bharatwholesale.com',
    state_code: '07', // Delhi
    is_active: true,
    credit_limit_paise: 50000000, // ₹5,00,000.00
    current_balance_paise: 12000000, // ₹1,20,000.00
    payment_terms_days: 45,
    pan: 'AAAAA0000A',
    contact_person: 'Sunil Kapoor (Director)',
    address_line1: 'B-88, Okhla Industrial Area Phase 1',
    city: 'New Delhi',
    pincode: '110020',
    billing_address: 'B-88, Okhla Industrial Area Phase 1, New Delhi, DL - 110020',
    shipping_address: 'Warehouse Hub 4, Sanjay Gandhi Transport Nagar, Delhi - 110042',
  },
  {
    id: 'ent_b2b_004',
    entity_code: 'CUST-B2B-04',
    entity_type: 'CUSTOMER',
    full_name: 'Gujarat FMCG Super Stockists LLP',
    trade_name: 'Gujarat FMCG Depot',
    gstin: '24AABCG1234D1Z2', // Gujarat (Inter-state IGST)
    phone: '+91 98250 44332',
    email: 'orders@gujaratfmcg.com',
    state_code: '24', // Gujarat
    is_active: true,
    credit_limit_paise: 40000000, // ₹4,00,000.00
    current_balance_paise: 24000000, // ₹2,40,000.00
    payment_terms_days: 30,
    pan: 'AABCG1234D',
    contact_person: 'Bhavesh Shah (Managing Partner)',
    address_line1: 'Shed 19, GIDC Industrial Estate, Naroda',
    city: 'Ahmedabad',
    pincode: '382330',
    billing_address: 'Shed 19, GIDC Industrial Estate, Naroda, Ahmedabad, GJ - 382330',
    shipping_address: 'Shed 19, GIDC Industrial Estate, Naroda, Ahmedabad, GJ - 382330',
  },
  {
    id: 'ent_b2b_005',
    entity_code: 'CUST-B2B-05',
    entity_type: 'CUSTOMER',
    full_name: 'Karnataka Pharma & General Supplies Ltd',
    trade_name: 'Karnataka Pharma Corp',
    gstin: '29AABCK5678E1Z9', // Karnataka (Inter-state IGST)
    phone: '+91 98450 11223',
    email: 'purchase@karnatakapharma.co.in',
    state_code: '29', // Karnataka
    is_active: true,
    credit_limit_paise: 35000000, // ₹3,50,000.00
    current_balance_paise: 15800000, // ₹1,58,000.00
    payment_terms_days: 30,
    pan: 'AABCK5678E',
    contact_person: 'Narayana Swamy (Senior Buyer)',
    address_line1: 'Building 7A, Peenya 3rd Phase',
    city: 'Bengaluru',
    pincode: '560058',
    billing_address: 'Building 7A, Peenya 3rd Phase, Bengaluru, KA - 560058',
    shipping_address: 'Distribution Center 2, Bommasandra Industrial Area, Bengaluru, KA - 560099',
  },
  {
    id: 'ent_b2b_006',
    entity_code: 'CUST-B2B-06',
    entity_type: 'CUSTOMER',
    full_name: 'Royal Kirana Mart & Departmental Stores',
    trade_name: 'Royal Kirana Nagpur',
    gstin: '27AABCR9911F1Z3',
    phone: '+91 97640 88771',
    email: 'royalkirana.ngp@gmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 15000000, // ₹1,50,000.00
    current_balance_paise: 6400000, // ₹64,000.00
    payment_terms_days: 21,
    pan: 'AABCR9911F',
    contact_person: 'Dharmendra Joshi',
    address_line1: 'Main Road, Itwari Wholesale Grain Market',
    city: 'Nagpur',
    pincode: '440002',
    billing_address: 'Main Road, Itwari Wholesale Grain Market, Nagpur, MH - 440002',
    shipping_address: 'Main Road, Itwari Wholesale Grain Market, Nagpur, MH - 440002',
  },
  {
    id: 'ent_b2b_007',
    entity_code: 'CUST-B2B-07',
    entity_type: 'CUSTOMER',
    full_name: 'Deccan Provisions & Cash-and-Carry',
    trade_name: 'Deccan Provisions',
    gstin: '36AABCD4412G1Z7', // Telangana (Inter-state IGST)
    phone: '+91 98490 33441',
    email: 'billing@deccanprovisions.in',
    state_code: '36', // Telangana
    is_active: true,
    credit_limit_paise: 30000000, // ₹3,00,000.00
    current_balance_paise: 21000000, // ₹2,10,000.00
    payment_terms_days: 30,
    pan: 'AABCD4412G',
    contact_person: 'Venkat Reddy (Logistics Head)',
    address_line1: 'Sy No 84, Autonagar Industrial Area',
    city: 'Hyderabad',
    pincode: '500070',
    billing_address: 'Sy No 84, Autonagar Industrial Area, Hyderabad, TS - 500070',
    shipping_address: 'Sy No 84, Autonagar Industrial Area, Hyderabad, TS - 500070',
  },
  {
    id: 'ent_b2b_008',
    entity_code: 'CUST-B2B-08',
    entity_type: 'CUSTOMER',
    full_name: 'Shanti Medical & Surgical Supplies',
    trade_name: 'Shanti Medicals',
    gstin: '27AABCS7712H1Z4',
    phone: '+91 98224 55660',
    email: 'contact@shantimedicals.in',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 20000000, // ₹2,00,000.00
    current_balance_paise: 8500000, // ₹85,000.00
    payment_terms_days: 30,
    pan: 'AABCS7712H',
    contact_person: 'Dr. Anand Kulkarni',
    address_line1: 'Near Civil Hospital, Trimbak Road',
    city: 'Nashik',
    pincode: '422002',
    billing_address: 'Near Civil Hospital, Trimbak Road, Nashik, MH - 422002',
    shipping_address: 'Near Civil Hospital, Trimbak Road, Nashik, MH - 422002',
  },
  {
    id: 'ent_b2b_009',
    entity_code: 'CUST-B2B-09',
    entity_type: 'CUSTOMER',
    full_name: 'Tamil Nadu Consumer Goods Corp Pvt Ltd',
    trade_name: 'TNCG Corporation',
    gstin: '33AABCT8812J1Z1', // Tamil Nadu (Inter-state IGST)
    phone: '+91 98400 99881',
    email: 'accounts@tncgcorp.com',
    state_code: '33', // Tamil Nadu
    is_active: true,
    credit_limit_paise: 60000000, // ₹6,00,000.00
    current_balance_paise: 44000000, // ₹4,40,000.00
    payment_terms_days: 45,
    pan: 'AABCT8812J',
    contact_person: 'Senthil Nathan (Director)',
    address_line1: 'No 45, Ambattur Industrial Estate',
    city: 'Chennai',
    pincode: '600058',
    billing_address: 'No 45, Ambattur Industrial Estate, Chennai, TN - 600058',
    shipping_address: 'Warehouse Block C, Madhavaram Logistics Park, Chennai, TN - 600060',
  },
  {
    id: 'ent_b2b_010',
    entity_code: 'CUST-B2B-10',
    entity_type: 'CUSTOMER',
    full_name: 'Western India Confectionery & Beverage Hub',
    trade_name: 'Western Beverages Surat',
    gstin: '24AABCW9912K1Z8', // Gujarat (Inter-state IGST)
    phone: '+91 98241 22330',
    email: 'western.beverages@yahoo.com',
    state_code: '24', // Gujarat
    is_active: true,
    credit_limit_paise: 25000000, // ₹2,50,000.00
    current_balance_paise: 14200000, // ₹1,42,000.00
    payment_terms_days: 30,
    pan: 'AABCW9912K',
    contact_person: 'Pankaj Vora',
    address_line1: 'Ring Road, Near Surat Textile Market',
    city: 'Surat',
    pincode: '395002',
    billing_address: 'Ring Road, Near Surat Textile Market, Surat, GJ - 395002',
    shipping_address: 'Ring Road, Near Surat Textile Market, Surat, GJ - 395002',
  },
  {
    id: 'ent_b2b_011',
    entity_code: 'CUST-B2B-11',
    entity_type: 'CUSTOMER',
    full_name: 'Kothari Grain & Spices Merchant',
    trade_name: 'Kothari Merchants',
    gstin: '27AABCK3312L1Z5',
    phone: '+91 94222 11990',
    email: 'kotharigrain@gmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 18000000, // ₹1,80,000.00
    current_balance_paise: 11000000, // ₹1,10,000.00
    payment_terms_days: 15,
    pan: 'AABCK3312L',
    contact_person: 'Pravin Kothari',
    address_line1: 'Mondha Grain Market, Station Road',
    city: 'Chhatrapati Sambhajinagar',
    pincode: '431001',
    billing_address: 'Mondha Grain Market, Station Road, Chhatrapati Sambhajinagar, MH - 431001',
    shipping_address: 'Mondha Grain Market, Station Road, Chhatrapati Sambhajinagar, MH - 431001',
  },
  {
    id: 'ent_b2b_012',
    entity_code: 'CUST-B2B-12',
    entity_type: 'CUSTOMER',
    full_name: 'Eastern Agro-Commodity Traders Ltd',
    trade_name: 'Eastern Agro',
    gstin: '19AABCE2212M1Z2', // West Bengal (Inter-state IGST)
    phone: '+91 98300 44551',
    email: 'sales@easternagro.co.in',
    state_code: '19', // West Bengal
    is_active: true,
    credit_limit_paise: 45000000, // ₹4,50,000.00
    current_balance_paise: 31000000, // ₹3,10,000.00
    payment_terms_days: 45,
    pan: 'AABCE2212M',
    contact_person: 'Debashis Roy',
    address_line1: 'Brabourne Road, Posta Wholesale Area',
    city: 'Kolkata',
    pincode: '700001',
    billing_address: 'Brabourne Road, Posta Wholesale Area, Kolkata, WB - 700001',
    shipping_address: 'Dankuni Logistics Complex, Hooghly, WB - 712311',
  },
  {
    id: 'ent_b2b_013',
    entity_code: 'CUST-B2B-13',
    entity_type: 'CUSTOMER',
    full_name: 'Vidarbha Trade Links Pvt Ltd',
    trade_name: 'Vidarbha Links',
    gstin: '27AABCV1112N1Z9',
    phone: '+91 94228 77661',
    email: 'vidarbhatradelinks@rediffmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 12000000, // ₹1,20,000.00
    current_balance_paise: 5200000, // ₹52,000.00
    payment_terms_days: 21,
    pan: 'AABCV1112N',
    contact_person: 'Sanjay Deshpande',
    address_line1: 'Badnera Road, Near MIDC',
    city: 'Amravati',
    pincode: '444607',
    billing_address: 'Badnera Road, Near MIDC, Amravati, MH - 444607',
    shipping_address: 'Badnera Road, Near MIDC, Amravati, MH - 444607',
  },
  {
    id: 'ent_b2b_014',
    entity_code: 'CUST-B2B-14',
    entity_type: 'CUSTOMER',
    full_name: 'Malwa Food Products & Distribution',
    trade_name: 'Malwa Foods Indore',
    gstin: '23AABCM6612P1Z6', // Madhya Pradesh (Inter-state IGST)
    phone: '+91 98260 88991',
    email: 'malwafoods@indoretrading.com',
    state_code: '23', // Madhya Pradesh
    is_active: true,
    credit_limit_paise: 28000000, // ₹2,80,000.00
    current_balance_paise: 19400000, // ₹1,94,000.00
    payment_terms_days: 30,
    pan: 'AABCM6612P',
    contact_person: 'Ashok Garg',
    address_line1: 'Sanwer Road Industrial Area, Sector C',
    city: 'Indore',
    pincode: '452015',
    billing_address: 'Sanwer Road Industrial Area, Sector C, Indore, MP - 452015',
    shipping_address: 'Sanwer Road Industrial Area, Sector C, Indore, MP - 452015',
  },
  {
    id: 'ent_b2b_015',
    entity_code: 'CUST-B2B-15',
    entity_type: 'CUSTOMER',
    full_name: 'Konkan Coastal Supplies & Fisheries',
    trade_name: 'Konkan Supplies',
    gstin: '27AABCK5512Q1Z3',
    phone: '+91 94223 99881',
    email: 'konkansupplies@gmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 10000000, // ₹1,00,000.00
    current_balance_paise: 3800000, // ₹38,000.00
    payment_terms_days: 15,
    pan: 'AABCK5512Q',
    contact_person: 'Ganesh Sawant',
    address_line1: 'Mirya Bunder Road, Near Fishing Jetty',
    city: 'Ratnagiri',
    pincode: '415612',
    billing_address: 'Mirya Bunder Road, Near Fishing Jetty, Ratnagiri, MH - 415612',
    shipping_address: 'Mirya Bunder Road, Near Fishing Jetty, Ratnagiri, MH - 415612',
  },
  {
    id: 'ent_b2b_016',
    entity_code: 'CUST-B2B-16',
    entity_type: 'CUSTOMER',
    full_name: 'Northern Star Retail Chain Pvt Ltd',
    trade_name: 'Northern Star Mart',
    gstin: '09AABCN7712R1Z0', // Uttar Pradesh (Inter-state IGST)
    phone: '+91 94150 11990',
    email: 'purchase@northernstarmart.com',
    state_code: '09', // Uttar Pradesh
    is_active: true,
    credit_limit_paise: 55000000, // ₹5,50,000.00
    current_balance_paise: 38000000, // ₹3,80,000.00
    payment_terms_days: 45,
    pan: 'AABCN7712R',
    contact_person: 'Anurag Srivastava',
    address_line1: 'Plot 12, Transport Nagar Phase 2',
    city: 'Lucknow',
    pincode: '226012',
    billing_address: 'Plot 12, Transport Nagar Phase 2, Lucknow, UP - 226012',
    shipping_address: 'Plot 12, Transport Nagar Phase 2, Lucknow, UP - 226012',
  },
  {
    id: 'ent_b2b_017',
    entity_code: 'CUST-B2B-17',
    entity_type: 'CUSTOMER',
    full_name: 'Kolhapur Jaggery & Agro Depot',
    trade_name: 'Kolhapur Agro Depot',
    gstin: '27AABCK8812S1Z7',
    phone: '+91 94220 33221',
    email: 'agrodepot.kop@gmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 15000000, // ₹1,50,000.00
    current_balance_paise: 7100000, // ₹71,000.00
    payment_terms_days: 21,
    pan: 'AABCK8812S',
    contact_person: 'Babasaheb Patil',
    address_line1: 'Market Yard, Shahupuri Wholesale Market',
    city: 'Kolhapur',
    pincode: '416001',
    billing_address: 'Market Yard, Shahupuri Wholesale Market, Kolhapur, MH - 416001',
    shipping_address: 'Market Yard, Shahupuri Wholesale Market, Kolhapur, MH - 416001',
  },
  {
    id: 'ent_b2b_018',
    entity_code: 'CUST-B2B-18',
    entity_type: 'CUSTOMER',
    full_name: 'Rajasthan Desert Spice & Dry Fruits Hub',
    trade_name: 'Desert Spices',
    gstin: '08AABCR4412T1Z4', // Rajasthan (Inter-state IGST)
    phone: '+91 98290 55441',
    email: 'orders@desertspicesjaipur.com',
    state_code: '08', // Rajasthan
    is_active: true,
    credit_limit_paise: 32000000, // ₹3,20,000.00
    current_balance_paise: 16500000, // ₹1,65,000.00
    payment_terms_days: 30,
    pan: 'AABCR4412T',
    contact_person: 'Mohan Lal Sharma',
    address_line1: 'Surajpole Grain Mandi',
    city: 'Jaipur',
    pincode: '302003',
    billing_address: 'Surajpole Grain Mandi, Jaipur, RJ - 302003',
    shipping_address: 'VKI Industrial Area Road 9, Jaipur, RJ - 302013',
  },
  {
    id: 'ent_b2b_019',
    entity_code: 'CUST-B2B-19',
    entity_type: 'CUSTOMER',
    full_name: 'Goa Hospitality & Resort Wholesalers',
    trade_name: 'Goa Wholesalers',
    gstin: '30AABCG3312U1Z1', // Goa (Inter-state IGST)
    phone: '+91 98221 88771',
    email: 'procure@goawholesalers.com',
    state_code: '30', // Goa
    is_active: true,
    credit_limit_paise: 22000000, // ₹2,20,000.00
    current_balance_paise: 12900000, // ₹1,29,000.00
    payment_terms_days: 30,
    pan: 'AABCG3312U',
    contact_person: 'Antonio Fernandes',
    address_line1: 'Verna Industrial Estate, Phase 1',
    city: 'Panaji',
    pincode: '403722',
    billing_address: 'Verna Industrial Estate, Phase 1, Panaji, GA - 403722',
    shipping_address: 'Verna Industrial Estate, Phase 1, Panaji, GA - 403722',
  },
  {
    id: 'ent_b2b_020',
    entity_code: 'CUST-B2B-20',
    entity_type: 'CUSTOMER',
    full_name: 'Solapur Textile & Industrial Supplies',
    trade_name: 'Solapur Industrial Supplies',
    gstin: '27AABCS2212V1Z8',
    phone: '+91 94220 88112',
    email: 'solapur.supplies@gmail.com',
    state_code: '27', // Maharashtra
    is_active: true,
    credit_limit_paise: 16000000, // ₹1,60,000.00
    current_balance_paise: 9800000, // ₹98,000.00
    payment_terms_days: 21,
    pan: 'AABCS2212V',
    contact_person: 'Rameshwar Birajdar',
    address_line1: 'Hotgi Road, Near Railway Goods Shed',
    city: 'Solapur',
    pincode: '413003',
    billing_address: 'Hotgi Road, Near Railway Goods Shed, Solapur, MH - 413003',
    shipping_address: 'Hotgi Road, Near Railway Goods Shed, Solapur, MH - 413003',
  },
];

// ----------------------------------------------------------------------------
// 2. WHOLESALE VOLUME DISCOUNT & PRICING SLABS
// ----------------------------------------------------------------------------
export const INITIAL_WHOLESALE_PRICING_RULES: WholesalePricingRule[] = [
  {
    id: 'tier_fmcg',
    category: 'FMCG & Groceries',
    tier_a_discount_bps: 400, // 4.0% discount for orders > 50 units
    tier_b_discount_bps: 700, // 7.0% discount for orders > 200 units
    min_bulk_units: 50,
    payment_credit_days: 30,
  },
  {
    id: 'tier_beverages',
    category: 'Beverages & Juices',
    tier_a_discount_bps: 500, // 5.0% discount for orders > 100 cases
    tier_b_discount_bps: 850, // 8.5% discount for orders > 500 cases
    min_bulk_units: 100,
    payment_credit_days: 30,
  },
  {
    id: 'tier_staples',
    category: 'Spices, Pulses & Grains',
    tier_a_discount_bps: 300, // 3.0% discount for orders > 25 bags
    tier_b_discount_bps: 600, // 6.0% discount for orders > 100 bags
    min_bulk_units: 25,
    payment_credit_days: 15,
  },
  {
    id: 'tier_personal_care',
    category: 'Personal Care & Hygiene',
    tier_a_discount_bps: 600, // 6.0% discount for orders > 60 units
    tier_b_discount_bps: 1000, // 10.0% discount for orders > 250 units
    min_bulk_units: 60,
    payment_credit_days: 45,
  },
];

// ----------------------------------------------------------------------------
// 3. SEEDED WHOLESALE LOGISTICS & WAREHOUSE EXPENSES
// ----------------------------------------------------------------------------
export const INITIAL_WHOLESALE_EXPENSES: WholesaleExpense[] = [
  {
    id: 'exp_wh_001',
    date: '2026-10-20',
    payee: 'Bharat Petroleum Highway Fleet Services',
    category: 'DIESEL_FLEET',
    amount_paise: 3800000, // ₹38,000
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'EXP-DSL-4412',
    remarks: 'Bulk diesel fueling for 4 Ashok Leyland 16-wheeler container trucks (Mumbai-Pune-Ahmedabad route)',
  },
  {
    id: 'exp_wh_002',
    date: '2026-10-19',
    payee: 'VRL Fastag & National Highway Tollway Authority',
    category: 'TOLL_CHARGES',
    amount_paise: 1450000, // ₹14,500
    payment_mode: 'BANK_TRANSFER',
    voucher_no: 'EXP-TOLL-9912',
    remarks: 'Electronic FASTag monthly reload for NH-48 and Samruddhi Mahamarg transit fleets',
  },
  {
    id: 'exp_wh_003',
    date: '2026-10-18',
    payee: 'Bhiwandi Pallet Wrap & Corrugation Mills',
    category: 'PALLET_PACKAGING',
    amount_paise: 920000, // ₹9,200
    payment_mode: 'UPI',
    voucher_no: 'EXP-PACK-7712',
    remarks: 'Industrial heavy-duty stretch film rolls (50 rolls) & wooden cargo pallets (30 units)',
  },
  {
    id: 'exp_wh_004',
    date: '2026-10-17',
    payee: 'Maharashtra Mathadi & Hamali Labour Union',
    category: 'LOADING_LABOUR',
    amount_paise: 1140000, // ₹11,400
    payment_mode: 'CASH',
    voucher_no: 'EXP-HML-1102',
    remarks: 'Unloading of 2,400 cartons from Tata Tea and Hindustan Unilever railway rakes',
  },
  {
    id: 'exp_wh_005',
    date: '2026-10-16',
    payee: 'Godrej Material Handling Forklift AMC',
    category: 'WAREHOUSE_RENT',
    amount_paise: 680000, // ₹6,800
    payment_mode: 'UPI',
    voucher_no: 'EXP-FRK-8812',
    remarks: 'Hydraulic oil replacement & battery maintenance for 2.5-ton electric reach truck',
  },
];

// ----------------------------------------------------------------------------
// 4. DEFAULT WHOLESALE TAX INVOICE & WATERMARK SETTINGS
// ----------------------------------------------------------------------------
export const DEFAULT_WHOLESALE_INVOICE_SETTINGS: WholesaleInvoiceSettings = {
  company_name: 'OmniBill Wholesale & Logistics Corporation Ltd',
  trade_name: 'OmniBill B2B Distribution Hub',
  gstin: '27AABCO1928K1Z5',
  pan: 'AABCO1928K',
  cin_no: 'U51909MH2024PLC389124',
  address: 'Warehouse Hub 5, Logistics Park, Mumbai-Nashik Highway, Bhiwandi, Thane, MH - 421302',
  phone: '+91 (02522) 289-441 / +91 98200 44550',
  email: 'b2b-billing@omnibill.com • www.omnibill.com',
  bank_name: 'HDFC Bank Limited',
  account_number: '50200048192841',
  ifsc_code: 'HDFC0000123',
  branch: 'Kanjurmarg Commercial Branch, Mumbai',
  upi_id: 'omnibill.b2b@hdfcbank',
  logo_url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=120&auto=format&fit=crop&q=80',
  show_watermark: true,
  watermark_text: 'TAX INVOICE',
  watermark_opacity: 0.08,
  declaration:
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. e-Way Bill generated wherever statutory value exceeds ₹50,000/-.',
  terms_conditions:
    '1. Goods once sold will not be taken back or exchanged.\n2. Interest @ 18% p.a. will be charged if payment is not received within agreed credit terms.\n3. All disputes subject to Thane/Mumbai jurisdiction.',
  show_authorised_signatory: true,
};

// ----------------------------------------------------------------------------
// 5. SEEDED RECENT WHOLESALE INVOICE AUDIT LOGS
// ----------------------------------------------------------------------------
export const INITIAL_WHOLESALE_INVOICES: WholesaleInvoiceRecord[] = [
  {
    id: 'wh_inv_001',
    invoice_number: 'B2B-2026-4401',
    date: '2026-10-21',
    customer_id: 'ent_b2b_001',
    customer_name: 'Metro MegaMart Distributors Pvt Ltd',
    customer_gstin: '27AABCU9603R1ZM',
    state_code: '27',
    is_interstate: false,
    subtotal_paise: 8850000,
    discount_paise: 350000,
    cgst_paise: 425000,
    sgst_paise: 425000,
    igst_paise: 0,
    round_off_paise: 0,
    total_paise: 9350000,
    eway_bill_no: '281900412891',
    vehicle_number: 'MH-12-QW-4412',
    payment_mode: 'BANK_TRANSFER',
    payment_status: 'PAID',
    due_date: '2026-11-20',
    staff_name: 'Manager S. Rathore',
  },
  {
    id: 'wh_inv_002',
    invoice_number: 'B2B-2026-4402',
    date: '2026-10-21',
    customer_id: 'ent_b2b_003',
    customer_name: 'Bharat Wholesale Agencies (New Delhi)',
    customer_gstin: '07AAAAA0000A1Z5',
    state_code: '07',
    is_interstate: true,
    subtotal_paise: 12500000,
    discount_paise: 500000,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 1200000,
    round_off_paise: 0,
    total_paise: 13200000,
    eway_bill_no: '281900413004',
    vehicle_number: 'DL-01-AB-9812',
    payment_mode: 'BANK_TRANSFER',
    payment_status: 'CREDIT',
    due_date: '2026-12-05',
    staff_name: 'Logistics Head Verma',
  },
  {
    id: 'wh_inv_003',
    invoice_number: 'B2B-2026-4403',
    date: '2026-10-20',
    customer_id: 'ent_b2b_002',
    customer_name: 'Apex Supermarket & Retail Traders',
    customer_gstin: '27AADCA3412B1Z8',
    state_code: '27',
    is_interstate: false,
    subtotal_paise: 4400000,
    discount_paise: 150000,
    cgst_paise: 212500,
    sgst_paise: 212500,
    igst_paise: 0,
    round_off_paise: 0,
    total_paise: 4675000,
    payment_mode: 'UPI',
    payment_status: 'PAID',
    due_date: '2026-11-04',
    staff_name: 'Billing Exec Kulkarni',
  },
];

// ----------------------------------------------------------------------------
// 5.5 SEEDED WHOLESALE INVENTORY & BULK GOODS STOCK (15 TRADE COMMODITIES)
// ----------------------------------------------------------------------------
export const INITIAL_WHOLESALE_STOCK: WholesaleStockItem[] = [
  {
    id: 'wh_stk_001',
    sku: 'OIL-FORT-15L',
    name: 'Fortune Sunlite Refined Sunflower Oil 15L Commercial Tin',
    category: 'Edible Oils & Fats',
    unit: 'tin',
    current_stock: 450,
    purchase_rate_paise: 185000, // ₹1,850.00 purchase rate from mill
    wholesale_rate_paise: 205000, // ₹2,050.00 wholesale dispatch rate
    mrp_paise: 235000,
    reorder_level: 100,
  },
  {
    id: 'wh_stk_002',
    sku: 'RICE-DAAWAT-25K',
    name: 'Daawat Rozana Super Basmati Rice 25kg Woven Bag',
    category: 'Staples & Grains',
    unit: 'bag',
    current_stock: 600,
    purchase_rate_paise: 210000, // ₹2,100.00
    wholesale_rate_paise: 235000, // ₹2,350.00
    mrp_paise: 275000,
    reorder_level: 150,
  },
  {
    id: 'wh_stk_003',
    sku: 'ATTA-AASH-10K',
    name: 'Aashirvaad Shudh Chakki Whole Wheat Atta 10kg Bag',
    category: 'Staples & Grains',
    unit: 'bag',
    current_stock: 550,
    purchase_rate_paise: 38000, // ₹380.00
    wholesale_rate_paise: 42500, // ₹425.00
    mrp_paise: 49000,
    reorder_level: 120,
  },
  {
    id: 'wh_stk_004',
    sku: 'SUGAR-M30-50K',
    name: 'Refined White Sulphurless Sugar Grade M-30 50kg Jute Gunny',
    category: 'Staples & Grains',
    unit: 'bag',
    current_stock: 380,
    purchase_rate_paise: 195000, // ₹1,950.00
    wholesale_rate_paise: 215000, // ₹2,150.00
    mrp_paise: 245000,
    reorder_level: 80,
  },
  {
    id: 'wh_stk_005',
    sku: 'COKE-2L-CS9',
    name: 'Coca Cola Soft Drink 2.25L PET (Case of 9 Bottles)',
    category: 'Beverages & Syrups',
    unit: 'case',
    current_stock: 300,
    purchase_rate_paise: 62000, // ₹620.00
    wholesale_rate_paise: 72000, // ₹720.00
    mrp_paise: 85500,
    reorder_level: 60,
  },
  {
    id: 'wh_stk_006',
    sku: 'MAGGI-70-CT96',
    name: 'Nestle Maggi 2-Minute Noodles 70g (Master Carton of 96)',
    category: 'Packaged Foods & Snacks',
    unit: 'carton',
    current_stock: 420,
    purchase_rate_paise: 108000, // ₹1,080.00
    wholesale_rate_paise: 122000, // ₹1,220.00
    mrp_paise: 134400,
    reorder_level: 90,
  },
  {
    id: 'wh_stk_007',
    sku: 'PARLE-G-CT120',
    name: 'Parle-G Glucose Biscuits 100g (Master Box of 120 Packets)',
    category: 'Packaged Foods & Snacks',
    unit: 'box',
    current_stock: 500,
    purchase_rate_paise: 95000, // ₹950.00
    wholesale_rate_paise: 108000, // ₹1,080.00
    mrp_paise: 120000,
    reorder_level: 100,
  },
  {
    id: 'wh_stk_008',
    sku: 'TEA-TATA-1K-CT24',
    name: 'Tata Tea Gold Leaf Tea 1kg Pouch (Carton of 24 Pouches)',
    category: 'Beverages & Syrups',
    unit: 'carton',
    current_stock: 180,
    purchase_rate_paise: 1150000, // ₹11,500.00
    wholesale_rate_paise: 1280000, // ₹12,800.00
    mrp_paise: 1440000,
    reorder_level: 40,
  },
  {
    id: 'wh_stk_009',
    sku: 'SURF-EXCEL-6K',
    name: 'Surf Excel Matic Front Load Powder 6kg Sealed Bucket',
    category: 'Soaps & Detergents',
    unit: 'bucket',
    current_stock: 240,
    purchase_rate_paise: 128000, // ₹1,280.00
    wholesale_rate_paise: 145000, // ₹1,450.00
    mrp_paise: 169900,
    reorder_level: 50,
  },
  {
    id: 'wh_stk_010',
    sku: 'DETTOL-5L-CAN',
    name: 'Dettol Antiseptic Liquid Disinfectant 5 Litre Industrial Can',
    category: 'Personal Care & Hygiene',
    unit: 'can',
    current_stock: 150,
    purchase_rate_paise: 145000, // ₹1,450.00
    wholesale_rate_paise: 165000, // ₹1,650.00
    mrp_paise: 195000,
    reorder_level: 30,
  },
  {
    id: 'wh_stk_011',
    sku: 'COLGATE-150-CS72',
    name: 'Colgate Strong Teeth Toothpaste 150g (Case of 72 Tubes)',
    category: 'Personal Care & Hygiene',
    unit: 'case',
    current_stock: 220,
    purchase_rate_paise: 640000, // ₹6,400.00
    wholesale_rate_paise: 720000, // ₹7,200.00
    mrp_paise: 828000,
    reorder_level: 40,
  },
  {
    id: 'wh_stk_012',
    sku: 'SALT-TATA-1K-BG50',
    name: 'Tata Salt Vacuum Evaporated Iodised 1kg (Bundle of 50)',
    category: 'Staples & Grains',
    unit: 'bundle',
    current_stock: 400,
    purchase_rate_paise: 105000, // ₹1,050.00
    wholesale_rate_paise: 118000, // ₹1,180.00
    mrp_paise: 140000,
    reorder_level: 80,
  },
  {
    id: 'wh_stk_013',
    sku: 'DOVE-SOAP-CS48',
    name: 'Dove White Beauty Moisture Bar 100g (Pack of 4, Case of 48)',
    category: 'Personal Care & Hygiene',
    unit: 'case',
    current_stock: 190,
    purchase_rate_paise: 820000, // ₹8,200.00
    wholesale_rate_paise: 940000, // ₹9,400.00
    mrp_paise: 1104000,
    reorder_level: 35,
  },
  {
    id: 'wh_stk_014',
    sku: 'RED-BULL-CS24',
    name: 'Red Bull Energy Drink 250ml Slim Can (Case of 24 Cans)',
    category: 'Beverages & Syrups',
    unit: 'case',
    current_stock: 210,
    purchase_rate_paise: 245000, // ₹2,450.00
    wholesale_rate_paise: 280000, // ₹2,800.00
    mrp_paise: 312000,
    reorder_level: 50,
  },
  {
    id: 'wh_stk_015',
    sku: 'AMUL-BUTTER-100-CS40',
    name: 'Amul Pasteurised Salted Butter 100g (Cold-Chain Case of 40)',
    category: 'Dairy & Cold Chain',
    unit: 'case',
    current_stock: 160,
    purchase_rate_paise: 195000, // ₹1,950.00
    wholesale_rate_paise: 218000, // ₹2,180.00
    mrp_paise: 240000,
    reorder_level: 35,
  },
];

// ----------------------------------------------------------------------------
// 6. STORAGE KEYS & PERSISTENCE HELPER SERVICE
// ----------------------------------------------------------------------------
const STORAGE_KEYS = {
  CUSTOMERS: 'omnibill_wholesale_customers_v2',
  PRICING: 'omnibill_wholesale_pricing_v2',
  EXPENSES: 'omnibill_wholesale_expenses_v2',
  SETTINGS: 'omnibill_wholesale_settings_v2',
  INVOICES: 'omnibill_wholesale_invoices_v2',
  WHOLESALE_STOCK: 'omnibill_wholesale_stock_v2',
  PURCHASE_VOUCHERS: 'omnibill_wholesale_purchase_vouchers_v2',
};

export class WholesaleDataService {
  // Customers
  static getCustomers(): WholesaleCustomer[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length >= INITIAL_WHOLESALE_CUSTOMERS.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse wholesale customers from localStorage:', e);
    }
    this.saveCustomers(INITIAL_WHOLESALE_CUSTOMERS);
    return INITIAL_WHOLESALE_CUSTOMERS;
  }

  static saveCustomers(customers: WholesaleCustomer[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
    } catch (e) {
      console.error('Failed to save wholesale customers:', e);
    }
  }

  static addCustomer(customer: WholesaleCustomer): WholesaleCustomer[] {
    const list = this.getCustomers();
    const updated = [customer, ...list];
    this.saveCustomers(updated);
    return updated;
  }

  // Pricing Rules
  static getPricingRules(): WholesalePricingRule[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PRICING);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse wholesale pricing rules:', e);
    }
    this.savePricingRules(INITIAL_WHOLESALE_PRICING_RULES);
    return INITIAL_WHOLESALE_PRICING_RULES;
  }

  static savePricingRules(rules: WholesalePricingRule[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PRICING, JSON.stringify(rules));
    } catch (e) {
      console.error('Failed to save wholesale pricing rules:', e);
    }
  }

  // Expenses
  static getExpenses(): WholesaleExpense[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.EXPENSES);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse wholesale expenses:', e);
    }
    this.saveExpenses(INITIAL_WHOLESALE_EXPENSES);
    return INITIAL_WHOLESALE_EXPENSES;
  }

  static saveExpenses(expenses: WholesaleExpense[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
    } catch (e) {
      console.error('Failed to save wholesale expenses:', e);
    }
  }

  static addExpense(expense: WholesaleExpense): WholesaleExpense[] {
    const list = this.getExpenses();
    const updated = [expense, ...list];
    this.saveExpenses(updated);
    return updated;
  }

  // Settings
  static getInvoiceSettings(): WholesaleInvoiceSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse wholesale invoice settings:', e);
    }
    this.saveInvoiceSettings(DEFAULT_WHOLESALE_INVOICE_SETTINGS);
    return DEFAULT_WHOLESALE_INVOICE_SETTINGS;
  }

  static saveInvoiceSettings(settings: WholesaleInvoiceSettings): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save wholesale invoice settings:', e);
    }
  }

  // Invoices / Audit History
  static getInvoices(): WholesaleInvoiceRecord[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.INVOICES);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse wholesale invoices:', e);
    }
    this.saveInvoices(INITIAL_WHOLESALE_INVOICES);
    return INITIAL_WHOLESALE_INVOICES;
  }

  static saveInvoices(invoices: WholesaleInvoiceRecord[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
    } catch (e) {
      console.error('Failed to save wholesale invoices:', e);
    }
  }

  static recordInvoice(invoice: WholesaleInvoiceRecord): WholesaleInvoiceRecord[] {
    const list = this.getInvoices();
    const updated = [invoice, ...list];
    this.saveInvoices(updated);
    return updated;
  }

  // Wholesale Inventory Stock
  static getWholesaleStock(): WholesaleStockItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.WHOLESALE_STOCK);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length >= INITIAL_WHOLESALE_STOCK.length) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse wholesale stock:', e);
    }
    this.saveWholesaleStock(INITIAL_WHOLESALE_STOCK);
    return INITIAL_WHOLESALE_STOCK;
  }

  static saveWholesaleStock(items: WholesaleStockItem[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.WHOLESALE_STOCK, JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save wholesale stock:', e);
    }
  }

  static addWholesaleStockItem(item: WholesaleStockItem): WholesaleStockItem[] {
    const list = this.getWholesaleStock();
    const updated = [item, ...list];
    this.saveWholesaleStock(updated);
    return updated;
  }

  // Inward Purchase Vouchers History
  static getPurchaseVouchers(): PurchaseExpenseVoucher[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.PURCHASE_VOUCHERS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn('Failed to parse wholesale purchase vouchers:', e);
    }
    return [];
  }

  static savePurchaseVouchers(vouchers: PurchaseExpenseVoucher[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.PURCHASE_VOUCHERS, JSON.stringify(vouchers));
    } catch (e) {
      console.error('Failed to save wholesale purchase vouchers:', e);
    }
  }

  // Inward Bulk Consignment, increment stock, update purchase rate, generate GRN Expense Bill
  static inwardWholesaleStock(purchase: {
    supplierName: string;
    supplierGstin?: string;
    supplierPhone?: string;
    invoiceDate: string;
    voucherNumber: string;
    paymentMode: 'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI';
    remarks?: string;
    lines: Array<{
      itemId: string;
      quantity: number;
      purchaseRatePaise: number;
    }>;
  }): PurchaseExpenseVoucher {
    const stock = this.getWholesaleStock();
    const voucherItems: Array<{
      name: string;
      sku: string;
      quantity: number;
      unit: string;
      costPricePaise: number;
      lineTotalPaise: number;
    }> = [];

    let totalExpensePaise = 0;

    purchase.lines.forEach((line) => {
      const item = stock.find((s) => s.id === line.itemId);
      if (item) {
        item.current_stock += line.quantity;
        item.purchase_rate_paise = line.purchaseRatePaise;
        const lineTotal = line.quantity * line.purchaseRatePaise;
        totalExpensePaise += lineTotal;
        voucherItems.push({
          name: item.name,
          sku: item.sku,
          quantity: line.quantity,
          unit: item.unit,
          costPricePaise: line.purchaseRatePaise,
          lineTotalPaise: lineTotal,
        });
      }
    });

    this.saveWholesaleStock(stock);

    const settings = this.getInvoiceSettings();
    const voucher: PurchaseExpenseVoucher = {
      voucherNumber: purchase.voucherNumber,
      invoiceDate: purchase.invoiceDate,
      supplierName: purchase.supplierName,
      supplierGstin: purchase.supplierGstin,
      supplierPhone: purchase.supplierPhone,
      businessName: settings.company_name || 'OmniWholesale Distribution Hub',
      businessGstin: settings.gstin,
      businessAddress: settings.address,
      paymentMode: purchase.paymentMode,
      remarks: purchase.remarks,
      items: voucherItems,
      totalExpensePaise,
      verticalType: 'WHOLESALE',
    };

    const pastVouchers = this.getPurchaseVouchers();
    this.savePurchaseVouchers([voucher, ...pastVouchers]);

    // Also automatically log as a wholesale logistics/inward expense
    this.addExpense({
      id: 'exp_wh_' + Date.now(),
      date: purchase.invoiceDate,
      payee: purchase.supplierName,
      category: 'FREIGHT_LOGISTICS',
      amount_paise: totalExpensePaise,
      payment_mode: purchase.paymentMode,
      voucher_no: purchase.voucherNumber,
      remarks: `Bulk stock inward of ${voucherItems.length} commodities: ${voucherItems.map((i) => i.name).slice(0, 2).join(', ')}`,
    });

    return voucher;
  }
}

// ----------------------------------------------------------------------------
// 7. EXPORT & SHARING HELPERS (CSV, WHATSAPP, GSTR-1 B2B)
// ----------------------------------------------------------------------------
export const exportWholesaleInvoicesToCSV = (invoices: WholesaleInvoiceRecord[]): void => {
  const headers = [
    'Invoice No',
    'Date',
    'Buyer Name',
    'GSTIN',
    'State Code',
    'Place of Supply',
    'Taxable Subtotal (INR)',
    'Trade Discount (INR)',
    'CGST (INR)',
    'SGST (INR)',
    'IGST (INR)',
    'Invoice Total (INR)',
    'e-Way Bill No',
    'Vehicle No',
    'Payment Status',
    'Due Date',
  ];

  const rows = invoices.map((inv) => [
    `"${inv.invoice_number}"`,
    `"${inv.date}"`,
    `"${inv.customer_name.replace(/"/g, '""')}"`,
    `"${inv.customer_gstin}"`,
    `"${inv.state_code}"`,
    inv.is_interstate ? '"INTER-STATE"' : '"INTRA-STATE"',
    (inv.subtotal_paise / 100).toFixed(2),
    (inv.discount_paise / 100).toFixed(2),
    (inv.cgst_paise / 100).toFixed(2),
    (inv.sgst_paise / 100).toFixed(2),
    (inv.igst_paise / 100).toFixed(2),
    (inv.total_paise / 100).toFixed(2),
    `"${inv.eway_bill_no || '-'}"`,
    `"${inv.vehicle_number || '-'}"`,
    `"${inv.payment_status}"`,
    `"${inv.due_date}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Wholesale_B2B_Sales_Register_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const exportCustomersToCSV = (customers: WholesaleCustomer[]): void => {
  const headers = [
    'Customer Code',
    'Trade Name',
    'Legal Name',
    'GSTIN',
    'PAN',
    'State Code',
    'Credit Limit (INR)',
    'Current Balance (INR)',
    'Available Credit (INR)',
    'Credit Days',
    'Contact Person',
    'Phone',
    'City',
  ];

  const rows = customers.map((c) => [
    `"${c.entity_code}"`,
    `"${(c.trade_name || '').replace(/"/g, '""')}"`,
    `"${c.full_name.replace(/"/g, '""')}"`,
    `"${c.gstin || '-'}"`,
    `"${c.pan || '-'}"`,
    `"${c.state_code}"`,
    (c.credit_limit_paise / 100).toFixed(2),
    (c.current_balance_paise / 100).toFixed(2),
    (Math.max(0, c.credit_limit_paise - c.current_balance_paise) / 100).toFixed(2),
    c.payment_terms_days || 30,
    `"${(c.contact_person || '').replace(/"/g, '""')}"`,
    `"${c.phone || '-'}"`,
    `"${c.city || '-'}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `B2B_Customer_Master_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const generateWholesaleDayBookWhatsAppLink = (
  date: string,
  totalSalesPaise: number,
  invoicesCount: number,
  ewayCount: number
): string => {
  const text = encodeURIComponent(
    `📦 *OMNIBILL B2B WHOLESALE & DISTRIBUTION — DAILY DISPATCH LOG*\n` +
      `📅 *Date:* ${date}\n` +
      `🚚 *Total Invoices Dispatched:* ${invoicesCount}\n` +
      `📋 *e-Way Bills Generated:* ${ewayCount}\n` +
      `💰 *Total B2B Billing Value:* ₹${(totalSalesPaise / 100).toLocaleString('en-IN')}\n\n` +
      `✅ *All outward supply movements, e-Way bills & ledger credit postings verified.*`
  );
  return `https://wa.me/?text=${text}`;
};

export const generateB2BInvoiceWhatsAppLink = (
  customer: WholesaleCustomer,
  invoiceNo: string,
  totalPaise: number,
  ewayBillNo?: string,
  dueDate?: string
): string => {
  const cleanPhone = (customer.phone || '').replace(/[^0-9]/g, '');
  const targetPhone = cleanPhone.startsWith('91') ? cleanPhone : cleanPhone.length === 10 ? `91${cleanPhone}` : '';

  const text = encodeURIComponent(
    `📦 *OMNIBILL B2B DISTRIBUTION*\n` +
      `Dear *${customer.trade_name || customer.full_name}*,\n` +
      `Tax Invoice *#${invoiceNo}* has been issued for your outward shipment.\n\n` +
      `💰 *Invoice Total:* ₹${(totalPaise / 100).toLocaleString('en-IN')}\n` +
      (ewayBillNo ? `🚚 *e-Way Bill No:* ${ewayBillNo}\n` : '') +
      (dueDate ? `📅 *Payment Due Date:* ${dueDate}\n` : '') +
      `🏦 *Payment Mode:* RTGS / NEFT / HDFC Virtual A/c\n\n` +
      `Thank you for your business!`
  );

  return targetPhone ? `https://wa.me/${targetPhone}?text=${text}` : `https://wa.me/?text=${text}`;
};
