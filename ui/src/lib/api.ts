import { BusinessProfile, CompletedSale, ResourceItem } from '../types/pos';

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
const STORAGE_KEY_PRODUCTS = 'omnibill_products_v1';
const STORAGE_KEY_SALES = 'omnibill_sales_v1';
const STORAGE_KEY_PURCHASES = 'omnibill_purchases_v1';
const STORAGE_KEY_PROFILE = 'omnibill_profile_v1';
const STORAGE_KEY_INV_COUNTER = 'omnibill_inv_counter_v1';

class PosStorage {
  private products: ResourceItem[];
  private sales: CompletedSale[];
  private businessProfile: BusinessProfile;
  private invCounter: number;

  constructor() {
    this.products = this.loadFromStorage(STORAGE_KEY_PRODUCTS, INITIAL_PRODUCTS);
    this.sales = this.loadFromStorage(STORAGE_KEY_SALES, []);
    this.businessProfile = this.loadFromStorage(STORAGE_KEY_PROFILE, DEFAULT_BUSINESS_PROFILE);
    this.invCounter = this.loadFromStorage(STORAGE_KEY_INV_COUNTER, 1001);
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
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn(`Failed to save ${key} to storage:`, e);
    }
  }

  public getProducts(): ResourceItem[] {
    return [...this.products];
  }

  public findProductByBarcodeOrSku(query: string): ResourceItem | undefined {
    const q = query.trim().toLowerCase();
    return this.products.find(
      (p) => p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q
    );
  }

  public getBusinessProfile(): BusinessProfile {
    return { ...this.businessProfile };
  }

  public setBusinessProfile(profile: BusinessProfile): void {
    this.businessProfile = { ...profile };
    this.saveToStorage(STORAGE_KEY_PROFILE, this.businessProfile);
  }

  public getNextInvoiceNumber(): string {
    const count = this.invCounter++;
    this.saveToStorage(STORAGE_KEY_INV_COUNTER, this.invCounter);
    const year = new Date().getFullYear();
    return `INV-${year}-${count.toString().padStart(5, '0')}`;
  }

  public saveSale(sale: CompletedSale): void {
    this.sales.unshift(sale);
    this.saveToStorage(STORAGE_KEY_SALES, this.sales);

    // Deduct stock in-memory
    sale.lines.forEach((line) => {
      const prod = this.products.find((p) => p.id === line.resource_id);
      if (prod) {
        prod.stock_milli = Math.max(0, prod.stock_milli - line.quantity_milli);
      }
    });
    this.saveToStorage(STORAGE_KEY_PRODUCTS, this.products);
  }

  public getRecentSales(): CompletedSale[] {
    return [...this.sales];
  }

  public savePurchase(purchase: {
    supplier: string;
    invoice_number: string;
    invoice_date: string;
    lines: Array<{
      resource_id: string;
      quantity_milli: number;
      cost_price_paise: number;
    }>;
  }): void {
    // Increase stock in-memory
    purchase.lines.forEach((line) => {
      const prod = this.products.find((p) => p.id === line.resource_id);
      if (prod) {
        prod.stock_milli += line.quantity_milli;
        prod.cost_price_paise = line.cost_price_paise;
      }
    });
    this.saveToStorage(STORAGE_KEY_PRODUCTS, this.products);
    
    const existing = this.loadFromStorage<any[]>(STORAGE_KEY_PURCHASES, []);
    existing.unshift({
      id: 'pur_' + Date.now(),
      ...purchase,
      created_at: new Date().toISOString(),
    });
    this.saveToStorage(STORAGE_KEY_PURCHASES, existing);
  }
}

export const posStorage = new PosStorage();

/**
 * High-level API calls with Tauri IPC invocation and browser fallback
 */
export async function apiGetProducts(): Promise<ResourceItem[]> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<ResourceItem[]>('list_resources');
      if (result && result.length > 0) return result;
    } catch {
      // fallback to offline storage
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

export async function apiPostSale(sale: CompletedSale): Promise<{ success: boolean; invoice_number: string }> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ transaction_id: string; invoice_number: string }>('post_sale', {
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
    } catch (err) {
      console.warn('Tauri post_sale call failed, committing to offline storage:', err);
    }
  }

  posStorage.saveSale(sale);
  return { success: true, invoice_number: sale.invoice_number };
}

export async function apiPostPurchase(purchase: {
  supplier: string;
  invoice_number: string;
  invoice_date: string;
  lines: Array<{
    resource_id: string;
    quantity_milli: number;
    cost_price_paise: number;
  }>;
}): Promise<{ success: boolean }> {
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('post_purchase', { input: purchase });
    } catch (err) {
      console.warn('Tauri post_purchase call failed, committing to offline storage:', err);
    }
  }

  posStorage.savePurchase(purchase);
  return { success: true };
}
