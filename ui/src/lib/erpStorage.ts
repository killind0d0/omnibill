import {
  ResourceItem,
  ResourceLot,
  Entity,
  LedgerStatementRow,
  TrialBalanceAccount,
  DayBookEntry,
  DayBookSummary,
  Gstr1B2BInvoice,
  Gstr1B2CEntry,
  Gstr1HsnSummary,
  StockValuationItem,
  RecordPaymentPayload,
} from '../types/accounting';

const STORAGE_KEYS = {
  ITEMS: 'omnibill_items_v2',
  ENTITIES: 'omnibill_entities_v2',
  LEDGER: 'omnibill_ledger_v2',
  DAYBOOK: 'omnibill_daybook_v2',
  ACCOUNTS: 'omnibill_accounts_v2',
};

// Seed Items with Lots & Batches
const INITIAL_ITEMS: ResourceItem[] = [
  {
    id: 'res_01',
    sku: 'MED-DOLO-650',
    name: 'Paracetamol 650mg Dolo (Strip of 15 Tab)',
    hsn_sac: '3004',
    tax_rate_bps: 1200,
    base_price_paise: 3400, // ₹34.00
    cost_price_paise: 2200, // ₹22.00
    unit: 'STRIP',
    is_stock_tracked: true,
    reorder_level_milli: 50000, // 50 strips
    category: 'Pharmaceuticals',
    created_at: '2026-09-01T10:00:00Z',
    lots: [
      {
        id: 'lot_01_a',
        resource_id: 'res_01',
        batch_number: 'DL-24A01',
        expiry_date: '2026-11-15', // Near expiry (<30 days from mid-Oct)
        mrp_paise: 3800,
        cost_price_paise: 2200,
        current_stock_milli: 15000, // 15 strips
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'lot_01_b',
        resource_id: 'res_01',
        batch_number: 'DL-24F18',
        expiry_date: '2027-08-31',
        mrp_paise: 4000,
        cost_price_paise: 2300,
        current_stock_milli: 85000, // 85 strips
        created_at: '2026-09-15T11:00:00Z',
      },
    ],
  },
  {
    id: 'res_02',
    sku: 'MED-AMOX-500',
    name: 'Amoxicillin 500mg (Box of 10 Caps)',
    hsn_sac: '3004',
    tax_rate_bps: 1200,
    base_price_paise: 7500, // ₹75.00
    cost_price_paise: 5000, // ₹50.00
    unit: 'BOX',
    is_stock_tracked: true,
    reorder_level_milli: 30000, // 30 boxes
    category: 'Pharmaceuticals',
    created_at: '2026-09-02T10:00:00Z',
    lots: [
      {
        id: 'lot_02_a',
        resource_id: 'res_02',
        batch_number: 'AMX-23Z99',
        expiry_date: '2026-11-05', // Near expiry (16 days left!)
        mrp_paise: 8800,
        cost_price_paise: 5000,
        current_stock_milli: 12000, // 12 boxes (Below reorder 30!)
        created_at: '2026-09-02T10:00:00Z',
      },
    ],
  },
  {
    id: 'res_03',
    sku: 'GROC-BASMATI-5K',
    name: 'India Gate Classic Basmati Rice 5kg Bag',
    hsn_sac: '1006',
    tax_rate_bps: 500,
    base_price_paise: 55000, // ₹550.00
    cost_price_paise: 46000, // ₹460.00
    unit: 'BAG',
    is_stock_tracked: true,
    reorder_level_milli: 20000, // 20 bags
    category: 'Grocery & Staples',
    created_at: '2026-09-05T09:00:00Z',
    lots: [
      {
        id: 'lot_03_a',
        resource_id: 'res_03',
        batch_number: 'IG-2409-R',
        expiry_date: '2027-12-31',
        mrp_paise: 62000,
        cost_price_paise: 46000,
        current_stock_milli: 45000, // 45 bags
        created_at: '2026-09-05T09:00:00Z',
      },
    ],
  },
  {
    id: 'res_04',
    sku: 'DAIRY-AMUL-GHEE',
    name: 'Amul Pure Desi Ghee 1L Tin',
    hsn_sac: '0405',
    tax_rate_bps: 1200,
    base_price_paise: 61000, // ₹610.00
    cost_price_paise: 54000, // ₹540.00
    unit: 'TIN',
    is_stock_tracked: true,
    reorder_level_milli: 25000,
    category: 'Dairy Products',
    created_at: '2026-09-10T14:00:00Z',
    lots: [
      {
        id: 'lot_04_a',
        resource_id: 'res_04',
        batch_number: 'AG-902',
        expiry_date: '2027-04-15',
        mrp_paise: 68000,
        cost_price_paise: 54000,
        current_stock_milli: 32000, // 32 tins
        created_at: '2026-09-10T14:00:00Z',
      },
    ],
  },
  {
    id: 'res_05',
    sku: 'ELEC-SAM-25W',
    name: 'Samsung 25W Type-C Super Fast Power Adapter',
    hsn_sac: '8504',
    tax_rate_bps: 1800,
    base_price_paise: 99900, // ₹999.00
    cost_price_paise: 65000, // ₹650.00
    unit: 'PCS',
    is_stock_tracked: true,
    reorder_level_milli: 15000,
    category: 'Electronics & Mobiles',
    created_at: '2026-09-12T10:00:00Z',
    lots: [
      {
        id: 'lot_05_a',
        resource_id: 'res_05',
        batch_number: 'SAM-25W-24A',
        expiry_date: '2029-12-31',
        mrp_paise: 129900,
        cost_price_paise: 65000,
        current_stock_milli: 28000, // 28 pcs
        created_at: '2026-09-12T10:00:00Z',
      },
    ],
  },
  {
    id: 'res_06',
    sku: 'CONF-CAD-SILK',
    name: 'Cadbury Dairy Milk Silk Hazelnut 143g',
    hsn_sac: '1806',
    tax_rate_bps: 1800,
    base_price_paise: 16500, // ₹165.00
    cost_price_paise: 13000, // ₹130.00
    unit: 'BAR',
    is_stock_tracked: true,
    reorder_level_milli: 20000,
    category: 'Confectionery',
    created_at: '2026-09-14T12:00:00Z',
    lots: [
      {
        id: 'lot_06_a',
        resource_id: 'res_06',
        batch_number: 'CAD-HZ-02',
        expiry_date: '2026-11-02', // Near expiry (13 days left!)
        mrp_paise: 18500,
        cost_price_paise: 13000,
        current_stock_milli: 8000, // 8 bars (Low stock alert!)
        created_at: '2026-09-14T12:00:00Z',
      },
    ],
  },
  {
    id: 'res_07',
    sku: 'FMCG-SURF-2KG',
    name: 'Surf Excel Matic Front Load Powder 2kg Pack',
    hsn_sac: '3402',
    tax_rate_bps: 1800,
    base_price_paise: 42000, // ₹420.00
    cost_price_paise: 34000, // ₹340.00
    unit: 'PACK',
    is_stock_tracked: true,
    reorder_level_milli: 15000,
    category: 'Home Care',
    created_at: '2026-09-15T15:00:00Z',
    lots: [
      {
        id: 'lot_07_a',
        resource_id: 'res_07',
        batch_number: 'SE-FL-881',
        expiry_date: '2028-06-30',
        mrp_paise: 48000,
        cost_price_paise: 34000,
        current_stock_milli: 42000, // 42 packs
        created_at: '2026-09-15T15:00:00Z',
      },
    ],
  },
  {
    id: 'res_08',
    sku: 'STEEL-TATA-12MM',
    name: 'Tata Tiscon 550D TMT Rebar 12mm (Bundle)',
    hsn_sac: '7214',
    tax_rate_bps: 1800,
    base_price_paise: 485000, // ₹4,850.00
    cost_price_paise: 420000, // ₹4,200.00
    unit: 'BUNDLE',
    is_stock_tracked: true,
    reorder_level_milli: 10000, // 10 bundles
    category: 'Building Materials',
    created_at: '2026-09-18T16:00:00Z',
    lots: [
      {
        id: 'lot_08_a',
        resource_id: 'res_08',
        batch_number: 'TT-12-99',
        expiry_date: '2030-12-31',
        mrp_paise: 520000,
        cost_price_paise: 420000,
        current_stock_milli: 6000, // 6 bundles (Low stock alert!)
        created_at: '2026-09-18T16:00:00Z',
      },
    ],
  },
  {
    id: 'res_09',
    sku: 'AGRI-UREA-45KG',
    name: 'Neem Coated Agricultural Urea 45kg Bag',
    hsn_sac: '3102',
    tax_rate_bps: 500, // 5% GST on fertilizers
    base_price_paise: 26650, // ₹266.50
    cost_price_paise: 24200,
    unit: 'BAG',
    is_stock_tracked: true,
    reorder_level_milli: 50000,
    category: 'Agriculture',
    created_at: '2026-09-20T10:00:00Z',
    lots: [
      {
        id: 'lot_09_a',
        resource_id: 'res_09',
        batch_number: 'NCU-24-OCT',
        expiry_date: '2028-10-01',
        mrp_paise: 28500,
        cost_price_paise: 24200,
        current_stock_milli: 120000, // 120 bags
        created_at: '2026-09-20T10:00:00Z',
      },
    ],
  },
];

// Seed Entities (Customers & Suppliers)
const INITIAL_ENTITIES: Entity[] = [
  {
    id: 'ent_c01',
    entity_code: 'CUST-001',
    entity_type: 'CUSTOMER',
    full_name: 'Shree Ganesh Enterprises',
    phone: '9820198201',
    email: 'info@ganeshenterprises.in',
    gstin: '27AAACG1234F1Z8',
    state_code: '27', // Maharashtra
    address: 'Plot 42, MIDC Industrial Area, Andheri East, Mumbai 400093',
    opening_balance_paise: 4500000, // ₹45,000.00 Dr
    current_balance_paise: 4500000,
    is_active: true,
    created_at: '2026-08-01T09:00:00Z',
  },
  {
    id: 'ent_c02',
    entity_code: 'CUST-002',
    entity_type: 'CUSTOMER',
    full_name: 'Patel Supermarket LLP',
    phone: '9879198791',
    email: 'accounts@patelsupermarket.com',
    gstin: '24AAECP9876E1Z2',
    state_code: '24', // Gujarat (Inter-state)
    address: 'Shop 12-15, Sardar Complex, C.G. Road, Ahmedabad 380009',
    opening_balance_paise: 7850000, // ₹78,500.00 Dr
    current_balance_paise: 7850000,
    is_active: true,
    created_at: '2026-08-05T10:00:00Z',
  },
  {
    id: 'ent_c03',
    entity_code: 'CUST-003',
    entity_type: 'CUSTOMER',
    full_name: 'Sharma Retail & General Store',
    phone: '9811198111',
    email: 'sharma.retail@gmail.com',
    gstin: '07AAYCS5544D1Z9',
    state_code: '07', // Delhi (Inter-state)
    address: 'B-14, Connaught Place, New Delhi 110001',
    opening_balance_paise: 2420000, // ₹24,200.00 Dr
    current_balance_paise: 2420000,
    is_active: true,
    created_at: '2026-08-10T11:00:00Z',
  },
  {
    id: 'ent_c04',
    entity_code: 'CUST-004',
    entity_type: 'CUSTOMER',
    full_name: 'Walk-in Cash Retail Customer',
    phone: '9000000000',
    email: '',
    gstin: '',
    state_code: '27',
    address: 'Local Counter Sales, Pune',
    opening_balance_paise: 0,
    current_balance_paise: 0,
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'ent_c05',
    entity_code: 'CUST-005',
    entity_type: 'CUSTOMER',
    full_name: 'Apex MediCare Diagnostic Centre',
    phone: '9822098220',
    email: 'purchase@apexmedicare.org',
    gstin: '27AABCA7788K1Z5',
    state_code: '27',
    address: 'Apex Tower, Senapati Bapat Marg, Pune 411016',
    opening_balance_paise: 3660000, // ₹36,600.00 Dr
    current_balance_paise: 3660000,
    is_active: true,
    created_at: '2026-08-15T12:00:00Z',
  },
  {
    id: 'ent_s01',
    entity_code: 'SUPP-001',
    entity_type: 'SUPPLIER',
    full_name: 'Cipla Pharmaceuticals India Ltd',
    phone: '9833098330',
    email: 'distribution@cipla.com',
    gstin: '27AAACC1020B1Z4',
    state_code: '27',
    address: 'Cipla House, Peninsula Business Park, Lower Parel, Mumbai 400013',
    opening_balance_paise: -9200000, // ₹92,000.00 Cr (Payable)
    current_balance_paise: -9200000,
    is_active: true,
    created_at: '2026-08-01T09:00:00Z',
  },
  {
    id: 'ent_s02',
    entity_code: 'SUPP-002',
    entity_type: 'SUPPLIER',
    full_name: 'Gujarat Co-operative Milk Marketing (Amul)',
    phone: '9825098250',
    email: 'b2b@amul.coop',
    gstin: '24AAACG0123C1ZM',
    state_code: '24', // Gujarat (Inter-state)
    address: 'Amul Dairy Road, Anand 388001, Gujarat',
    opening_balance_paise: -4850000, // ₹48,500.00 Cr
    current_balance_paise: -4850000,
    is_active: true,
    created_at: '2026-08-02T10:00:00Z',
  },
  {
    id: 'ent_s03',
    entity_code: 'SUPP-003',
    entity_type: 'SUPPLIER',
    full_name: 'Hindustan Unilever Distribution Hub',
    phone: '9867098670',
    email: 'order.desk@hul.com',
    gstin: '27AAACH1111A1ZK',
    state_code: '27',
    address: 'Bhiwandi Logistics Park, Thane 421302',
    opening_balance_paise: -3120000, // ₹31,200.00 Cr
    current_balance_paise: -3120000,
    is_active: true,
    created_at: '2026-08-05T14:00:00Z',
  },
  {
    id: 'ent_s04',
    entity_code: 'SUPP-004',
    entity_type: 'SUPPLIER',
    full_name: 'Tata Steel B2B Central Depot',
    phone: '9821098210',
    email: 'depot.mumbai@tatasteel.com',
    gstin: '27AAACT0099K1ZL',
    state_code: '27',
    address: 'Steel Yard, Kalamboli, Navi Mumbai 410218',
    opening_balance_paise: -2330000, // ₹23,300.00 Cr
    current_balance_paise: -2330000,
    is_active: true,
    created_at: '2026-08-10T16:00:00Z',
  },
];

// Seed Ledger Statements
const INITIAL_LEDGER: Record<string, LedgerStatementRow[]> = {
  ent_c01: [
    {
      id: 'led_c1_01',
      entity_id: 'ent_c01',
      date: '2026-10-01',
      voucher_number: 'OP-BAL',
      voucher_type: 'JOURNAL',
      narration: 'Opening Outstanding Balance b/f',
      debit_paise: 2500000,
      credit_paise: 0,
      running_balance_paise: 2500000,
    },
    {
      id: 'led_c1_02',
      entity_id: 'ent_c01',
      date: '2026-10-05',
      voucher_number: 'INV-2026-0045',
      voucher_type: 'SALE',
      narration: 'Tax Invoice: Paracetamol & Amoxicillin supply',
      debit_paise: 4200000,
      credit_paise: 0,
      running_balance_paise: 6700000,
    },
    {
      id: 'led_c1_03',
      entity_id: 'ent_c01',
      date: '2026-10-10',
      voucher_number: 'RCP-2026-0012',
      voucher_type: 'RECEIPT',
      narration: 'Payment received via NEFT/UPI against INV-0045',
      debit_paise: 0,
      credit_paise: 3000000,
      running_balance_paise: 3700000,
      payment_mode: 'UPI',
      reference_no: 'UPI/261010/8827361',
    },
    {
      id: 'led_c1_04',
      entity_id: 'ent_c01',
      date: '2026-10-18',
      voucher_number: 'INV-2026-0078',
      voucher_type: 'SALE',
      narration: 'Tax Invoice: Medical supplies shipment',
      debit_paise: 1800000,
      credit_paise: 0,
      running_balance_paise: 5500000,
    },
    {
      id: 'led_c1_05',
      entity_id: 'ent_c01',
      date: '2026-10-19',
      voucher_number: 'CN-2026-0003',
      voucher_type: 'SALE_RETURN',
      narration: 'Credit Note: Damaged pack return adjustment',
      debit_paise: 0,
      credit_paise: 1000000,
      running_balance_paise: 4500000,
    },
  ],
  ent_s01: [
    {
      id: 'led_s1_01',
      entity_id: 'ent_s01',
      date: '2026-10-01',
      voucher_number: 'OP-BAL',
      voucher_type: 'JOURNAL',
      narration: 'Opening Payable Balance b/f',
      debit_paise: 0,
      credit_paise: 6000000,
      running_balance_paise: -6000000,
    },
    {
      id: 'led_s1_02',
      entity_id: 'ent_s01',
      date: '2026-10-06',
      voucher_number: 'PUR-2026-0008',
      voucher_type: 'PURCHASE',
      narration: 'Purchase Inward: Batch DL-24F18 (85 strips)',
      debit_paise: 0,
      credit_paise: 5200000,
      running_balance_paise: -11200000,
    },
    {
      id: 'led_s1_03',
      entity_id: 'ent_s01',
      date: '2026-10-12',
      voucher_number: 'PAY-2026-0011',
      voucher_type: 'PAYMENT',
      narration: 'Supplier Payout via RTGS',
      debit_paise: 4000000,
      credit_paise: 0,
      running_balance_paise: -7200000,
      payment_mode: 'BANK_TRANSFER',
      reference_no: 'RTGS/HDFC/99281721',
    },
    {
      id: 'led_s1_04',
      entity_id: 'ent_s01',
      date: '2026-10-17',
      voucher_number: 'PUR-2026-0014',
      voucher_type: 'PURCHASE',
      narration: 'Purchase Inward: Dolo & Amoxicillin bulk replenishment',
      debit_paise: 0,
      credit_paise: 2000000,
      running_balance_paise: -9200000,
    },
  ],
};

// Seed Day Book Entries
const INITIAL_DAYBOOK: DayBookEntry[] = [
  {
    id: 'db_01',
    time: '09:45 AM',
    date: '2026-10-20',
    voucher_number: 'INV-2026-0081',
    type: 'SALE',
    party_name: 'Walk-in Cash Retail Customer',
    narration: 'Counter retail sale: Paracetamol 650mg & Cadbury Silk',
    payment_mode: 'CASH',
    inflow_paise: 19900, // ₹199.00
    outflow_paise: 0,
    tax_paise: 2400,
    net_amount_paise: 19900,
  },
  {
    id: 'db_02',
    time: '10:30 AM',
    date: '2026-10-20',
    voucher_number: 'INV-2026-0082',
    type: 'SALE',
    party_name: 'Shree Ganesh Enterprises',
    party_id: 'ent_c01',
    narration: 'B2B GST Sale: 20 Strips Dolo 650 + 5 Amul Ghee Tins',
    payment_mode: 'CREDIT',
    inflow_paise: 0,
    outflow_paise: 0,
    tax_paise: 4480,
    net_amount_paise: 418000, // ₹4,180.00
  },
  {
    id: 'db_03',
    time: '11:15 AM',
    date: '2026-10-20',
    voucher_number: 'RCP-2026-0019',
    type: 'RECEIPT',
    party_name: 'Patel Supermarket LLP',
    party_id: 'ent_c02',
    narration: 'Payment received against old invoice INV-0039',
    payment_mode: 'UPI',
    inflow_paise: 2500000, // ₹25,000.00
    outflow_paise: 0,
    tax_paise: 0,
    net_amount_paise: 2500000,
  },
  {
    id: 'db_04',
    time: '01:40 PM',
    date: '2026-10-20',
    voucher_number: 'PUR-2026-0016',
    type: 'PURCHASE',
    party_name: 'Cipla Pharmaceuticals India Ltd',
    party_id: 'ent_s01',
    narration: 'Inward inventory shipment: Antibiotics & Fever Meds',
    payment_mode: 'CREDIT',
    inflow_paise: 0,
    outflow_paise: 0,
    tax_paise: 540000,
    net_amount_paise: 5040000, // ₹50,400.00
  },
  {
    id: 'db_05',
    time: '03:10 PM',
    date: '2026-10-20',
    voucher_number: 'PAY-2026-0015',
    type: 'PAYMENT',
    party_name: 'Gujarat Co-operative Milk Marketing (Amul)',
    party_id: 'ent_s02',
    narration: 'Vendor settlement payout via RTGS/Cheque',
    payment_mode: 'BANK_TRANSFER',
    inflow_paise: 0,
    outflow_paise: 2000000, // ₹20,000.00
    tax_paise: 0,
    net_amount_paise: 2000000,
  },
  {
    id: 'db_06',
    time: '04:30 PM',
    date: '2026-10-20',
    voucher_number: 'INV-2026-0083',
    type: 'SALE',
    party_name: 'Apex MediCare Diagnostic Centre',
    party_id: 'ent_c05',
    narration: 'Hospital pharmacy supply: Amoxicillin & Sanitizers',
    payment_mode: 'UPI',
    inflow_paise: 1250000, // ₹12,500.00
    outflow_paise: 0,
    tax_paise: 150000,
    net_amount_paise: 1250000,
  },
  {
    id: 'db_07',
    time: '05:45 PM',
    date: '2026-10-20',
    voucher_number: 'CN-2026-0004',
    type: 'SALE_RETURN',
    party_name: 'Sharma Retail & General Store',
    party_id: 'ent_c03',
    narration: 'Credit note issued for returned damaged goods',
    payment_mode: 'CREDIT',
    inflow_paise: 0,
    outflow_paise: 0,
    tax_paise: -36000,
    net_amount_paise: 236000, // ₹2,360.00
  },
];

// Seed Chart of Accounts & Trial Balance
const INITIAL_ACCOUNTS: TrialBalanceAccount[] = [
  // ASSETS (Normal balance: Debit)
  { id: 'acc_1000', code: '1000', name: 'Cash in Hand (Store Till)', type: 'ASSET', debit_paise: 5490000, credit_paise: 0, net_balance_paise: 5490000 },
  { id: 'acc_1010', code: '1010', name: 'HDFC Current Bank A/c & Digital Wallets', type: 'ASSET', debit_paise: 38200000, credit_paise: 0, net_balance_paise: 38200000 },
  { id: 'acc_1100', code: '1100', name: 'Accounts Receivable (Trade Debtors)', type: 'ASSET', debit_paise: 18430000, credit_paise: 0, net_balance_paise: 18430000 },
  { id: 'acc_1200', code: '1200', name: 'Inventory Stock Assets (At Cost)', type: 'ASSET', debit_paise: 27280000, credit_paise: 0, net_balance_paise: 27280000 },
  { id: 'acc_1500', code: '1500', name: 'Store Fixtures & Billing Hardware', type: 'ASSET', debit_paise: 12500000, credit_paise: 0, net_balance_paise: 12500000 },

  // LIABILITIES (Normal balance: Credit)
  { id: 'acc_2000', code: '2000', name: 'Accounts Payable (Trade Creditors)', type: 'LIABILITY', debit_paise: 0, credit_paise: 19500000, net_balance_paise: -19500000 },
  { id: 'acc_2100', code: '2100', name: 'Output CGST Payable (Central GST)', type: 'LIABILITY', debit_paise: 0, credit_paise: 3450000, net_balance_paise: -3450000 },
  { id: 'acc_2110', code: '2110', name: 'Output SGST Payable (State GST)', type: 'LIABILITY', debit_paise: 0, credit_paise: 3450000, net_balance_paise: -3450000 },
  { id: 'acc_2120', code: '2120', name: 'Output IGST Payable (Integrated GST)', type: 'LIABILITY', debit_paise: 0, credit_paise: 1800000, net_balance_paise: -1800000 },

  // EQUITY (Normal balance: Credit)
  { id: 'acc_3000', code: '3000', name: "Owner's Equity Capital", type: 'EQUITY', debit_paise: 0, credit_paise: 50000000, net_balance_paise: -50000000 },
  { id: 'acc_3100', code: '3100', name: 'Retained Earnings / General Reserves', type: 'EQUITY', debit_paise: 0, credit_paise: 8800000, net_balance_paise: -8800000 },

  // REVENUE (Normal balance: Credit)
  { id: 'acc_4000', code: '4000', name: 'GST Sales Revenue (Goods & Supplies)', type: 'REVENUE', debit_paise: 0, credit_paise: 54600000, net_balance_paise: -54600000 },
  { id: 'acc_4010', code: '4010', name: 'Sales Returns & Allowances (Contra Revenue)', type: 'REVENUE', debit_paise: 1500000, credit_paise: 0, net_balance_paise: 1500000 },

  // EXPENSE (Normal balance: Debit)
  { id: 'acc_5000', code: '5000', name: 'Cost of Goods Sold (Purchase Inwards)', type: 'EXPENSE', debit_paise: 38200000, credit_paise: 0, net_balance_paise: 38200000 },
  { id: 'acc_5100', code: '5100', name: 'Store Rent & Electricity Expenses', type: 'EXPENSE', debit_paise: 4800000, credit_paise: 0, net_balance_paise: 4800000 },
  { id: 'acc_5200', code: '5200', name: 'Staff Salaries & Wages', type: 'EXPENSE', debit_paise: 3600000, credit_paise: 0, net_balance_paise: 3600000 },
  { id: 'acc_4900', code: '4900', name: 'Round Off Adjustment', type: 'EXPENSE', debit_paise: 10000, credit_paise: 0, net_balance_paise: 10000 },
];

export class ErpStorageService {
  private static load<T>(key: string, fallback: T): T {
    try {
      const data = localStorage.getItem(key);
      if (data) {
        return JSON.parse(data) as T;
      }
    } catch (e) {
      console.warn(`Failed to parse ${key} from localStorage, using fallback:`, e);
    }
    return fallback;
  }

  private static save<T>(key: string, data: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save ${key} to localStorage:`, e);
    }
  }

  // --- ITEMS & LOTS ---
  static getItems(): ResourceItem[] {
    return this.load<ResourceItem[]>(STORAGE_KEYS.ITEMS, INITIAL_ITEMS);
  }

  static saveItems(items: ResourceItem[]): void {
    this.save(STORAGE_KEYS.ITEMS, items);
  }

  static addItem(newItem: Omit<ResourceItem, 'id' | 'created_at' | 'lots'> & { initial_stock_milli?: number; batch_number?: string; expiry_date?: string; mrp_paise?: number }): ResourceItem {
    const items = this.getItems();
    const id = `res_${Date.now()}`;
    const now = new Date().toISOString();

    const lots: ResourceLot[] = [];
    if (newItem.initial_stock_milli && newItem.initial_stock_milli > 0) {
      lots.push({
        id: `lot_${Date.now()}`,
        resource_id: id,
        batch_number: newItem.batch_number?.trim() || `B-${new Date().getFullYear()}-01`,
        expiry_date: newItem.expiry_date || '2028-12-31',
        mrp_paise: newItem.mrp_paise || Math.round(newItem.base_price_paise * 1.15),
        cost_price_paise: newItem.cost_price_paise,
        current_stock_milli: newItem.initial_stock_milli,
        created_at: now,
      });
    }

    const created: ResourceItem = {
      id,
      sku: newItem.sku.trim().toUpperCase(),
      name: newItem.name.trim(),
      hsn_sac: newItem.hsn_sac.trim(),
      tax_rate_bps: Number(newItem.tax_rate_bps),
      base_price_paise: Number(newItem.base_price_paise),
      cost_price_paise: Number(newItem.cost_price_paise),
      unit: (newItem.unit || 'PCS').toUpperCase(),
      is_stock_tracked: newItem.is_stock_tracked,
      reorder_level_milli: Number(newItem.reorder_level_milli || 10000),
      category: newItem.category || 'General',
      lots,
      created_at: now,
    };

    items.unshift(created);
    this.saveItems(items);
    return created;
  }

  static addLot(resourceId: string, lotData: { batch_number: string; expiry_date: string; mrp_paise: number; cost_price_paise: number; quantity_milli: number }): ResourceLot {
    const items = this.getItems();
    const item = items.find((i) => i.id === resourceId);
    if (!item) {
      throw new Error(`Item ${resourceId} not found`);
    }

    const newLot: ResourceLot = {
      id: `lot_${Date.now()}`,
      resource_id: resourceId,
      batch_number: lotData.batch_number.trim().toUpperCase(),
      expiry_date: lotData.expiry_date,
      mrp_paise: Number(lotData.mrp_paise),
      cost_price_paise: Number(lotData.cost_price_paise || item.cost_price_paise),
      current_stock_milli: Number(lotData.quantity_milli),
      created_at: new Date().toISOString(),
    };

    item.lots.push(newLot);
    this.saveItems(items);
    return newLot;
  }

  // --- ENTITIES & LEDGERS ---
  static getEntities(type?: string): Entity[] {
    const list = this.load<Entity[]>(STORAGE_KEYS.ENTITIES, INITIAL_ENTITIES);
    if (!type || type === 'ALL') return list;
    return list.filter((e) => e.entity_type === type);
  }

  static saveEntities(entities: Entity[]): void {
    this.save(STORAGE_KEYS.ENTITIES, entities);
  }

  static addEntity(data: Omit<Entity, 'id' | 'created_at' | 'current_balance_paise'>): Entity {
    const list = this.getEntities();
    const created: Entity = {
      ...data,
      id: `ent_${Date.now()}`,
      current_balance_paise: data.opening_balance_paise,
      created_at: new Date().toISOString(),
    };
    list.unshift(created);
    this.saveEntities(list);
    return created;
  }

  static getLedger(entityId: string): LedgerStatementRow[] {
    const all = this.load<Record<string, LedgerStatementRow[]>>(STORAGE_KEYS.LEDGER, INITIAL_LEDGER);
    return all[entityId] || [
      {
        id: `led_init_${entityId}`,
        entity_id: entityId,
        date: new Date().toISOString().split('T')[0],
        voucher_number: 'OP-BAL',
        voucher_type: 'JOURNAL',
        narration: 'Opening Account Balance',
        debit_paise: 0,
        credit_paise: 0,
        running_balance_paise: 0,
      },
    ];
  }

  static saveLedger(entityId: string, rows: LedgerStatementRow[]): void {
    const all = this.load<Record<string, LedgerStatementRow[]>>(STORAGE_KEYS.LEDGER, INITIAL_LEDGER);
    all[entityId] = rows;
    this.save(STORAGE_KEYS.LEDGER, all);
  }

  static recordPayment(payload: RecordPaymentPayload): { ledgerRow: LedgerStatementRow; updatedBalance: number } {
    const entities = this.getEntities();
    const entity = entities.find((e) => e.id === payload.entity_id);
    if (!entity) throw new Error('Entity not found');

    const ledger = this.getLedger(payload.entity_id);
    const lastRow = ledger[ledger.length - 1];
    const prevBalance = lastRow ? lastRow.running_balance_paise : entity.current_balance_paise;

    const voucherNum = `PAY-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const isCustomer = entity.entity_type === 'CUSTOMER' || entity.entity_type === 'PATIENT' || entity.entity_type === 'STUDENT';

    let debit = 0;
    let credit = 0;
    let newBalance = prevBalance;

    if (isCustomer) {
      // Customer payment received: Credit customer account, reducing Dr balance
      credit = payload.amount_paise;
      newBalance = prevBalance - payload.amount_paise;
    } else {
      // Supplier payment disbursed: Debit supplier account, reducing Cr balance
      debit = payload.amount_paise;
      newBalance = prevBalance + payload.amount_paise; // Negative balance becomes closer to 0
    }

    const row: LedgerStatementRow = {
      id: `led_${Date.now()}`,
      entity_id: payload.entity_id,
      date: payload.date || new Date().toISOString().split('T')[0],
      voucher_number: voucherNum,
      voucher_type: isCustomer ? 'RECEIPT' : 'PAYMENT',
      narration: payload.narration || (isCustomer ? `Payment Receipt via ${payload.payment_mode}` : `Supplier Payout via ${payload.payment_mode}`),
      debit_paise: debit,
      credit_paise: credit,
      running_balance_paise: newBalance,
      payment_mode: payload.payment_mode,
      reference_no: payload.reference_number,
    };

    ledger.push(row);
    this.saveLedger(payload.entity_id, ledger);

    // Update entity current balance
    entity.current_balance_paise = newBalance;
    this.saveEntities(entities);

    // Also append to Day Book
    this.addDayBookEntry({
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      date: payload.date || new Date().toISOString().split('T')[0],
      voucher_number: voucherNum,
      type: isCustomer ? 'RECEIPT' : 'PAYMENT',
      party_name: entity.full_name,
      party_id: entity.id,
      narration: row.narration,
      payment_mode: payload.payment_mode,
      inflow_paise: isCustomer ? payload.amount_paise : 0,
      outflow_paise: isCustomer ? 0 : payload.amount_paise,
      tax_paise: 0,
      net_amount_paise: payload.amount_paise,
    });

    return { ledgerRow: row, updatedBalance: newBalance };
  }

  // --- DAY BOOK ---
  static getDayBookEntries(selectedDate?: string): DayBookEntry[] {
    const entries = this.load<DayBookEntry[]>(STORAGE_KEYS.DAYBOOK, INITIAL_DAYBOOK);
    if (!selectedDate) return entries;
    return entries.filter((e) => e.date === selectedDate);
  }

  static addDayBookEntry(entry: Omit<DayBookEntry, 'id'>): DayBookEntry {
    const list = this.load<DayBookEntry[]>(STORAGE_KEYS.DAYBOOK, INITIAL_DAYBOOK);
    const created: DayBookEntry = {
      ...entry,
      id: `db_${Date.now()}`,
    };
    list.unshift(created);
    this.save(STORAGE_KEYS.DAYBOOK, list);
    return created;
  }

  static getDayBookSummary(date: string): DayBookSummary {
    const entries = this.getDayBookEntries(date);
    let totalSales = 0;
    let totalPurchases = 0;
    let totalReceipts = 0;
    let totalPayments = 0;
    let netCashFlow = 0;

    for (const e of entries) {
      if (e.type === 'SALE') {
        totalSales += e.net_amount_paise;
      } else if (e.type === 'PURCHASE') {
        totalPurchases += e.net_amount_paise;
      } else if (e.type === 'RECEIPT') {
        totalReceipts += e.net_amount_paise;
      } else if (e.type === 'PAYMENT') {
        totalPayments += e.net_amount_paise;
      }
      netCashFlow += (e.inflow_paise - e.outflow_paise);
    }

    return {
      date,
      total_sales_paise: totalSales,
      total_purchases_paise: totalPurchases,
      total_receipts_paise: totalReceipts,
      total_payments_paise: totalPayments,
      net_cash_flow_paise: netCashFlow,
      entry_count: entries.length,
    };
  }

  // --- TRIAL BALANCE ---
  static getTrialBalanceAccounts(): TrialBalanceAccount[] {
    return this.load<TrialBalanceAccount[]>(STORAGE_KEYS.ACCOUNTS, INITIAL_ACCOUNTS);
  }

  static saveTrialBalanceAccounts(accounts: TrialBalanceAccount[]): void {
    this.save(STORAGE_KEYS.ACCOUNTS, accounts);
  }

  // --- GSTR-1 REPORTS GENERATOR ---
  static getGstr1B2B(): Gstr1B2BInvoice[] {
    return [
      {
        id: 'gstr1_b2b_01',
        gstin: '27AAACG1234F1Z8',
        recipient_name: 'Shree Ganesh Enterprises',
        invoice_number: 'INV-2026-0045',
        invoice_date: '2026-10-05',
        invoice_value_paise: 4200000,
        pos_state_code: '27',
        reverse_charge: 'N',
        taxable_value_paise: 3750000,
        tax_rate_bps: 1200,
        igst_paise: 0,
        cgst_paise: 225000,
        sgst_paise: 225000,
      },
      {
        id: 'gstr1_b2b_02',
        gstin: '24AAECP9876E1Z2',
        recipient_name: 'Patel Supermarket LLP',
        invoice_number: 'INV-2026-0052',
        invoice_date: '2026-10-08',
        invoice_value_paise: 7850000,
        pos_state_code: '24',
        reverse_charge: 'N',
        taxable_value_paise: 6652500,
        tax_rate_bps: 1800,
        igst_paise: 1197500,
        cgst_paise: 0,
        sgst_paise: 0,
      },
      {
        id: 'gstr1_b2b_03',
        gstin: '07AAYCS5544D1Z9',
        recipient_name: 'Sharma Retail & General Store',
        invoice_number: 'INV-2026-0063',
        invoice_date: '2026-10-12',
        invoice_value_paise: 2420000,
        pos_state_code: '07',
        reverse_charge: 'N',
        taxable_value_paise: 2050800,
        tax_rate_bps: 1800,
        igst_paise: 369200,
        cgst_paise: 0,
        sgst_paise: 0,
      },
      {
        id: 'gstr1_b2b_04',
        gstin: '27AABCA7788K1Z5',
        recipient_name: 'Apex MediCare Diagnostic Centre',
        invoice_number: 'INV-2026-0078',
        invoice_date: '2026-10-18',
        invoice_value_paise: 1800000,
        pos_state_code: '27',
        reverse_charge: 'N',
        taxable_value_paise: 1607100,
        tax_rate_bps: 1200,
        igst_paise: 0,
        cgst_paise: 96450,
        sgst_paise: 96450,
      },
    ];
  }

  static getGstr1B2C(): Gstr1B2CEntry[] {
    return [
      {
        id: 'b2c_01',
        type: 'B2C_SMALL',
        pos_state_code: '27', // Maharashtra intra-state
        tax_rate_bps: 500,
        taxable_value_paise: 1850000,
        cgst_paise: 46250,
        sgst_paise: 46250,
        igst_paise: 0,
        invoice_count: 24,
      },
      {
        id: 'b2c_02',
        type: 'B2C_SMALL',
        pos_state_code: '27',
        tax_rate_bps: 1200,
        taxable_value_paise: 4500000,
        cgst_paise: 270000,
        sgst_paise: 270000,
        igst_paise: 0,
        invoice_count: 38,
      },
      {
        id: 'b2c_03',
        type: 'B2C_SMALL',
        pos_state_code: '27',
        tax_rate_bps: 1800,
        taxable_value_paise: 6800000,
        cgst_paise: 612000,
        sgst_paise: 612000,
        igst_paise: 0,
        invoice_count: 45,
      },
      {
        id: 'b2c_04',
        type: 'B2C_LARGE',
        pos_state_code: '24', // Inter-state > 2.5L to unregistered
        tax_rate_bps: 1800,
        taxable_value_paise: 3100000,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 558000,
        invoice_count: 1,
      },
    ];
  }

  static getGstr1HsnSummary(): Gstr1HsnSummary[] {
    return [
      {
        hsn_sac: '3004',
        description: 'Medicaments of mixed or unmixed products for therapeutic use',
        uqc: 'BOX',
        total_quantity_milli: 154000,
        total_value_paise: 5800000,
        taxable_value_paise: 5178500,
        igst_paise: 120000,
        cgst_paise: 250750,
        sgst_paise: 250750,
        cess_paise: 0,
      },
      {
        hsn_sac: '1006',
        description: 'Rice - Semi-milled or wholly milled Basmati Rice',
        uqc: 'BAG',
        total_quantity_milli: 45000,
        total_value_paise: 2475000,
        taxable_value_paise: 2357100,
        igst_paise: 0,
        cgst_paise: 58925,
        sgst_paise: 58925,
        cess_paise: 0,
      },
      {
        hsn_sac: '0405',
        description: 'Butter and other fats and oils derived from milk (Desi Ghee)',
        uqc: 'TIN',
        total_quantity_milli: 32000,
        total_value_paise: 1952000,
        taxable_value_paise: 1742800,
        igst_paise: 0,
        cgst_paise: 104570,
        sgst_paise: 104570,
        cess_paise: 0,
      },
      {
        hsn_sac: '8504',
        description: 'Electrical transformers, static converters (Chargers/Adapters)',
        uqc: 'PCS',
        total_quantity_milli: 28000,
        total_value_paise: 2797200,
        taxable_value_paise: 2370500,
        igst_paise: 185000,
        cgst_paise: 120845,
        sgst_paise: 120845,
        cess_paise: 0,
      },
      {
        hsn_sac: '1806',
        description: 'Chocolate and other food preparations containing cocoa',
        uqc: 'BAR',
        total_quantity_milli: 18000,
        total_value_paise: 297000,
        taxable_value_paise: 251700,
        igst_paise: 0,
        cgst_paise: 22650,
        sgst_paise: 22650,
        cess_paise: 0,
      },
      {
        hsn_sac: '3402',
        description: 'Organic surface-active agents, washing and cleaning preparations',
        uqc: 'PACK',
        total_quantity_milli: 42000,
        total_value_paise: 1764000,
        taxable_value_paise: 1494900,
        igst_paise: 0,
        cgst_paise: 134540,
        sgst_paise: 134540,
        cess_paise: 0,
      },
      {
        hsn_sac: '7214',
        description: 'Other bars and rods of iron or non-alloy steel (TMT Rebars)',
        uqc: 'BUNDLE',
        total_quantity_milli: 6000,
        total_value_paise: 2910000,
        taxable_value_paise: 2466100,
        igst_paise: 0,
        cgst_paise: 221950,
        sgst_paise: 221950,
        cess_paise: 0,
      },
    ];
  }

  // --- STOCK VALUATION & AGING ---
  static getStockValuationItems(): StockValuationItem[] {
    const items = this.getItems();
    return items.map((item) => {
      const totalStockMilli = item.lots.reduce((acc, lot) => acc + lot.current_stock_milli, 0);
      const stockQtyUnits = totalStockMilli / 1000;
      const valCost = Math.round(stockQtyUnits * item.cost_price_paise);
      const valRetail = Math.round(stockQtyUnits * item.base_price_paise);
      const isLowStock = totalStockMilli <= item.reorder_level_milli;

      return {
        resource_id: item.id,
        sku: item.sku,
        name: item.name,
        hsn_sac: item.hsn_sac,
        category: item.category,
        unit: item.unit,
        total_stock_milli: totalStockMilli,
        cost_price_paise: item.cost_price_paise,
        base_price_paise: item.base_price_paise,
        valuation_cost_paise: valCost,
        valuation_retail_paise: valRetail,
        reorder_threshold_milli: item.reorder_level_milli,
        is_low_stock: isLowStock,
        lots: item.lots,
      };
    });
  }
}
