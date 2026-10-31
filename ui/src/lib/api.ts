import { BusinessProfile, CompletedSale, ResourceItem } from '../types/pos';
import { ErpStorageService } from './erpStorage';

// Detect whether running in Tauri desktop wrapper
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

// Default Initial Business Profile
const DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  id: 'biz_default',
  legal_name: 'OmniBill Retail & Supermarket Enterprise',
  trade_name: 'OmniMart Superstore',
  gstin: '27AABCO1234F1Z5',
  state_code: '27', // Maharashtra
  phone: '+91 98765 43210',
  email: 'cashier@omnimart.local',
  address_line1: 'Shop #12, Ground Floor, Trade Center, MG Road',
  city: 'Pune',
  postal_code: '411001',
  upi_vpa: 'omnimart@icici',
};

// Initial Sample Product Catalog with Real Barcodes & GST Rates
export const INITIAL_PRODUCTS: ResourceItem[] = [
  {
    id: 'res_1',
    sku: 'MILK-500',
    barcode: '8901262010053',
    name: 'Amul Taaza Fresh Milk 500ml',
    hsn: '0401',
    unit: 'pkt',
    tax_rate_bps: 0, // 0%
    base_price_paise: 2800, // ₹28.00
    cost_price_paise: 2500,
    stock_milli: 45000,
  },
  {
    id: 'res_2',
    sku: 'PARLE-G-100',
    barcode: '8901719101014',
    name: 'Parle-G Glucose Biscuit 100g',
    hsn: '1905',
    unit: 'pkt',
    tax_rate_bps: 500, // 5%
    base_price_paise: 1000, // ₹10.00
    cost_price_paise: 850,
    stock_milli: 120000,
  },
  {
    id: 'res_3',
    sku: 'TATA-SALT-1K',
    barcode: '8904043901005',
    name: 'Tata Salt Vacuum Evaporated 1kg',
    hsn: '2501',
    unit: 'kg',
    tax_rate_bps: 500, // 5%
    base_price_paise: 2500, // ₹25.00
    cost_price_paise: 2100,
    stock_milli: 80000,
  },
  {
    id: 'res_4',
    sku: 'DETTOL-250',
    barcode: '8901396112104',
    name: 'Dettol Antiseptic Liquid 250ml',
    hsn: '3004',
    unit: 'btl',
    tax_rate_bps: 1200, // 12%
    base_price_paise: 16500, // ₹165.00
    cost_price_paise: 14000,
    stock_milli: 25000,
  },
  {
    id: 'res_5',
    sku: 'COLGATE-150',
    barcode: '8901314010529',
    name: 'Colgate Total Advanced Toothpaste 150g',
    hsn: '3306',
    unit: 'tube',
    tax_rate_bps: 1800, // 18%
    base_price_paise: 13500, // ₹135.00
    cost_price_paise: 11000,
    stock_milli: 35000,
  },
  {
    id: 'res_6',
    sku: 'RICE-5K',
    barcode: '8906010010012',
    name: 'Daawat Rozana Basmati Rice 5kg',
    hsn: '1006',
    unit: 'bag',
    tax_rate_bps: 500, // 5%
    base_price_paise: 47500, // ₹475.00
    cost_price_paise: 41000,
    stock_milli: 18000,
  },
  {
    id: 'res_7',
    sku: 'OIL-1L',
    barcode: '8906007281014',
    name: 'Fortune Sunlite Refined Sunflower Oil 1L',
    hsn: '1512',
    unit: 'pouch',
    tax_rate_bps: 500, // 5%
    base_price_paise: 14200, // ₹142.00
    cost_price_paise: 12800,
    stock_milli: 50000,
  },
  {
    id: 'res_8',
    sku: 'COKE-750',
    barcode: '8901764012211',
    name: 'Coca Cola Soft Drink 750ml PET',
    hsn: '2202',
    unit: 'btl',
    tax_rate_bps: 2800, // 28%
    base_price_paise: 4500, // ₹45.00
    cost_price_paise: 3600,
    stock_milli: 60000,
  },
  {
    id: 'res_9',
    sku: 'MAGGI-70',
    barcode: '8901058852211',
    name: 'Nestle Maggi 2-Minute Masala Noodles 70g',
    hsn: '1902',
    unit: 'pkt',
    tax_rate_bps: 1200, // 12%
    base_price_paise: 1400, // ₹14.00
    cost_price_paise: 1150,
    stock_milli: 150000,
  },
  {
    id: 'res_10',
    sku: 'ATTA-5K',
    barcode: '8901725181222',
    name: 'Aashirvaad Superior MP Whole Wheat Atta 5kg',
    hsn: '1101',
    unit: 'bag',
    tax_rate_bps: 500, // 5%
    base_price_paise: 24500, // ₹245.00
    cost_price_paise: 21500,
    stock_milli: 22000,
  },
  {
    id: 'res_11',
    sku: 'PEN-5PK',
    barcode: '8902153010015',
    name: 'Reynolds Ball Pen Blue (Pack of 5)',
    hsn: '9608',
    unit: 'pack',
    tax_rate_bps: 1800, // 18%
    base_price_paise: 5000, // ₹50.00
    cost_price_paise: 3800,
    stock_milli: 40000,
  },
  {
    id: 'res_12',
    sku: 'LED-9W',
    barcode: '8903338010019',
    name: 'Philips LED 9W Cool Daylight Bulb B22',
    hsn: '8539',
    unit: 'pcs',
    tax_rate_bps: 1800, // 18%
    base_price_paise: 9900, // ₹99.00
    cost_price_paise: 7500,
    stock_milli: 30000,
  },
];

// Local Storage Keys
const STORAGE_KEY_PRODUCTS = 'omnibill_products_v2';
const STORAGE_KEY_SALES = 'omnibill_sales_v2';
const STORAGE_KEY_PURCHASES = 'omnibill_purchases_v2';
const STORAGE_KEY_PROFILE = 'omnibill_profile_v2';
const STORAGE_KEY_INV_COUNTER = 'omnibill_inv_counter_v2';

export type BusinessType = 'RETAIL' | 'WHOLESALE' | 'SCHOOL' | 'HOSPITAL';

export const getActiveVertical = (): BusinessType => {
  if (typeof window !== 'undefined') {
    try {
      const sess = localStorage.getItem('omnibill_active_session');
      if (sess) {
        const parsed = JSON.parse(sess);
        if (parsed.businessType) return parsed.businessType;
      }
    } catch {}
  }
  return 'RETAIL';
};

export const getInitialBusinessProfileForVertical = (vertical: BusinessType): BusinessProfile => {
  switch (vertical) {
    case 'WHOLESALE':
      return {
        id: 'biz_wholesale',
        legal_name: 'Apex Wholesale & Bulk Supply Enterprise',
        trade_name: 'Apex Wholesale Traders',
        gstin: '27AABCW5678F1Z9',
        state_code: '27',
        phone: '+91 98220 12345',
        email: 'billing@apexwholesale.local',
        address_line1: 'Plot #45, Industrial Area, Phase II',
        city: 'Pune',
        postal_code: '411018',
        upi_vpa: 'apexwholesale@icici',
      };
    case 'SCHOOL':
      return {
        id: 'biz_school',
        legal_name: 'Delhi Public Academy Educational Trust',
        trade_name: 'Delhi Public Academy',
        gstin: '27AABCS9999F1Z1',
        state_code: '27',
        phone: '+91 98220 54321',
        email: 'accounts@dpa.edu.in',
        address_line1: 'Campus Rd, Model Colony',
        city: 'Pune',
        postal_code: '411016',
        upi_vpa: 'dpa.fees@sbi',
      };
    case 'HOSPITAL':
      return {
        id: 'biz_hospital',
        legal_name: 'Apex Medicare Multi-Speciality Healthcare Ltd',
        trade_name: 'Apex Medicare Hospital',
        gstin: '27AABCH4444F1Z3',
        state_code: '27',
        phone: '+91 98220 99887',
        email: 'billing@apexmedicare.org',
        address_line1: 'Survey #88, Hospital Boulevard',
        city: 'Pune',
        postal_code: '411004',
        upi_vpa: 'apexmedicare@hdfc',
      };
    case 'RETAIL':
    default:
      return DEFAULT_BUSINESS_PROFILE;
  }
};

export const getInitialProductsForVertical = (vertical: BusinessType): ResourceItem[] => {
  switch (vertical) {
    case 'WHOLESALE':
      return [
        {
          id: 'res_w1',
          sku: 'RICE-50KG',
          barcode: '8901234567890',
          name: 'Daawat Rozana Basmati Rice (50kg Bag)',
          hsn: '1006',
          unit: 'bag',
          tax_rate_bps: 500,
          base_price_paise: 385000,
          cost_price_paise: 340000,
          stock_milli: 150000,
        },
        {
          id: 'res_w2',
          sku: 'OIL-15L',
          barcode: '8902345678901',
          name: 'Fortune Sunlite Refined Sunflower Oil (15L Tin)',
          hsn: '1512',
          unit: 'tin',
          tax_rate_bps: 500,
          base_price_paise: 185000,
          cost_price_paise: 165000,
          stock_milli: 80000,
        },
        {
          id: 'res_w3',
          sku: 'SUGAR-50K',
          barcode: '8903456789012',
          name: 'Madhur Pure & Hygienic Sugar (50kg Commercial)',
          hsn: '1701',
          unit: 'bag',
          tax_rate_bps: 500,
          base_price_paise: 210000,
          cost_price_paise: 195000,
          stock_milli: 120000,
        },
      ];
    case 'SCHOOL':
      return [
        {
          id: 'res_s1',
          sku: 'FEE-TERM-01',
          barcode: 'SCH-TERM1',
          name: 'Term 1 Tuition & Curriculum Academic Fee',
          hsn: '9992',
          unit: 'term',
          tax_rate_bps: 0,
          base_price_paise: 1850000,
          cost_price_paise: 0,
          stock_milli: 999000,
        },
        {
          id: 'res_s2',
          sku: 'UNIFORM-SET',
          barcode: 'SCH-UNIF-10',
          name: 'Standard School Uniform Set (Shirt + Trouser + Tie)',
          hsn: '6203',
          unit: 'set',
          tax_rate_bps: 500,
          base_price_paise: 145000,
          cost_price_paise: 95000,
          stock_milli: 250000,
        },
        {
          id: 'res_s3',
          sku: 'BUS-TRANSPORT',
          barcode: 'SCH-BUS-R1',
          name: 'Quarterly School Bus Transport Service (Route #1)',
          hsn: '9992',
          unit: 'qtr',
          tax_rate_bps: 0,
          base_price_paise: 450000,
          cost_price_paise: 0,
          stock_milli: 999000,
        },
      ];
    case 'HOSPITAL':
      return [
        {
          id: 'res_h1',
          sku: 'CONSULT-OPD',
          barcode: 'MED-CONS-01',
          name: 'General OPD Doctor Consultation Slip',
          hsn: '9993',
          unit: 'visit',
          tax_rate_bps: 0,
          base_price_paise: 80000,
          cost_price_paise: 0,
          stock_milli: 999000,
        },
        {
          id: 'res_h2',
          sku: 'MED-DOLO-650',
          barcode: '8901234000018',
          name: 'Paracetamol 650mg Dolo (Strip of 15 Tab)',
          hsn: '3004',
          unit: 'strip',
          tax_rate_bps: 1200,
          base_price_paise: 3400,
          cost_price_paise: 2200,
          stock_milli: 85000,
        },
        {
          id: 'res_h3',
          sku: 'BED-DELUXE',
          barcode: 'MED-BED-DX',
          name: 'Inpatient Single Deluxe AC Room / Bed (Per Day)',
          hsn: '9993',
          unit: 'day',
          tax_rate_bps: 0,
          base_price_paise: 350000,
          cost_price_paise: 0,
          stock_milli: 20000,
        },
      ];
    case 'RETAIL':
    default:
      return INITIAL_PRODUCTS;
  }
};

class PosStorage {
  private products: ResourceItem[] = [];
  private sales: CompletedSale[] = [];
  private businessProfile: BusinessProfile = DEFAULT_BUSINESS_PROFILE;
  private invCounter: number = 1001;

  constructor() {
    this.reloadForActiveVertical();
  }

  public reloadForActiveVertical(): void {
    const v = getActiveVertical();
    const vKey = v.toLowerCase();
    const defaultProfile = getInitialBusinessProfileForVertical(v);
    const defaultProducts = getInitialProductsForVertical(v);

    this.products = this.loadFromStorage(`${STORAGE_KEY_PRODUCTS}_${vKey}`, defaultProducts);
    this.sales = this.loadFromStorage(`${STORAGE_KEY_SALES}_${vKey}`, []);
    this.businessProfile = this.loadFromStorage(`${STORAGE_KEY_PROFILE}_${vKey}`, defaultProfile);
    this.invCounter = this.loadFromStorage(`${STORAGE_KEY_INV_COUNTER}_${vKey}`, 1001);
  }

  private getKey(base: string): string {
    const v = getActiveVertical().toLowerCase();
    return `${base}_${v}`;
  }

  private loadFromStorage<T>(key: string, defaultVal: T): T {
    try {
      const data = localStorage.getItem(key);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn(`Failed to read ${key} from storage:`, e);
    }
    return defaultVal;
  }

  private saveToStorage<T>(key: string, val: T): void {
    try {
      const valStr = JSON.stringify(val);
      localStorage.setItem(key, valStr);
      ErpStorageService.syncKeyToBackend(key, valStr);
    } catch (e) {
      console.warn(`Failed to save ${key} to storage:`, e);
    }
  }

  public getProducts(): ResourceItem[] {
    const key = this.getKey(STORAGE_KEY_PRODUCTS);
    const v = getActiveVertical();
    return this.loadFromStorage(key, getInitialProductsForVertical(v));
  }

  public setProducts(products: ResourceItem[]): void {
    this.products = [...products];
    this.saveToStorage(this.getKey(STORAGE_KEY_PRODUCTS), this.products);
  }

  public findProductByBarcodeOrSku(query: string): ResourceItem | undefined {
    const q = query.trim().toLowerCase();
    return this.getProducts().find(
      (p) => p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q
    );
  }

  public getBusinessProfile(): BusinessProfile {
    const key = this.getKey(STORAGE_KEY_PROFILE);
    const v = getActiveVertical();
    return this.loadFromStorage(key, getInitialBusinessProfileForVertical(v));
  }

  public setBusinessProfile(profile: BusinessProfile): void {
    this.businessProfile = { ...profile };
    this.saveToStorage(this.getKey(STORAGE_KEY_PROFILE), this.businessProfile);
  }

  public getNextInvoiceNumber(): string {
    const key = this.getKey(STORAGE_KEY_INV_COUNTER);
    let count = this.loadFromStorage(key, 1001);
    const nextCount = count + 1;
    this.saveToStorage(key, nextCount);
    const year = new Date().getFullYear();
    const prefix = getActiveVertical().slice(0, 3);
    return `${prefix}-${year}-${count.toString().padStart(5, '0')}`;
  }

  public saveSale(sale: CompletedSale): void {
    const salesKey = this.getKey(STORAGE_KEY_SALES);
    const existingSales = this.loadFromStorage<CompletedSale[]>(salesKey, []);
    existingSales.unshift(sale);
    this.saveToStorage(salesKey, existingSales);
  }

  public getRecentSales(): CompletedSale[] {
    const salesKey = this.getKey(STORAGE_KEY_SALES);
    return this.loadFromStorage<CompletedSale[]>(salesKey, []);
  }

  public savePurchase(purchase: {
    supplier?: string;
    invoice_number: string;
    invoice_date: string;
    lines: Array<{
      resource_id: string;
      quantity_milli: number;
      cost_price_paise: number;
      sku?: string;
      batch_number?: string;
      expiry_date?: string;
      mrp_paise?: number;
    }>;
  }): void {
    // Record purchase voucher into ledger.
    // Stock quantity is authoritatively managed by ErpStorageService (Item Master + FIFO lots)
    const purKey = this.getKey(STORAGE_KEY_PURCHASES);
    const existing = this.loadFromStorage<any[]>(purKey, []);
    existing.unshift({
      id: 'pur_' + Date.now(),
      ...purchase,
      created_at: new Date().toISOString(),
    });
    this.saveToStorage(purKey, existing);
  }

  public getPurchases(): any[] {
    const purKey = this.getKey(STORAGE_KEY_PURCHASES);
    return this.loadFromStorage<any[]>(purKey, []);
  }
}

export const posStorage = new PosStorage();

export const getDbPath = (): string => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('omnibill_db_path');
    if (custom) return custom;
    const v = getActiveVertical().toLowerCase();
    return `omnibill_${v}.db`;
  }
  return 'omnibill_retail.db';
};

export async function apiGetProducts(): Promise<ResourceItem[]> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const records = await invoke<any[]>('cmd_get_resources', { db_path: getDbPath() });
      if (Array.isArray(records) && records.length > 0) {
        return records.map((r) => ({
          id: r.id,
          sku: r.sku_or_code,
          barcode: r.sku_or_code,
          name: r.name,
          hsn: r.hsn_sac,
          unit: 'pcs',
          tax_rate_bps: r.tax_rate_bps,
          base_price_paise: r.base_price_paise,
          cost_price_paise: r.cost_price_paise,
          stock_milli: r.current_stock_milli,
        }));
      }
    } catch (err: any) {
      console.error('IPC cmd_get_resources failed:', err);
    }
  }
  return posStorage.getProducts();
}

export async function apiGetBusinessProfile(): Promise<BusinessProfile> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<BusinessProfile>('get_business_profile');
      if (result) return result;
    } catch {
      // fallback
    }
  }
  return posStorage.getBusinessProfile();
}

export async function apiPostSale(
  sale: CompletedSale
): Promise<{ success: boolean; invoice_number: string; error?: string }> {
  const saleDate = sale.invoice_date || new Date().toISOString().split('T')[0];
  try {
    ErpStorageService.checkPeriodLock(saleDate);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('Period lock rejected sale post:', msg);
    return { success: false, invoice_number: sale.invoice_number, error: msg };
  }
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      if (sale.payment && sale.totals.total_amount_paise > 0) {
        const modeMap: Record<string, string> = {
          CASH: 'Cash',
          UPI: 'Upi',
          CARD: 'Card',
          BANK_TRANSFER: 'BankTransfer',
        };

        const res = await invoke<{
          sale: { transaction_id: string; invoice_number: string };
          payment_ids: string[];
        }>('cmd_post_sale_with_payments', {
          db_path: getDbPath(),
          input: {
            sale: {
              invoice_date: sale.invoice_date,
              seller_state_code: sale.seller_state_code,
              place_of_supply_state_code: sale.place_of_supply_state_code,
              customer: sale.customer_phone || sale.customer_name || null,
              price_mode: sale.price_mode === 'EXCLUSIVE' ? 'Exclusive' : 'Inclusive',
              lines: sale.lines.map((l) => ({
                resource_id: l.resource_id,
                quantity_milli: l.quantity_milli,
                unit_price_paise: l.unit_price_paise,
                discount_paise: l.discount_paise,
                tax_rate_bps: l.tax_rate_bps,
              })),
            },
            payments: [
              {
                mode: modeMap[sale.payment.mode] || 'Cash',
                amount_paise: sale.totals.total_amount_paise,
                reference_number: sale.payment.reference_number || null,
              },
            ],
          },
        });

        if (res?.sale?.invoice_number) {
          sale.invoice_number = res.sale.invoice_number;
          sale.transaction_id = res.sale.transaction_id;
        }
      } else {
        const res = await invoke<{ transaction_id: string; invoice_number: string }>('cmd_post_sale', {
          db_path: getDbPath(),
          input: {
            invoice_date: sale.invoice_date,
            seller_state_code: sale.seller_state_code,
            place_of_supply_state_code: sale.place_of_supply_state_code,
            customer: sale.customer_phone || sale.customer_name || null,
            price_mode: sale.price_mode === 'EXCLUSIVE' ? 'Exclusive' : 'Inclusive',
            lines: sale.lines.map((l) => ({
              resource_id: l.resource_id,
              quantity_milli: l.quantity_milli,
              unit_price_paise: l.unit_price_paise,
              discount_paise: l.discount_paise,
              tax_rate_bps: l.tax_rate_bps,
            })),
          },
        });

        if (res?.invoice_number) {
          sale.invoice_number = res.invoice_number;
          sale.transaction_id = res.transaction_id;
        }
      }
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      console.error('Tauri sales post failed:', errMsg);
      return { success: false, invoice_number: sale.invoice_number, error: errMsg };
    }
  }

  posStorage.saveSale(sale);
  try {
    ErpStorageService.deductStock(
      sale.lines.map((l) => ({
        resource_id: l.resource_id,
        sku: (l as any).sku,
        quantity_milli: l.quantity_milli,
        is_return: (l as any).is_return,
      }))
    );
  } catch (err) {
    console.warn('Failed to deduct stock in ErpStorageService:', err);
  }

  // Record sale in Accounting Day Book
  try {
    const totalTax = sale.totals.cgst_paise + sale.totals.sgst_paise + sale.totals.igst_paise;
    const pMode: any = sale.payment?.mode === 'SPLIT' ? 'CASH' : (sale.payment?.mode || 'CASH');

    // CF-16: Resolve customer party accurately from name, phone or entity master
    let partyName = sale.customer_name?.trim();
    let partyId = 'cust_walkin';
    const cleanPhone = sale.customer_phone?.trim();

    if (cleanPhone) {
      try {
        const entities = ErpStorageService.getEntities('CUSTOMER');
        const match = entities.find((e) => e.phone === cleanPhone);
        if (match) {
          partyId = match.id;
          partyName = partyName || (match as any).trade_name || match.full_name || (match as any).legal_name;
        } else if (!partyName) {
          partyName = `Customer (${cleanPhone})`;
        }
      } catch {}
    } else if (partyName) {
      try {
        const entities = ErpStorageService.getEntities('CUSTOMER');
        const match = entities.find(
          (e) =>
            (e.full_name && e.full_name.toLowerCase() === partyName!.toLowerCase()) ||
            ((e as any).trade_name && (e as any).trade_name.toLowerCase() === partyName!.toLowerCase())
        );
        if (match) {
          partyId = match.id;
        }
      } catch {}
    }

    if (!partyName) {
      partyName = 'Walk-in Retail Customer';
    }

    ErpStorageService.addDayBookEntry({
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      date: sale.invoice_date || new Date().toISOString().split('T')[0],
      voucher_number: sale.invoice_number,
      type: 'SALE',
      party_name: partyName,
      party_id: partyId,
      narration: `POS Counter Sale ${sale.invoice_number} (${sale.lines.length} lines)`,
      payment_mode: pMode,
      inflow_paise: sale.totals.total_amount_paise,
      outflow_paise: 0,
      tax_paise: totalTax,
      net_amount_paise: sale.totals.total_amount_paise,
    });

    // CF-08: If bill has Udhaar/Customer Credit portion, record in Customer Ledger
    const creditPaise = sale.payment?.credit_amount_paise || 0;
    if (creditPaise > 0 && partyId !== 'cust_walkin') {
      try {
        ErpStorageService.recordCustomerCredit(partyId, creditPaise, sale.invoice_number);
      } catch (err) {
        console.warn('Failed to record customer credit ledger entry:', err);
      }
    }
  } catch (err) {
    console.warn('Failed to append sale to Day Book:', err);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('omnibill_catalog_sync', {
        detail: { vertical: getActiveVertical() },
      })
    );
  }
  return { success: true, invoice_number: sale.invoice_number };
}

export async function apiPostPurchase(purchase: {
  supplier?: string;
  invoice_number: string;
  invoice_date: string;
  lines: Array<{
    resource_id: string;
    quantity_milli: number;
    cost_price_paise: number;
    sku?: string;
    batch_number?: string;
    expiry_date?: string;
    mrp_paise?: number;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  const purDate = purchase.invoice_date || new Date().toISOString().split('T')[0];
  try {
    ErpStorageService.checkPeriodLock(purDate);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('Period lock rejected purchase post:', msg);
    return { success: false, error: msg };
  }
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cmd_post_purchase', {
        db_path: getDbPath(),
        input: {
          supplier: purchase.supplier,
          invoice_number: purchase.invoice_number,
          invoice_date: purchase.invoice_date,
          lines: purchase.lines.map((l) => ({
            resource_id: l.resource_id,
            quantity_milli: l.quantity_milli,
            cost_price_paise: l.cost_price_paise,
          })),
        },
      });
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      console.error('Tauri cmd_post_purchase failed:', errMsg);
      return { success: false, error: errMsg };
    }
  }

  // 1. Inward directly into ErpStorageService (Item Master & Inventory Lots)
  try {
    ErpStorageService.inwardStock(purchase.lines);
  } catch (err) {
    console.warn('Failed to inward stock in ErpStorageService:', err);
  }

  // 2. Inward into posStorage (LightningPOS & purchase voucher ledger)
  posStorage.savePurchase(purchase);

  // 3. Record purchase in Accounting Day Book & Trial Balance
  const totalCostPaise = purchase.lines.reduce(
    (sum, l) => sum + Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
    0
  );
  const totalUnits = purchase.lines.reduce(
    (sum, l) => sum + Math.round(l.quantity_milli / 1000),
    0
  );
  const supplierName = purchase.supplier?.trim() || 'Primary Supplier';

  try {
    ErpStorageService.addDayBookEntry({
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      date: purchase.invoice_date || new Date().toISOString().split('T')[0],
      voucher_number: purchase.invoice_number,
      type: 'PURCHASE',
      party_name: supplierName,
      party_id: 'supp_inward',
      narration: `Inward Purchase ${purchase.invoice_number} (${purchase.lines.length} items / ${totalUnits} units)`,
      payment_mode: 'CASH',
      inflow_paise: 0,
      outflow_paise: totalCostPaise,
      tax_paise: 0,
      net_amount_paise: totalCostPaise,
    });
    ErpStorageService.adjustTrialBalanceForPurchase(totalCostPaise);
  } catch (err) {
    console.warn('Failed to record purchase in Day Book / Trial Balance:', err);
  }

  // 3. Dispatch global catalog sync so all open components (F3, F10, POS) refresh immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('omnibill_catalog_sync', {
        detail: { vertical: getActiveVertical() },
      })
    );
  }

  return { success: true };
}