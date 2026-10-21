// ui/src/verticals/WholesaleBilling.tsx
// Comprehensive Wholesale & B2B Distribution Suite: Multi-Line GST Tax Invoicing, 2-Way Smart Auto-Catch, e-Way Bill, Credit Guard, Volume Slabs, Logistics Expenses, Watermarked Tax Invoices, and Reports

import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Building2,
  AlertTriangle,
  FileText,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  Layers,
  Calendar,
  ShieldAlert,
  Percent,
  Search,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  X,
  ExternalLink,
  Sliders,
  Wallet,
  BarChart3,
  Settings,
  Share2,
  Download,
  Receipt,
  Eye,
  MapPin,
  Phone,
  Sparkles,
  HelpCircle,
  Package,
  TrendingUp,
  PlusCircle,
  PackageCheck,
} from 'lucide-react';
import {
  WholesaleCustomer,
  ResourceItem,
  ResourceLot,
  VerticalCartLine,
  EWayBillDetails,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
  WholesalePricingRule,
  WholesaleExpense,
  WholesaleInvoiceSettings,
  WholesaleInvoiceRecord,
  WholesaleStockItem,
} from './types';
import {
  PurchaseExpenseBillModal,
  PurchaseExpenseVoucher,
} from '../components/common/PurchaseExpenseBillModal';
import { VerticalIPCBridge } from './ipc';
import {
  WholesaleDataService,
  exportWholesaleInvoicesToCSV,
  exportCustomersToCSV,
  generateWholesaleDayBookWhatsAppLink,
  generateB2BInvoiceWhatsAppLink,
} from './wholesaleData';
import { computeSaleTotals, formatPaise, parseRupeesToPaise } from '../lib/tax';
import { posSound } from '../lib/sound';

export type WholesaleTab = 'INVOICING' | 'CUSTOMERS' | 'STOCK_INWARD' | 'PRICING_TIERS' | 'EXPENSES' | 'REPORTS' | 'INVOICE_SETTINGS';

export const WholesaleBilling: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<WholesaleTab>('INVOICING');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Core Data
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);
  const [pricingRules, setPricingRules] = useState<WholesalePricingRule[]>([]);
  const [expenses, setExpenses] = useState<WholesaleExpense[]>([]);
  const [invoices, setInvoices] = useState<WholesaleInvoiceRecord[]>([]);
  const [invoiceSettings, setInvoiceSettings] = useState<WholesaleInvoiceSettings>(
    WholesaleDataService.getInvoiceSettings()
  );

  // Wholesale Inventory Stock State
  const [wholesaleStock, setWholesaleStock] = useState<WholesaleStockItem[]>(() => WholesaleDataService.getWholesaleStock());
  const [stockVouchers, setStockVouchers] = useState<PurchaseExpenseVoucher[]>(() => WholesaleDataService.getPurchaseVouchers());
  const [activePurchaseVoucher, setActivePurchaseVoucher] = useState<PurchaseExpenseVoucher | null>(null);
  const [isPurchaseVoucherModalOpen, setIsPurchaseVoucherModalOpen] = useState(false);
  const [isNewWholesaleItemModalOpen, setIsNewWholesaleItemModalOpen] = useState(false);
  const [stockSubTab, setStockSubTab] = useState<'STOCK_ROSTER' | 'INWARD_ENTRY' | 'VOUCHERS_HISTORY'>('STOCK_ROSTER');

  // Consignment Inward Form State
  const [inwardSupplier, setInwardSupplier] = useState('Adani Wilmar & Agro Mills Limited');
  const [inwardGstin, setInwardGstin] = useState('24AAACA0000A1Z5');
  const [inwardPhone, setInwardPhone] = useState('9825012345');
  const [inwardVoucherNo, setInwardVoucherNo] = useState(`GRN-WH-${Date.now().toString().slice(-5)}`);
  const [inwardDate, setInwardDate] = useState(new Date().toISOString().split('T')[0]);
  const [inwardPaymentMode, setInwardPaymentMode] = useState<'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI'>('BANK_TRANSFER');
  const [inwardRemarks, setInwardRemarks] = useState('');
  const [inwardLines, setInwardLines] = useState<Array<{ itemId: string; name: string; quantity: number; purchaseRatePaise: number }>>([]);
  const [selectedInwardItemId, setSelectedInwardItemId] = useState(wholesaleStock[0]?.id || 'wh_stk_001');
  const [inwardQty, setInwardQty] = useState('100');
  const [inwardCostRupees, setInwardCostRupees] = useState('');

  // New Wholesale Item Form State
  const [newWhSku, setNewWhSku] = useState('');
  const [newWhName, setNewWhName] = useState('');
  const [newWhCategory, setNewWhCategory] = useState('Staples & Grains');
  const [newWhUnit, setNewWhUnit] = useState('bag');
  const [newWhPurchaseRupees, setNewWhPurchaseRupees] = useState('');
  const [newWhSellingRupees, setNewWhSellingRupees] = useState('');
  const [newWhMrpRupees, setNewWhMrpRupees] = useState('');

  // B2B Cart (100% Fully Editable)
  const [cart, setCart] = useState<VerticalCartLine[]>([]);
  const [tradeDiscountMode, setTradeDiscountMode] = useState<'NONE' | 'PERCENT' | 'FLAT'>('NONE');
  const [tradeDiscountValue, setTradeDiscountValue] = useState<number>(0);
  const [tradeDiscountReason, setTradeDiscountReason] = useState<string>('Tier 1 Distributor Volume Rebate');

  // Two-Way Search
  const [masterSearchQuery, setMasterSearchQuery] = useState('');
  const [companySearchQuery, setCompanySearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');

  // e-Way Bill Fields
  const [ewayDetails, setEwayDetails] = useState<EWayBillDetails>({
    distance_km: 140,
    transporter_id: '27AAACL1966H1ZU',
    transporter_name: 'VRL Logistics Limited',
    transporter_doc_no: 'LR-2026-98124',
    vehicle_number: 'MH-12-QW-4412',
    eway_bill_no: '281900412891',
    supply_type: 'Outward - Supply',
  });

  // Modals & Receipts
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);
  const [invoiceCopyType, setInvoiceCopyType] = useState<'ORIGINAL' | 'DUPLICATE' | 'TRIPLICATE'>('ORIGINAL');

  // Payment Selection
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');
  const [staffName, setStaffName] = useState('Manager S. Rathore');

  // New Customer Form State
  const [newCustCode, setNewCustCode] = useState(`CUST-B2B-${Math.floor(10 + Math.random() * 90)}`);
  const [newCustName, setNewCustName] = useState('');
  const [newCustTradeName, setNewCustTradeName] = useState('');
  const [newCustGstin, setNewCustGstin] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustCreditLimit, setNewCustCreditLimit] = useState('300000');
  const [newCustStateCode, setNewCustStateCode] = useState('27');
  const [newCustCity, setNewCustCity] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustTermsDays, setNewCustTermsDays] = useState(30);

  // New Expense Form State
  const [expCategory, setExpCategory] = useState<WholesaleExpense['category']>('DIESEL_FLEET');
  const [expPayee, setExpPayee] = useState('');
  const [expAmountInr, setExpAmountInr] = useState('');
  const [expMode, setExpMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [expVoucherNo, setExpVoucherNo] = useState(`EXP-WH-${Date.now().toString().slice(-4)}`);
  const [expRemarks, setExpRemarks] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync inputs when customer selected
  const syncCustomerInputs = (customer: WholesaleCustomer) => {
    setSelectedCustomerId(customer.id);
    setMasterSearchQuery(customer.gstin || customer.entity_code);
    setCompanySearchQuery(customer.trade_name || customer.full_name);
    setStateFilter(customer.state_code || '27');
  };

  // Initial Data Load
  const refreshAllData = () => {
    const custs = WholesaleDataService.getCustomers();
    setCustomers(custs);
    if (custs.length > 0 && !selectedCustomerId) {
      syncCustomerInputs(custs[0]);
    }
    setPricingRules(WholesaleDataService.getPricingRules());
    setExpenses(WholesaleDataService.getExpenses());
    setInvoices(WholesaleDataService.getInvoices());
    setInvoiceSettings(WholesaleDataService.getInvoiceSettings());
  };

  useEffect(() => {
    refreshAllData();

    VerticalIPCBridge.getResources('WHOLESALE').then((res) => {
      setCatalog(res);
      // Auto-populate 2 initial items if cart empty
      if (cart.length === 0 && res.length >= 2) {
        addResourceToInvoice(res[0], 20);
        addResourceToInvoice(res[1], 10);
      }
    });
  }, []);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || customers[0] || null;
  }, [customers, selectedCustomerId]);

  // Two-Way Search Handlers
  const handleMasterKeyChange = (val: string) => {
    setMasterSearchQuery(val);
    const q = val.trim().toLowerCase();
    if (!q) return;

    const match = customers.find(
      (c) =>
        (c.gstin && c.gstin.toLowerCase().includes(q)) ||
        c.entity_code.toLowerCase().includes(q)
    );
    if (match && match.id !== selectedCustomerId) {
      syncCustomerInputs(match);
      showToast(`Auto-filled: ${match.trade_name || match.full_name}`);
    }
  };

  const handleCompanySearchChange = (val: string) => {
    setCompanySearchQuery(val);
    const q = val.trim().toLowerCase();
    if (!q) return;

    const match = customers.find(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        (c.trade_name && c.trade_name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.city && c.city.toLowerCase().includes(q))
    );
    if (match && match.id !== selectedCustomerId) {
      syncCustomerInputs(match);
    }
  };

  // Tax and Inter-State Logic (Store State = '27' Maharashtra)
  const isInterState = selectedCustomer ? selectedCustomer.state_code !== '27' : false;

  // Add Resource to Cart
  const addResourceToInvoice = (resource: ResourceItem, units = 1) => {
    posSound.playItemAdd();
    const defaultLot = resource.lots && resource.lots.length > 0 ? resource.lots[0] : undefined;
    const grossPaise = resource.base_price_paise * units;

    const newLine: VerticalCartLine = {
      id: `line_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      resource_id: resource.id,
      sku: resource.sku,
      name: resource.name,
      hsn_sac: resource.hsn_sac,
      unit: resource.unit,
      tax_rate_bps: resource.tax_rate_bps,
      quantity_milli: units * 1000,
      unit_price_paise: resource.base_price_paise,
      mrp_paise: defaultLot?.mrp_paise || resource.mrp_paise,
      discount_paise: 0,
      lot_id: defaultLot?.id,
      batch_number: defaultLot?.batch_number,
      expiry_date: defaultLot?.expiry_date,
      gross_paise: grossPaise,
      taxable_paise: grossPaise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: grossPaise,
    };

    setCart((prev) => [...prev, newLine]);
  };

  // Add Freight / Logistics Surcharge Line
  const addLogisticsChargeLine = (type: 'FREIGHT' | 'LOADING' | 'INSURANCE') => {
    posSound.playItemAdd();
    const presets = {
      FREIGHT: { name: 'Inter-State Freight & Transportation Charges', hsn: '996511', rate: 450000 },
      LOADING: { name: 'Loading, Pallet Strapping & Handling Charges', hsn: '996719', rate: 120000 },
      INSURANCE: { name: 'Transit Cargo Insurance Charges', hsn: '997133', rate: 85000 },
    };
    const choice = presets[type];

    const newLine: VerticalCartLine = {
      id: `charge_${Date.now()}`,
      resource_id: `res_${type.toLowerCase()}`,
      sku: `SRV-${type}`,
      name: choice.name,
      hsn_sac: choice.hsn,
      unit: 'LS',
      tax_rate_bps: 1800, // 18% GST on transport/handling
      quantity_milli: 1000,
      unit_price_paise: choice.rate,
      discount_paise: 0,
      gross_paise: choice.rate,
      taxable_paise: choice.rate,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: choice.rate,
    };

    setCart((prev) => [...prev, newLine]);
    showToast(`Added ${type} charge to invoice`);
  };

  // Inline Line Item Edits
  const handleLineNameChange = (id: string, newName: string) => {
    setCart((prev) => prev.map((l) => (l.id === id ? { ...l, name: newName } : l)));
  };

  const handleLinePriceChange = (id: string, rupees: number) => {
    const paise = Math.max(0, Math.round(rupees * 100));
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const units = l.quantity_milli / 1000;
        const gross = Math.round(paise * units);
        return {
          ...l,
          unit_price_paise: paise,
          gross_paise: gross,
          taxable_paise: gross,
          line_total_paise: gross,
        };
      })
    );
  };

  const handleLineQtyChange = (id: string, units: number) => {
    const safeUnits = Math.max(1, units);
    setCart((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const gross = Math.round(l.unit_price_paise * safeUnits);
        return {
          ...l,
          quantity_milli: safeUnits * 1000,
          gross_paise: gross,
          taxable_paise: gross,
          line_total_paise: gross,
        };
      })
    );
  };

  const handleRemoveLine = (id: string) => {
    posSound.playWarning();
    setCart((prev) => prev.filter((l) => l.id !== id));
  };

  // Compute Bill Totals with Tax Engine
  const computedDocument = useMemo(() => {
    const rawLines = cart.map((line) => ({
      ...line,
      id: line.id,
      resource_id: line.resource_id,
      sku: line.sku,
      barcode: line.barcode || '',
      name: line.name,
      hsn: line.hsn_sac,
      unit: line.unit,
      quantity_milli: line.quantity_milli,
      unit_price_paise: line.unit_price_paise,
      discount_paise: line.discount_paise,
      tax_rate_bps: line.tax_rate_bps,
    }));

    return computeSaleTotals(
      rawLines as any,
      'EXCLUSIVE',
      '27',
      selectedCustomer?.state_code || '27'
    );
  }, [cart, selectedCustomer]);

  const rawSubtotalPaise = computedDocument.totals.subtotal_paise;

  const calculatedDiscountPaise = useMemo(() => {
    if (tradeDiscountMode === 'PERCENT') {
      return Math.round((rawSubtotalPaise * Math.min(100, Math.max(0, tradeDiscountValue))) / 100);
    }
    if (tradeDiscountMode === 'FLAT') {
      return Math.min(rawSubtotalPaise, Math.max(0, Math.round(tradeDiscountValue * 100)));
    }
    return 0;
  }, [rawSubtotalPaise, tradeDiscountMode, tradeDiscountValue]);

  const totalInvoiceAmountPaise = Math.max(
    0,
    computedDocument.totals.total_amount_paise - calculatedDiscountPaise
  );

  // Credit Limit Verification
  const creditLimitPaise = selectedCustomer?.credit_limit_paise || 0;
  const currentBalancePaise = selectedCustomer?.current_balance_paise || 0;
  const availableCreditPaise = Math.max(0, creditLimitPaise - currentBalancePaise);
  const isCreditExceeded =
    paymentMode === 'BANK_TRANSFER' &&
    currentBalancePaise + totalInvoiceAmountPaise > creditLimitPaise;
  const excessCreditAmountPaise = isCreditExceeded
    ? currentBalancePaise + totalInvoiceAmountPaise - creditLimitPaise
    : 0;
  const creditUsagePercent =
    creditLimitPaise > 0
      ? Math.min(100, Math.round(((currentBalancePaise + totalInvoiceAmountPaise) / creditLimitPaise) * 100))
      : 0;

  // Statutory e-Way Bill check (Threshold >= ₹50,000)
  const isEwayBillRequired = totalInvoiceAmountPaise >= 5000000;

  // Post B2B Invoice
  const handlePostInvoice = async () => {
    if (cart.length === 0 || !selectedCustomer) return;
    posSound.playSuccess();

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: totalInvoiceAmountPaise,
      change_due_paise: 0,
      reference_number: bankReference || `B2B-TXN-${Date.now().toString().slice(-6)}`,
    };

    const receipt = await VerticalIPCBridge.postTransaction({
      verticalMode: 'WHOLESALE',
      entityType: 'CUSTOMER',
      entityId: selectedCustomer.id,
      entityName: selectedCustomer.trade_name || selectedCustomer.full_name,
      entityDetails: {
        ...selectedCustomer,
        eway_bill: isEwayBillRequired ? ewayDetails : undefined,
        trade_discount_reason: tradeDiscountMode !== 'NONE' ? tradeDiscountReason : undefined,
      },
      lines: cart,
      totals: computedDocument.totals,
      payment,
      ewayBill: isEwayBillRequired ? ewayDetails : undefined,
      notes: `Tax Invoice • B2B Supply • Buyer GSTIN: ${selectedCustomer.gstin} • State: ${selectedCustomer.state_code}`,
    });

    // Save into B2B Invoices Audit Log
    const newRecord: WholesaleInvoiceRecord = {
      id: `wh_inv_${Date.now()}`,
      invoice_number: receipt.invoice_number,
      date: new Date().toISOString().split('T')[0],
      customer_id: selectedCustomer.id,
      customer_name: selectedCustomer.trade_name || selectedCustomer.full_name,
      customer_gstin: selectedCustomer.gstin || '',
      state_code: selectedCustomer.state_code || '27',
      is_interstate: isInterState,
      subtotal_paise: rawSubtotalPaise,
      discount_paise: calculatedDiscountPaise,
      cgst_paise: computedDocument.totals.cgst_paise,
      sgst_paise: computedDocument.totals.sgst_paise,
      igst_paise: computedDocument.totals.igst_paise,
      round_off_paise: computedDocument.totals.round_off_paise,
      total_paise: totalInvoiceAmountPaise,
      eway_bill_no: isEwayBillRequired ? ewayDetails.eway_bill_no : undefined,
      vehicle_number: isEwayBillRequired ? ewayDetails.vehicle_number : undefined,
      payment_mode: paymentMode,
      payment_status: paymentMode === 'BANK_TRANSFER' ? 'CREDIT' : 'PAID',
      due_date: new Date(Date.now() + (selectedCustomer.payment_terms_days || 30) * 86400000)
        .toISOString()
        .split('T')[0],
      staff_name: staffName,
    };

    WholesaleDataService.recordInvoice(newRecord);
    setInvoices((prev) => [newRecord, ...prev]);

    setLastReceipt(receipt);
    setShowInvoiceModal(true);
    showToast(`Tax Invoice #${receipt.invoice_number} successfully generated!`);
  };

  // Register New B2B Customer
  const handleRegisterCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const newCust: WholesaleCustomer = {
      id: `ent_b2b_${Date.now()}`,
      entity_code: newCustCode,
      entity_type: 'CUSTOMER',
      full_name: newCustName.trim(),
      trade_name: newCustTradeName.trim() || newCustName.trim(),
      gstin: newCustGstin.trim().toUpperCase(),
      phone: newCustPhone.trim(),
      state_code: newCustStateCode,
      city: newCustCity.trim(),
      address_line1: newCustAddress.trim(),
      billing_address: newCustAddress.trim(),
      shipping_address: newCustAddress.trim(),
      credit_limit_paise: Math.round(parseFloat(newCustCreditLimit || '0') * 100),
      current_balance_paise: 0,
      payment_terms_days: newCustTermsDays,
      is_active: true,
    };

    await VerticalIPCBridge.createEntity(newCust);
    WholesaleDataService.addCustomer(newCust);
    setCustomers((prev) => [newCust, ...prev]);
    syncCustomerInputs(newCust);
    setShowNewCustomerModal(false);

    setNewCustName('');
    setNewCustTradeName('');
    setNewCustGstin('');
    setNewCustPhone('');
    setNewCustCode(`CUST-B2B-${Math.floor(10 + Math.random() * 90)}`);
    showToast(`B2B Party ${newCust.trade_name} registered!`);
  };

  // Add Operational Logistics Expense
  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = Math.round(parseFloat(expAmountInr || '0') * 100);
    if (paise <= 0 || !expPayee.trim()) {
      showToast('Enter valid payee and positive amount!');
      return;
    }

    const newExp: WholesaleExpense = {
      id: `exp_wh_${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      category: expCategory,
      payee: expPayee.trim(),
      amount_paise: paise,
      payment_mode: expMode,
      voucher_no: expVoucherNo.trim(),
      remarks: expRemarks.trim(),
    };

    WholesaleDataService.addExpense(newExp);
    setExpenses((prev) => [newExp, ...prev]);
    setExpPayee('');
    setExpAmountInr('');
    setExpRemarks('');
    setExpVoucherNo(`EXP-WH-${Date.now().toString().slice(-4)}`);
    showToast(`Logistics voucher ${newExp.voucher_no} recorded!`);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* TOAST ALERT BANNER */}
      {toastMessage && (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white text-xs font-semibold flex items-center justify-between shadow-lg animate-in slide-in-from-top z-50">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-white hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TOP HEADER: WHOLESALE ERP NAVIGATION */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-white">
                {invoiceSettings.company_name}
              </span>
              <span className="px-2 py-0.5 bg-blue-500/15 text-blue-300 border border-blue-500/30 rounded-full text-[10px] font-bold">
                B2B Distribution Hub
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              GSTIN: <span className="font-mono text-slate-300 font-bold">{invoiceSettings.gstin}</span> • Staff In-Charge:{' '}
              <span className="text-blue-300 font-semibold">{staffName}</span>
            </p>
          </div>
        </div>

        {/* 6 CORE FUNCTIONAL TABS */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('INVOICING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'INVOICING'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>B2B Invoicing</span>
          </button>

          <button
            onClick={() => setActiveTab('CUSTOMERS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'CUSTOMERS'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Parties & Credit ({customers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('STOCK_INWARD')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'STOCK_INWARD'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Stock Inward & Goods Received</span>
          </button>

          <button
            onClick={() => setActiveTab('PRICING_TIERS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'PRICING_TIERS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Volume Pricing Slabs</span>
          </button>

          <button
            onClick={() => setActiveTab('EXPENSES')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'EXPENSES'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>Logistics & Fuel</span>
          </button>

          <button
            onClick={() => setActiveTab('REPORTS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'REPORTS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>B2B Sales & GSTR-1</span>
          </button>

          <button
            onClick={() => setActiveTab('INVOICE_SETTINGS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'INVOICE_SETTINGS'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Invoice Customizer</span>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          TAB 1: B2B INVOICING & CHECKOUT
      --------------------------------------------------------------------- */}
      {activeTab === 'INVOICING' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TWO-WAY SMART B2B PARTY IDENTIFICATION */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Truck className="w-5 h-5 text-blue-400" />
                <h2 className="text-sm font-bold text-white tracking-wide">
                  Buyer Details & Two-Way Smart Auto-Catch
                </h2>
              </div>
              <button
                onClick={() => setShowNewCustomerModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Register New B2B Party</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* MASTER KEY: GSTIN / CUSTOMER CODE */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Master Key (GSTIN / Code)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={masterSearchQuery}
                    onChange={(e) => handleMasterKeyChange(e.target.value)}
                    placeholder="e.g. 27AABCU9603R1ZM"
                    className="w-full bg-slate-950 border border-blue-500/40 rounded-xl px-3 py-2 text-xs font-mono font-bold text-blue-300 focus:outline-none focus:border-blue-400"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
                </div>
              </div>

              {/* SECONDARY SEARCH: COMPANY NAME / PHONE / CITY */}
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Trade Name / Phone Search
                </label>
                <input
                  type="text"
                  value={companySearchQuery}
                  onChange={(e) => handleCompanySearchChange(e.target.value)}
                  placeholder="e.g. Metro / Pune / 98200..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* MASTER ROSTER DROPDOWN */}
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Select B2B Distributor from Directory ({customers.length} Verified Parties)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const match = customers.find((c) => c.id === e.target.value);
                    if (match) syncCustomerInputs(match);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.entity_code} • {c.trade_name || c.full_name} ({c.city}, State {c.state_code}) — GSTIN: {c.gstin}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* SELECTED CUSTOMER CREDIT STATUS & TAX ROUTE STRIP */}
            {selectedCustomer && (
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center font-bold text-blue-300">
                    🏢
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">
                        {selectedCustomer.trade_name || selectedCustomer.full_name}
                      </span>
                      <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded font-mono text-[10px]">
                        {selectedCustomer.entity_code}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isInterState
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}
                      >
                        {isInterState ? '🌐 INTER-STATE (IGST)' : '📍 INTRA-STATE (CGST + SGST)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      GSTIN: <span className="font-mono text-slate-300 font-bold">{selectedCustomer.gstin}</span> • State {selectedCustomer.state_code} • Terms: {selectedCustomer.payment_terms_days || 30} Days
                    </p>
                  </div>
                </div>

                {/* CREDIT UTILIZATION PROGRESS BAR */}
                <div className="border-l border-slate-800 pl-4 w-64">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400 font-bold">Credit Limit Usage:</span>
                    <span
                      className={`font-mono font-bold ${
                        isCreditExceeded
                          ? 'text-rose-400'
                          : creditUsagePercent > 80
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {creditUsagePercent}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isCreditExceeded
                          ? 'bg-rose-500'
                          : creditUsagePercent > 80
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, creditUsagePercent)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                    <span>Avail: ₹{formatPaise(availableCreditPaise)}</span>
                    <span>Limit: ₹{formatPaise(creditLimitPaise)}</span>
                  </div>
                </div>

                {/* STATUTORY E-WAY BILL INDICATOR */}
                <div className="border-l border-slate-800 pl-4 text-right">
                  <span className="text-[10px] text-slate-400 block">e-Way Bill Statutory Status</span>
                  {isEwayBillRequired ? (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded font-bold text-[10px] inline-flex items-center gap-1">
                      <Truck className="w-3 h-3" /> Mandatory (&gt; ₹50k)
                    </span>
                  ) : (
                    <span className="text-slate-500 text-[10px]">Exempt (&lt; ₹50,000)</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* MAIN 2-COLUMN WORKSPACE: LEFT CATALOG & CHARGES, RIGHT EDITABLE INVOICE */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* LEFT COLUMN: QUICK PRODUCT & LOGISTICS SURCHARGES */}
            <div className="lg:col-span-4 space-y-4">
              {/* Product Catalog Picker */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Package className="w-4 h-4 text-blue-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Wholesale Product Catalog
                    </h3>
                  </div>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {catalog.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between hover:border-slate-700 transition"
                    >
                      <div className="pr-2">
                        <div className="font-bold text-white text-xs">{item.name}</div>
                        <div className="text-[10px] text-slate-400">
                          HSN {item.hsn_sac} • GST {item.tax_rate_bps / 100}% • {item.unit}
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button
                          onClick={() => addResourceToInvoice(item, 10)}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          +10
                        </button>
                        <button
                          onClick={() => addResourceToInvoice(item, 50)}
                          className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          +50
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Logistics & Handling Surcharges */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center space-x-2">
                    <Truck className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                      Logistics & Freight Surcharges
                    </h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => addLogisticsChargeLine('FREIGHT')}
                    className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-white text-xs block">Inter-State Freight (Truckload)</span>
                      <span className="text-[10px] text-slate-400">HSN 996511 • 18% GST</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-indigo-400">+ ₹4,500</span>
                  </button>

                  <button
                    onClick={() => addLogisticsChargeLine('LOADING')}
                    className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-white text-xs block">Loading & Pallet Strapping</span>
                      <span className="text-[10px] text-slate-400">HSN 996719 • 18% GST</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-indigo-400">+ ₹1,200</span>
                  </button>

                  <button
                    onClick={() => addLogisticsChargeLine('INSURANCE')}
                    className="p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-left transition flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <span className="font-bold text-white text-xs block">Transit Marine Cargo Insurance</span>
                      <span className="text-[10px] text-slate-400">HSN 997133 • 18% GST</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-indigo-400">+ ₹850</span>
                  </button>
                </div>
              </div>

              {/* e-Way Bill Quick Form */}
              {isEwayBillRequired && (
                <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 shadow-md space-y-3">
                  <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                    <Truck className="w-4 h-4 text-amber-400" />
                    <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wide">
                      e-Way Bill Details (Statutory)
                    </h3>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold mb-1">Vehicle Registration No</label>
                      <input
                        type="text"
                        value={ewayDetails.vehicle_number}
                        onChange={(e) => setEwayDetails({ ...ewayDetails, vehicle_number: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Transporter Doc / LR</label>
                        <input
                          type="text"
                          value={ewayDetails.transporter_doc_no}
                          onChange={(e) => setEwayDetails({ ...ewayDetails, transporter_doc_no: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Distance (km)</label>
                        <input
                          type="number"
                          value={ewayDetails.distance_km}
                          onChange={(e) => setEwayDetails({ ...ewayDetails, distance_km: parseInt(e.target.value || '0', 10) })}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: 100% FULLY EDITABLE B2B INVOICE TABLE */}
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                {/* INVOICE HEADER */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-blue-400" />
                      <span>Itemized B2B Tax Invoice (100% Fully Editable)</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Edit quantities, unit rates, HSN, and descriptions directly before generating tax document.
                    </p>
                  </div>

                  <span className="text-xs font-mono font-bold text-blue-300 bg-blue-950 px-2.5 py-1 rounded-lg border border-blue-800/60">
                    Place of Supply: State {selectedCustomer?.state_code || '27'}
                  </span>
                </div>

                {/* EDITABLE INVOICE TABLE */}
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                      <tr>
                        <th className="p-2.5">Item Description & HSN</th>
                        <th className="p-2.5 text-center w-20">Batch / Lot</th>
                        <th className="p-2.5 text-right w-20">Qty Units</th>
                        <th className="p-2.5 text-right w-24">Unit Rate (₹)</th>
                        <th className="p-2.5 text-right w-24">Taxable</th>
                        <th className="p-2.5 text-right w-24">Tax (BPS)</th>
                        <th className="p-2.5 text-center w-10">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                      {cart.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-slate-500">
                            Invoice cart is empty. Pick items from the wholesale catalog on the left.
                          </td>
                        </tr>
                      ) : (
                        cart.map((line) => (
                          <tr key={line.id} className="hover:bg-slate-900/60 transition">
                            <td className="p-2">
                              <input
                                type="text"
                                value={line.name}
                                onChange={(e) => handleLineNameChange(line.id, e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                              />
                              <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                                HSN: {line.hsn_sac} • SKU: {line.sku}
                              </span>
                            </td>

                            <td className="p-2 text-center font-mono text-[11px] text-slate-400">
                              {line.batch_number || 'LOT-26A'}
                            </td>

                            <td className="p-2 text-right">
                              <input
                                type="number"
                                min="1"
                                value={line.quantity_milli / 1000}
                                onChange={(e) => handleLineQtyChange(line.id, parseInt(e.target.value || '1', 10))}
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:border-blue-500"
                              />
                            </td>

                            <td className="p-2 text-right">
                              <input
                                type="number"
                                min="0"
                                value={line.unit_price_paise / 100}
                                onChange={(e) => handleLinePriceChange(line.id, parseFloat(e.target.value || '0'))}
                                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:border-blue-500"
                              />
                            </td>

                            <td className="p-2 text-right font-mono font-bold text-white">
                              ₹{(line.taxable_paise / 100).toLocaleString('en-IN')}
                            </td>

                            <td className="p-2 text-right font-mono text-slate-400 text-[11px]">
                              {line.tax_rate_bps / 100}%
                            </td>

                            <td className="p-2 text-center">
                              <button
                                onClick={() => handleRemoveLine(line.id)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                                title="Remove line item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* TRADE DISCOUNT & REBATE CONTROLS */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <Percent className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-white">Distributor Volume Rebate & Trade Discount</span>
                    </div>

                    <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                      <button
                        onClick={() => setTradeDiscountMode('NONE')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          tradeDiscountMode === 'NONE' ? 'bg-slate-800 text-white' : 'text-slate-400'
                        }`}
                      >
                        None
                      </button>
                      <button
                        onClick={() => setTradeDiscountMode('PERCENT')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          tradeDiscountMode === 'PERCENT' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        % Discount
                      </button>
                      <button
                        onClick={() => setTradeDiscountMode('FLAT')}
                        className={`px-2 py-1 rounded text-[11px] font-bold ${
                          tradeDiscountMode === 'FLAT' ? 'bg-blue-600 text-white' : 'text-slate-400'
                        }`}
                      >
                        ₹ Flat Rebate
                      </button>
                    </div>
                  </div>

                  {tradeDiscountMode !== 'NONE' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">
                          {tradeDiscountMode === 'PERCENT' ? 'Discount Percentage (%)' : 'Flat Rebate (₹)'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={tradeDiscountValue}
                          onChange={(e) => setTradeDiscountValue(parseFloat(e.target.value || '0'))}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Commercial Reason</label>
                        <input
                          type="text"
                          value={tradeDiscountReason}
                          onChange={(e) => setTradeDiscountReason(e.target.value)}
                          placeholder="e.g. Early Payment Rebate / Bulk Slab"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* FINANCIAL SUMMARY & POST BUTTON */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="space-y-1.5 text-xs border-b border-slate-800 pb-3">
                  <div className="flex justify-between text-slate-400">
                    <span>Taxable Value (Gross):</span>
                    <span className="font-mono text-white">₹{formatPaise(rawSubtotalPaise)}</span>
                  </div>

                  {calculatedDiscountPaise > 0 && (
                    <div className="flex justify-between text-blue-400 font-semibold">
                      <span>Trade Discount ({tradeDiscountReason}):</span>
                      <span className="font-mono">-₹{formatPaise(calculatedDiscountPaise)}</span>
                    </div>
                  )}

                  {isInterState ? (
                    <div className="flex justify-between text-purple-400 font-semibold">
                      <span>Integrated GST (IGST):</span>
                      <span className="font-mono">+₹{formatPaise(computedDocument.totals.igst_paise)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between text-emerald-400 font-semibold">
                        <span>Central GST (CGST):</span>
                        <span className="font-mono">+₹{formatPaise(computedDocument.totals.cgst_paise)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-400 font-semibold">
                        <span>State GST (SGST):</span>
                        <span className="font-mono">+₹{formatPaise(computedDocument.totals.sgst_paise)}</span>
                      </div>
                    </>
                  )}

                  {computedDocument.totals.round_off_paise !== 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Invoice Round-Off:</span>
                      <span className="font-mono">
                        {computedDocument.totals.round_off_paise > 0 ? '+' : ''}
                        ₹{formatPaise(computedDocument.totals.round_off_paise)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-base font-extrabold text-white pt-2 border-t border-slate-800">
                    <span>Total Tax Invoice Value:</span>
                    <span className="text-xl font-mono text-blue-400">
                      ₹{formatPaise(totalInvoiceAmountPaise)}
                    </span>
                  </div>
                </div>

                {/* TENDER CONTROLS */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Settlement Method</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (30-Day Credit Ledger)</option>
                      <option value="UPI">Instant UPI / QR Code</option>
                      <option value="CHEQUE">Corporate Cheque</option>
                      <option value="CARD">Corporate Credit Card</option>
                      <option value="CASH">Cash Counter</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">
                      UTR / Bank Payment Reference
                    </label>
                    <input
                      type="text"
                      value={bankReference}
                      onChange={(e) => setBankReference(e.target.value)}
                      placeholder="e.g. UTR-HDFC-991204"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* CREDIT WARNING IF EXCEEDED */}
                {isCreditExceeded && (
                  <div className="bg-rose-950/60 border border-rose-600/50 rounded-xl p-2.5 text-xs text-rose-300 flex items-center space-x-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      <b>Credit Limit Breach:</b> This invoice exceeds buyer credit by ₹{formatPaise(excessCreditAmountPaise)}. Requires Management Approval!
                    </span>
                  </div>
                )}

                {/* POST BILL BUTTON */}
                <button
                  disabled={cart.length === 0}
                  onClick={handlePostInvoice}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-xl text-sm font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-lg shadow-blue-600/30"
                >
                  <FileText className="w-4 h-4" />
                  <span>Generate B2B Tax Invoice & Commit Outward Supply (₹{formatPaise(totalInvoiceAmountPaise)})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 2: B2B PARTIES & CREDIT MANAGEMENT
      --------------------------------------------------------------------- */}
      {activeTab === 'CUSTOMERS' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-blue-400" />
                  <span>B2B Parties Directory & Credit Control Ledger</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  {customers.length} Verified wholesale distributors, agencies, and retail supermarket chains.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => exportCustomersToCSV(customers)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export Customer Master</span>
                </button>

                <button
                  onClick={() => setShowNewCustomerModal(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Register B2B Customer</span>
                </button>
              </div>
            </div>

            {/* CUSTOMERS TABLE */}
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Party Code & GSTIN</th>
                    <th className="p-3">Buyer Company Name</th>
                    <th className="p-3">Location & State</th>
                    <th className="p-3 text-right">Credit Limit</th>
                    <th className="p-3 text-right">Current Ledger Balance</th>
                    <th className="p-3 text-right">Available Credit</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {customers.map((c) => {
                    const avail = Math.max(0, c.credit_limit_paise - c.current_balance_paise);
                    const usage =
                      c.credit_limit_paise > 0
                        ? Math.round((c.current_balance_paise / c.credit_limit_paise) * 100)
                        : 0;

                    return (
                      <tr key={c.id} className="hover:bg-slate-900/60 transition">
                        <td className="p-3 font-mono font-bold text-blue-300">
                          {c.entity_code}
                          <span className="block text-[10px] text-slate-400 font-normal">{c.gstin}</span>
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-white block">{c.trade_name || c.full_name}</span>
                          <span className="text-[10px] text-slate-400">{c.contact_person} • {c.phone}</span>
                        </td>
                        <td className="p-3">
                          <span className="text-white block">{c.city}</span>
                          <span className="text-[10px] text-slate-400">State {c.state_code}</span>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-300">
                          ₹{(c.credit_limit_paise / 100).toLocaleString('en-IN')}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-amber-400">
                          ₹{(c.current_balance_paise / 100).toLocaleString('en-IN')}
                          <span className="block text-[10px] text-slate-500 font-normal">{usage}% used</span>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-emerald-400">
                          ₹{(avail / 100).toLocaleString('en-IN')}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => {
                              syncCustomerInputs(c);
                              setActiveTab('INVOICING');
                            }}
                            className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                          >
                            New Invoice
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 2.5: WHOLESALE STOCK INWARD & GOODS RECEIVED (GRN)
      --------------------------------------------------------------------- */}
      {activeTab === 'STOCK_INWARD' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Key Financial Metric Tiles (Wholesale Sales vs Inward Purchases) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Wholesale B2B Sales (Sold)</span>
                <Receipt className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-xl font-black text-blue-400 font-mono mt-1">
                ₹{formatPaise(invoices.reduce((s, inv) => s + inv.total_paise, 0))}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {invoices.length} posted B2B tax invoices
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Inward Consignments (Purchased)</span>
                <Truck className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-xl font-black text-amber-400 font-mono mt-1">
                ₹{formatPaise(stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0))}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {stockVouchers.length} goods received notes (GRN)
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Gross Trading Spread</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              {(() => {
                const totalSold = invoices.reduce((s, inv) => s + inv.total_paise, 0);
                const totalPur = stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0);
                const diff = totalSold - totalPur;
                return (
                  <div className={`text-xl font-black font-mono mt-1 ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{formatPaise(Math.abs(diff))} {diff < 0 && '(Deficit)'}
                  </div>
                );
              })()}
              <div className="text-[10px] text-slate-500 mt-0.5">
                Wholesale Sales minus Inward Purchase Outflow
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Warehouse Inventory Volume</span>
                <Package className="w-4 h-4 text-purple-400" />
              </div>
              <div className="text-xl font-black text-purple-400 font-mono mt-1">
                {wholesaleStock.reduce((s, item) => s + item.current_stock, 0).toLocaleString('en-IN')} Units
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Across {wholesaleStock.length} wholesale commodities
              </div>
            </div>
          </div>

          {/* Subtabs Bar */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-3 rounded-xl shadow-sm">
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setStockSubTab('STOCK_ROSTER')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  stockSubTab === 'STOCK_ROSTER'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Warehouse Inventory ({wholesaleStock.length})
              </button>
              <button
                onClick={() => setStockSubTab('INWARD_ENTRY')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  stockSubTab === 'INWARD_ENTRY'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                + Inward Consignment & GRN
              </button>
              <button
                onClick={() => setStockSubTab('VOUCHERS_HISTORY')}
                className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  stockSubTab === 'VOUCHERS_HISTORY'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Goods Received Notes ({stockVouchers.length})
              </button>
            </div>

            <button
              onClick={() => setIsNewWholesaleItemModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>+ Add Wholesale Commodity</span>
            </button>
          </div>

          {/* SUBTAB 1: WAREHOUSE STOCK ROSTER */}
          {stockSubTab === 'STOCK_ROSTER' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div className="p-3 border-b border-slate-800 flex justify-between items-center text-xs font-bold text-slate-300">
                <span>Wholesale Central Warehouse Stock Master</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  Inward purchase rates vs outward B2B dispatch rates
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">SKU</th>
                      <th className="py-2.5 px-3">Wholesale Commodity Name</th>
                      <th className="py-2.5 px-3 text-center">Category</th>
                      <th className="py-2.5 px-3 text-center">Current Stock</th>
                      <th className="py-2.5 px-3 text-right">Inward Rate (Cost)</th>
                      <th className="py-2.5 px-3 text-right">Wholesale Rate (B2B)</th>
                      <th className="py-2.5 px-3 text-right">MRP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {wholesaleStock.map((item) => {
                      const isLowStock = item.current_stock <= item.reorder_level;
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono text-blue-400 text-[11px]">{item.sku}</td>
                          <td className="py-2.5 px-3 font-bold text-white">{item.name}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300">
                              {item.category}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold">
                            <span className={`px-2 py-0.5 rounded ${isLowStock ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60' : 'text-emerald-400'}`}>
                              {item.current_stock.toLocaleString('en-IN')} {item.unit}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                            ₹{formatPaise(item.purchase_rate_paise)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-400">
                            ₹{formatPaise(item.wholesale_rate_paise)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                            ₹{formatPaise(item.mrp_paise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SUBTAB 2: INWARD ENTRY FORM */}
          {stockSubTab === 'INWARD_ENTRY' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Manufacturer / Supplier</label>
                  <input
                    type="text"
                    value={inwardSupplier}
                    onChange={(e) => setInwardSupplier(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    placeholder="e.g. Adani Wilmar & Agro Mills"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier GSTIN</label>
                  <input
                    type="text"
                    value={inwardGstin}
                    onChange={(e) => setInwardGstin(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                    placeholder="24AAACA0000A1Z5"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Inward GRN / Bill #</label>
                  <input
                    type="text"
                    value={inwardVoucherNo}
                    onChange={(e) => setInwardVoucherNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Payment Mode</label>
                  <select
                    value={inwardPaymentMode}
                    onChange={(e) => setInwardPaymentMode(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (RTGS / NEFT)</option>
                    <option value="CREDIT">Manufacturer Credit Terms</option>
                    <option value="UPI">UPI Payment</option>
                    <option value="CASH">Cash Voucher</option>
                  </select>
                </div>
              </div>

              {/* Add Inward Line Form */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Add Bulk Consignment Line
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">Select Wholesale Item</label>
                    <select
                      value={selectedInwardItemId}
                      onChange={(e) => {
                        setSelectedInwardItemId(e.target.value);
                        const item = wholesaleStock.find((s) => s.id === e.target.value);
                        if (item) {
                          setInwardCostRupees((item.purchase_rate_paise / 100).toFixed(2));
                        }
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                    >
                      {wholesaleStock.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} (Stock: {item.current_stock} {item.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Inward Quantity</label>
                    <input
                      type="number"
                      value={inwardQty}
                      onChange={(e) => setInwardQty(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
                      placeholder="e.g. 100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Bulk Purchase Rate (₹ Cost)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={inwardCostRupees}
                      onChange={(e) => setInwardCostRupees(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                      placeholder="e.g. 1850.00"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        const item = wholesaleStock.find((s) => s.id === selectedInwardItemId);
                        if (!item) return;
                        const qtyNum = parseInt(inwardQty || '0', 10);
                        if (qtyNum <= 0) {
                          alert('Please enter a valid quantity greater than zero');
                          return;
                        }
                        const costPaise = inwardCostRupees
                          ? Math.round(parseFloat(inwardCostRupees) * 100)
                          : item.purchase_rate_paise;

                        setInwardLines((prev) => [
                          ...prev,
                          {
                            itemId: item.id,
                            name: item.name,
                            quantity: qtyNum,
                            purchaseRatePaise: costPaise,
                          },
                        ]);
                        setInwardQty('100');
                        setInwardCostRupees('');
                        posSound.playItemAdd();
                      }}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition cursor-pointer shadow-md shadow-blue-600/20"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add to GRN Bill</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Table of Inward Items */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
                <div className="p-3 border-b border-slate-800 font-bold text-xs text-slate-300 flex justify-between items-center">
                  <span>Inward Consignment Items ({inwardLines.length})</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    Increments warehouse inventory and generates an official Goods Received Note & Expense Voucher
                  </span>
                </div>

                <div className="overflow-x-auto">
                  {inwardLines.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs space-y-1">
                      <PackageCheck className="w-8 h-8 text-slate-600 mx-auto" />
                      <div>No wholesale items added to this inward yet</div>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">#</th>
                          <th className="py-2.5 px-3">Commodity Name</th>
                          <th className="py-2.5 px-3 text-center">Purchased Qty</th>
                          <th className="py-2.5 px-3 text-right">Inward Rate (₹)</th>
                          <th className="py-2.5 px-3 text-right">Total Consignment Expense</th>
                          <th className="py-2.5 px-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-sans">
                        {inwardLines.map((l, idx) => {
                          const lineTotal = l.quantity * l.purchaseRatePaise;
                          return (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="py-2 px-3 font-mono text-slate-500">{idx + 1}</td>
                              <td className="py-2 px-3 font-semibold text-white">{l.name}</td>
                              <td className="py-2 px-3 text-center font-mono font-bold text-emerald-400">
                                {l.quantity.toLocaleString('en-IN')} units
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                ₹{formatPaise(l.purchaseRatePaise)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                                ₹{formatPaise(lineTotal)}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setInwardLines((prev) => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-slate-500 hover:text-red-400 transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Subtotal & Commit */}
                <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 mr-2">Total Inward Purchase Outflow:</span>
                    <span className="text-xl font-black font-mono text-emerald-400">
                      ₹{formatPaise(inwardLines.reduce((s, l) => s + l.quantity * l.purchaseRatePaise, 0))}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={inwardLines.length === 0}
                    onClick={() => {
                      const voucher = WholesaleDataService.inwardWholesaleStock({
                        supplierName: inwardSupplier,
                        supplierGstin: inwardGstin,
                        supplierPhone: inwardPhone,
                        invoiceDate: inwardDate,
                        voucherNumber: inwardVoucherNo,
                        paymentMode: inwardPaymentMode,
                        remarks: inwardRemarks,
                        lines: inwardLines,
                      });

                      setWholesaleStock(WholesaleDataService.getWholesaleStock());
                      setStockVouchers(WholesaleDataService.getPurchaseVouchers());
                      setExpenses(WholesaleDataService.getExpenses());
                      setActivePurchaseVoucher(voucher);
                      setIsPurchaseVoucherModalOpen(true);
                      setInwardLines([]);
                      setInwardVoucherNo(`GRN-WH-${Date.now().toString().slice(-5)}`);
                      posSound.playSuccess();
                      showToast(`Consignment ${voucher.voucherNumber} inwarded! Stock updated and GRN Expense Bill issued.`);
                    }}
                    className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 transition cursor-pointer ${
                      inwardLines.length > 0
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                        : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                    }`}
                  >
                    <PackageCheck className="w-4 h-4" />
                    <span>Post Inward & Generate GRN Bill</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SUBTAB 3: VOUCHERS HISTORY */}
          {stockSubTab === 'VOUCHERS_HISTORY' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm p-4 space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Receipt className="w-4 h-4 text-blue-400" />
                    <span>Wholesale Goods Received Notes (GRN) & Inward Bills</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Official supplier inward bills with purchase costs, quantities, and proof of warehouse stock addition
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-400">Total Inward Value:</span>
                  <span className="text-base font-bold text-emerald-400 font-mono ml-2">
                    ₹{formatPaise(stockVouchers.reduce((s, v) => s + v.totalExpensePaise, 0))}
                  </span>
                </div>
              </div>

              {stockVouchers.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No wholesale inward vouchers recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">GRN #</th>
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Manufacturer / Supplier</th>
                        <th className="py-2.5 px-3 text-center">Items</th>
                        <th className="py-2.5 px-3">Payment Mode</th>
                        <th className="py-2.5 px-3 text-right">Consignment Expense</th>
                        <th className="py-2.5 px-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {stockVouchers.map((v, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-blue-400">{v.voucherNumber}</td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">{v.invoiceDate}</td>
                          <td className="py-2.5 px-3 font-semibold text-white">{v.supplierName}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{v.items.length} items</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                              {v.paymentMode}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                            ₹{formatPaise(v.totalExpensePaise)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setActivePurchaseVoucher(v);
                                setIsPurchaseVoucherModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold flex items-center space-x-1 mx-auto transition cursor-pointer"
                            >
                              <Eye className="w-3 h-3 text-blue-400" />
                              <span>View GRN Bill</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 3: VOLUME PRICING SLABS & REBATES
      --------------------------------------------------------------------- */}
      {activeTab === 'PRICING_TIERS' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Sliders className="w-4 h-4 text-blue-400" />
                  <span>Wholesale Volume Discount & Slab Rules</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Automated volume pricing tiers applied across major FMCG, beverage, and bulk commodity categories.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Product Category</th>
                    <th className="p-3 text-center">Min Bulk Threshold</th>
                    <th className="p-3 text-right w-36">Tier A Discount (%)</th>
                    <th className="p-3 text-right w-36">Tier B Bulk Discount (%)</th>
                    <th className="p-3 text-center w-36">Agreed Credit Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {pricingRules.map((rule, idx) => (
                    <tr key={rule.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3 font-bold text-white">{rule.category}</td>
                      <td className="p-3 text-center font-mono text-blue-300">{rule.min_bulk_units} Units</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={rule.tier_a_discount_bps / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...pricingRules];
                            updated[idx].tier_a_discount_bps = val;
                            setPricingRules(updated);
                            WholesaleDataService.savePricingRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.5"
                          value={rule.tier_b_discount_bps / 100}
                          onChange={(e) => {
                            const val = Math.max(0, parseFloat(e.target.value || '0') * 100);
                            const updated = [...pricingRules];
                            updated[idx].tier_b_discount_bps = val;
                            setPricingRules(updated);
                            WholesaleDataService.savePricingRules(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-right font-mono"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="number"
                          value={rule.payment_credit_days}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value || '1', 10));
                            const updated = [...pricingRules];
                            updated[idx].payment_credit_days = val;
                            setPricingRules(updated);
                            WholesaleDataService.savePricingRules(updated);
                          }}
                          className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white text-center font-mono inline-block"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 4: LOGISTICS EXPENSES & FLEET VOUCHERS
      --------------------------------------------------------------------- */}
      {activeTab === 'EXPENSES' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* RECORD EXPENSE FORM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
                <Wallet className="w-4 h-4 text-blue-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                  Record Logistics & Fleet Expense
                </h3>
              </div>

              <form onSubmit={handleAddExpense} className="space-y-3">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Expense Category</label>
                  <select
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="DIESEL_FLEET">Fleet Heavy-Duty Diesel Fueling</option>
                    <option value="TOLL_CHARGES">Highway FASTag & Tollway Reload</option>
                    <option value="PALLET_PACKAGING">Pallet Stretch Wrap & Corrugation</option>
                    <option value="LOADING_LABOUR">Labour Hamali & Mathadi Payout</option>
                    <option value="WAREHOUSE_RENT">Forklift Battery & Maintenance</option>
                    <option value="FREIGHT_LOGISTICS">Third-Party Transporter Freight</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Payee / Transporter</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bharat Petroleum Highway Card"
                    value={expPayee}
                    onChange={(e) => setExpPayee(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 25000"
                      value={expAmountInr}
                      onChange={(e) => setExpAmountInr(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Payment Mode</label>
                    <select
                      value={expMode}
                      onChange={(e) => setExpMode(e.target.value as PaymentMode)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                      <option value="UPI">UPI</option>
                      <option value="CASH">Cash Voucher</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Voucher Number</label>
                  <input
                    type="text"
                    required
                    value={expVoucherNo}
                    onChange={(e) => setExpVoucherNo(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Trip / Fleet Remarks</label>
                  <textarea
                    rows={2}
                    value={expRemarks}
                    onChange={(e) => setExpRemarks(e.target.value)}
                    placeholder="e.g. Mumbai-Pune 16-wheeler container dispatch fueling"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-md shadow-blue-600/30"
                >
                  Record Logistics Voucher
                </button>
              </form>
            </div>

            {/* EXPENSES TABLE */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h3 className="text-xs font-bold text-white uppercase tracking-wide">
                  Logistics & Distribution Vouchers Log
                </h3>
                <span className="text-xs font-mono font-bold text-blue-400">
                  Total: ₹{formatPaise(expenses.reduce((acc, e) => acc + e.amount_paise, 0))}
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-[500px]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Date / Voucher</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Payee & Purpose</th>
                      <th className="p-2.5">Mode</th>
                      <th className="p-2.5 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                    {expenses.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-900/60 transition">
                        <td className="p-2.5 font-mono text-slate-300">
                          {e.date}
                          <span className="block text-[10px] text-blue-400">{e.voucher_no}</span>
                        </td>
                        <td className="p-2.5 text-slate-300 font-medium">{e.category}</td>
                        <td className="p-2.5">
                          <span className="font-bold text-white block">{e.payee}</span>
                          <span className="text-[10px] text-slate-400">{e.remarks}</span>
                        </td>
                        <td className="p-2.5 font-mono text-slate-400">{e.payment_mode}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-white">
                          ₹{(e.amount_paise / 100).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 5: B2B SALES & GSTR-1 REPORTS
      --------------------------------------------------------------------- */}
      {activeTab === 'REPORTS' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* STATS OVERVIEW CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Total B2B Billing (Gross)
              </span>
              <div className="text-2xl font-black font-mono text-blue-400 mt-1">
                ₹{formatPaise(invoices.reduce((acc, inv) => acc + inv.total_paise, 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Across {invoices.length} Tax Invoices
              </span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Active B2B Credit Ledger
              </span>
              <div className="text-2xl font-black font-mono text-amber-400 mt-1">
                ₹{formatPaise(customers.reduce((acc, c) => acc + c.current_balance_paise, 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Due across {customers.length} distributor accounts</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                GST Liability (Output Tax)
              </span>
              <div className="text-2xl font-black font-mono text-emerald-400 mt-1">
                ₹
                {formatPaise(
                  invoices.reduce((acc, inv) => acc + inv.cgst_paise + inv.sgst_paise + inv.igst_paise, 0)
                )}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">GSTR-1 Table 4A eligible</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Logistics & Fleet Costs
              </span>
              <div className="text-2xl font-black font-mono text-purple-400 mt-1">
                ₹{formatPaise(expenses.reduce((acc, e) => acc + e.amount_paise, 0))}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">Fuel, tolls, and loading hamali</span>
            </div>
          </div>

          {/* ACTIONS & INVOICE TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4 text-blue-400" />
                  <span>Outward B2B Tax Invoices & Statutory Register</span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Compliant Table 4A B2B register ready for monthly GSTR-1 filing and Tally reconciliation.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Print Register</span>
                </button>

                <a
                  href={generateWholesaleDayBookWhatsAppLink(
                    new Date().toISOString().split('T')[0],
                    invoices.reduce((acc, i) => acc + i.total_paise, 0),
                    invoices.length,
                    invoices.filter((i) => i.eway_bill_no).length
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>WhatsApp Dispatch</span>
                </a>

                <button
                  onClick={() => exportWholesaleInvoicesToCSV(invoices)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Invoice / Date</th>
                    <th className="p-3">Buyer & GSTIN</th>
                    <th className="p-3">Place of Supply</th>
                    <th className="p-3 text-right">Taxable (₹)</th>
                    <th className="p-3 text-right">Taxes (₹)</th>
                    <th className="p-3 text-right">Total (₹)</th>
                    <th className="p-3 text-center">e-Way Bill</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-900/60 transition">
                      <td className="p-3 font-mono font-bold text-blue-300">
                        {inv.invoice_number}
                        <span className="block text-[10px] text-slate-500 font-normal">{inv.date}</span>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-white block">{inv.customer_name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{inv.customer_gstin}</span>
                      </td>
                      <td className="p-3 font-mono text-[11px]">
                        State {inv.state_code} ({inv.is_interstate ? 'IGST' : 'CGST+SGST'})
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">
                        ₹{(inv.subtotal_paise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-400">
                        ₹{((inv.cgst_paise + inv.sgst_paise + inv.igst_paise) / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-white">
                        ₹{(inv.total_paise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="p-3 text-center font-mono text-[10px]">
                        {inv.eway_bill_no ? (
                          <span className="text-amber-400 font-bold">{inv.eway_bill_no}</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            inv.payment_status === 'PAID'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {inv.payment_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          TAB 6: INVOICE CUSTOMIZER & LIVE WATERMARK PREVIEW
      --------------------------------------------------------------------- */}
      {activeTab === 'INVOICE_SETTINGS' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* SETTINGS FORM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-4">
              <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
                <Settings className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">B2B Tax Invoice & Watermark Customizer</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Company Legal Trade Name</label>
                  <input
                    type="text"
                    value={invoiceSettings.company_name}
                    onChange={(e) => {
                      const updated = { ...invoiceSettings, company_name: e.target.value };
                      setInvoiceSettings(updated);
                      WholesaleDataService.saveInvoiceSettings(updated);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">GSTIN (15-Digit)</label>
                    <input
                      type="text"
                      value={invoiceSettings.gstin}
                      onChange={(e) => {
                        const updated = { ...invoiceSettings, gstin: e.target.value };
                        setInvoiceSettings(updated);
                        WholesaleDataService.saveInvoiceSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 mb-1">PAN Number</label>
                    <input
                      type="text"
                      value={invoiceSettings.pan}
                      onChange={(e) => {
                        const updated = { ...invoiceSettings, pan: e.target.value };
                        setInvoiceSettings(updated);
                        WholesaleDataService.saveInvoiceSettings(updated);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-1">Warehouse & Registered Address</label>
                  <input
                    type="text"
                    value={invoiceSettings.address}
                    onChange={(e) => {
                      const updated = { ...invoiceSettings, address: e.target.value };
                      setInvoiceSettings(updated);
                      WholesaleDataService.saveInvoiceSettings(updated);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>

                {/* BANK DETAILS */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                  <span className="text-xs font-bold text-white block">Bank RTGS / NEFT Remittance Details</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold mb-1">Bank Name</label>
                      <input
                        type="text"
                        value={invoiceSettings.bank_name}
                        onChange={(e) => {
                          const updated = { ...invoiceSettings, bank_name: e.target.value };
                          setInvoiceSettings(updated);
                          WholesaleDataService.saveInvoiceSettings(updated);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold mb-1">IFSC Code</label>
                      <input
                        type="text"
                        value={invoiceSettings.ifsc_code}
                        onChange={(e) => {
                          const updated = { ...invoiceSettings, ifsc_code: e.target.value };
                          setInvoiceSettings(updated);
                          WholesaleDataService.saveInvoiceSettings(updated);
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 font-bold mb-1">Account Number</label>
                    <input
                      type="text"
                      value={invoiceSettings.account_number}
                      onChange={(e) => {
                        const updated = { ...invoiceSettings, account_number: e.target.value };
                        setInvoiceSettings(updated);
                        WholesaleDataService.saveInvoiceSettings(updated);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* WATERMARK ADJUSTER */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">Live Watermark Behind Tax Invoice</span>
                    <input
                      type="checkbox"
                      checked={invoiceSettings.show_watermark}
                      onChange={(e) => {
                        const updated = { ...invoiceSettings, show_watermark: e.target.checked };
                        setInvoiceSettings(updated);
                        WholesaleDataService.saveInvoiceSettings(updated);
                      }}
                      className="rounded border-slate-700 text-blue-600 focus:ring-0"
                    />
                  </div>

                  {invoiceSettings.show_watermark && (
                    <div className="space-y-2 pt-2 border-t border-slate-800">
                      <div>
                        <label className="block text-[10px] text-slate-400 font-bold mb-1">Watermark Text</label>
                        <input
                          type="text"
                          value={invoiceSettings.watermark_text}
                          onChange={(e) => {
                            const updated = { ...invoiceSettings, watermark_text: e.target.value };
                            setInvoiceSettings(updated);
                            WholesaleDataService.saveInvoiceSettings(updated);
                          }}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold mb-1">
                          <span>Watermark Opacity:</span>
                          <span>{Math.round(invoiceSettings.watermark_opacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.02"
                          max="0.35"
                          step="0.01"
                          value={invoiceSettings.watermark_opacity}
                          onChange={(e) => {
                            const updated = { ...invoiceSettings, watermark_opacity: parseFloat(e.target.value) };
                            setInvoiceSettings(updated);
                            WholesaleDataService.saveInvoiceSettings(updated);
                          }}
                          className="w-full accent-blue-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* LIVE PREVIEW OF WATERMARKED TAX INVOICE */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  <span>GST Tax Invoice Live Preview (A4 Format)</span>
                </span>
                <span className="text-[10px] text-slate-400">Original for Recipient</span>
              </div>

              {/* RENDERED INVOICE PREVIEW CONTAINER WITH WATERMARK */}
              <div className="bg-white text-slate-900 rounded-xl p-6 shadow-2xl relative overflow-hidden select-text text-xs min-h-[520px] flex flex-col justify-between">
                {/* WATERMARK LAYER */}
                {invoiceSettings.show_watermark && (
                  <div
                    className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
                    style={{ opacity: invoiceSettings.watermark_opacity }}
                  >
                    <span className="text-6xl font-black text-blue-900 -rotate-30 tracking-widest text-center uppercase">
                      {invoiceSettings.watermark_text}
                    </span>
                  </div>
                )}

                {/* INVOICE CONTENT (ABOVE WATERMARK) */}
                <div className="relative z-10 space-y-4">
                  {/* Header */}
                  <div className="flex justify-between items-start border-b border-slate-200 pb-3">
                    <div>
                      <h1 className="font-extrabold text-sm text-slate-900">{invoiceSettings.company_name}</h1>
                      <p className="text-[10px] text-slate-600 font-medium">{invoiceSettings.address}</p>
                      <p className="text-[10px] text-slate-700 font-mono font-bold">
                        GSTIN: {invoiceSettings.gstin} • PAN: {invoiceSettings.pan}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-900 border border-blue-300 rounded font-bold text-[10px]">
                        TAX INVOICE
                      </span>
                      <p className="font-mono text-xs font-bold mt-1">#B2B-2026-PREVIEW</p>
                      <p className="text-[10px] text-slate-500 font-mono">Date: {new Date().toISOString().split('T')[0]}</p>
                    </div>
                  </div>

                  {/* Buyer & Ship-To Details */}
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500 font-bold block">Details of Receiver / Billed to:</span>
                      <span className="font-bold text-slate-900">{selectedCustomer?.trade_name || 'Metro MegaMart Distributors'}</span>
                      <span className="block text-slate-600 font-mono">GSTIN: {selectedCustomer?.gstin || '27AABCU9603R1ZM'}</span>
                      <span className="text-slate-500 block">State: {selectedCustomer?.state_code || '27'} (Maharashtra)</span>
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 font-bold block">Consignee / Shipped to:</span>
                      <span className="text-slate-800">{selectedCustomer?.shipping_address || 'Bhiwandi Logistics Park, Thane'}</span>
                      <span className="block text-slate-500">e-Way Bill: 281900412891</span>
                      <span className="text-slate-500 block font-mono">Vehicle: MH-12-QW-4412</span>
                    </div>
                  </div>

                  {/* Lines Preview */}
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between font-bold border-b border-slate-300 pb-1">
                      <span>Item / HSN Description</span>
                      <span>Qty</span>
                      <span>Rate (₹)</span>
                      <span>Taxable (₹)</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>Tata Tea Gold 500g (HSN 0902)</span>
                      <span className="font-mono">50 PACK</span>
                      <span className="font-mono">₹295.00</span>
                      <span className="font-mono font-medium">₹14,750.00</span>
                    </div>
                    <div className="flex justify-between text-slate-800">
                      <span>Fortune Sunlite Sunflower Oil 1L (HSN 1512)</span>
                      <span className="font-mono">100 PCH</span>
                      <span className="font-mono">₹135.00</span>
                      <span className="font-mono font-medium">₹13,500.00</span>
                    </div>
                  </div>
                </div>

                {/* Footer and Bank RTGS */}
                <div className="relative z-10 border-t border-slate-200 pt-3 space-y-2 text-[11px]">
                  <div className="flex justify-between items-center text-sm font-black text-slate-900">
                    <span>Invoice Total (Tax Included):</span>
                    <span className="font-mono text-base text-blue-700">₹29,662.50</span>
                  </div>

                  <div className="bg-slate-50 p-2 rounded border border-slate-200 text-[10px] space-y-0.5">
                    <span className="font-bold text-slate-700 block">Bank Remittance Details:</span>
                    <p className="text-slate-600 font-mono">
                      Bank: {invoiceSettings.bank_name} • A/c: {invoiceSettings.account_number} • IFSC: {invoiceSettings.ifsc_code}
                    </p>
                  </div>

                  <div className="flex justify-between items-end pt-2">
                    <span className="text-[9px] text-slate-500 max-w-xs">{invoiceSettings.declaration}</span>
                    <div className="text-center">
                      <div className="w-28 border-b border-slate-400 mb-1"></div>
                      <span className="text-[9px] font-bold text-slate-700">Authorized Signatory</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 1: REGISTER NEW B2B CUSTOMER
      --------------------------------------------------------------------- */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Register New B2B Wholesale Customer</span>
              </h3>
              <button
                onClick={() => setShowNewCustomerModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterCustomer} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Customer Code</label>
                  <input
                    type="text"
                    required
                    value={newCustCode}
                    onChange={(e) => setNewCustCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-blue-300 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">GSTIN (15 Digits)</label>
                  <input
                    type="text"
                    required
                    placeholder="27AABCU9603R1ZM"
                    value={newCustGstin}
                    onChange={(e) => setNewCustGstin(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono uppercase text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Legal Registered Entity Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Reliance Retail Wholesale Logistics Pvt Ltd"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Trade / Commercial Name</label>
                <input
                  type="text"
                  placeholder="e.g. Reliance Smart Depot"
                  value={newCustTradeName}
                  onChange={(e) => setNewCustTradeName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Credit Limit (₹)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={newCustCreditLimit}
                    onChange={(e) => setNewCustCreditLimit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Payment Days</label>
                  <input
                    type="number"
                    min="0"
                    value={newCustTermsDays}
                    onChange={(e) => setNewCustTermsDays(parseInt(e.target.value || '30', 10))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">State Code</label>
                  <select
                    value={newCustStateCode}
                    onChange={(e) => setNewCustStateCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  >
                    <option value="27">27 (Maharashtra)</option>
                    <option value="24">24 (Gujarat)</option>
                    <option value="29">29 (Karnataka)</option>
                    <option value="07">07 (Delhi)</option>
                    <option value="33">33 (Tamil Nadu)</option>
                    <option value="09">09 (Uttar Pradesh)</option>
                    <option value="19">19 (West Bengal)</option>
                    <option value="36">36 (Telangana)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98200 12345"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">City</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mumbai / Pune / Surat"
                    value={newCustCity}
                    onChange={(e) => setNewCustCity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-1">Warehouse / Billing Address</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Plot No, Industrial Area, Road, Pincode"
                  value={newCustAddress}
                  onChange={(e) => setNewCustAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-md shadow-blue-600/30"
              >
                Register Party & Open Invoicing
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          MODAL 2: GENERATED B2B TAX INVOICE & DISPATCH
      --------------------------------------------------------------------- */}
      {showInvoiceModal && lastReceipt && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-xl rounded-2xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Tax Invoice Generated — #{lastReceipt.invoice_number}</span>
              </h3>
              <button
                onClick={() => setShowInvoiceModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* WATERMARKED PREVIEW CARD */}
            <div className="bg-white text-slate-900 rounded-xl p-5 shadow-lg relative overflow-hidden select-text text-xs space-y-3">
              {invoiceSettings.show_watermark && (
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-0"
                  style={{ opacity: invoiceSettings.watermark_opacity }}
                >
                  <span className="text-5xl font-black text-blue-900 -rotate-30 tracking-widest text-center uppercase">
                    {invoiceSettings.watermark_text}
                  </span>
                </div>
              )}

              <div className="relative z-10 space-y-3">
                <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                  <div>
                    <h2 className="font-extrabold text-sm">{invoiceSettings.company_name}</h2>
                    <p className="text-[10px] text-slate-600 font-mono">GSTIN: {invoiceSettings.gstin}</p>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-900 rounded font-bold text-[10px]">
                      TAX INVOICE
                    </span>
                    <p className="font-mono text-xs font-bold mt-1">#{lastReceipt.invoice_number}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded text-[11px]">
                  <div>
                    <span className="text-slate-500">Buyer:</span> <b>{selectedCustomer.trade_name || selectedCustomer.full_name}</b>
                    <span className="block text-slate-500 font-mono">GSTIN: {selectedCustomer.gstin}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500">Date:</span> {lastReceipt.invoice_date}
                    <span className="block text-slate-500 font-mono">
                      State {selectedCustomer.state_code} ({isInterState ? 'IGST' : 'CGST+SGST'})
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-[11px]">
                  {lastReceipt.lines.map((l) => (
                    <div key={l.id} className="flex justify-between text-slate-800">
                      <span>{l.name}</span>
                      <span className="font-mono">₹{formatPaise(l.line_total_paise)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-sm">
                  <span>Total Amount (INR):</span>
                  <span className="text-blue-700 font-mono">
                    ₹{formatPaise(lastReceipt.totals.total_amount_paise)}
                  </span>
                </div>
              </div>
            </div>

            {/* ACTION DISPATCH CONTROLS */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => window.print()}
                className="py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <Printer className="w-4 h-4 text-cyan-400" />
                <span>Print Tax Invoice</span>
              </button>

              <a
                href={generateB2BInvoiceWhatsAppLink(
                  selectedCustomer,
                  lastReceipt.invoice_number,
                  lastReceipt.totals.total_amount_paise,
                  isEwayBillRequired ? ewayDetails.eway_bill_no : undefined,
                  new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
                )}
                target="_blank"
                rel="noreferrer"
                className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition cursor-pointer shadow-md shadow-emerald-600/30 text-center"
              >
                <Share2 className="w-4 h-4" />
                <span>WhatsApp to Buyer</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add New Wholesale Commodity to Master Catalog */}
      {isNewWholesaleItemModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Package className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Add New Wholesale Trade Commodity</h3>
              </div>
              <button
                onClick={() => setIsNewWholesaleItemModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Commodity / Product Name *</label>
                <input
                  type="text"
                  value={newWhName}
                  onChange={(e) => setNewWhName(e.target.value)}
                  placeholder="e.g. Gemini Pure Edible Oil 15kg Tin"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">SKU / Code</label>
                  <input
                    type="text"
                    value={newWhSku}
                    onChange={(e) => setNewWhSku(e.target.value.toUpperCase())}
                    placeholder="OIL-GEM-15K"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={newWhCategory}
                    onChange={(e) => setNewWhCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="Edible Oils & Fats">Edible Oils & Fats</option>
                    <option value="Staples & Grains">Staples & Grains</option>
                    <option value="Beverages & Syrups">Beverages & Syrups</option>
                    <option value="Packaged Foods & Snacks">Packaged Foods & Snacks</option>
                    <option value="Personal Care & Hygiene">Personal Care & Hygiene</option>
                    <option value="Soaps & Detergents">Soaps & Detergents</option>
                    <option value="Dairy & Cold Chain">Dairy & Cold Chain</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Packaging Unit</label>
                  <select
                    value={newWhUnit}
                    onChange={(e) => setNewWhUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="tin">tin</option>
                    <option value="bag">bag</option>
                    <option value="case">case</option>
                    <option value="carton">carton</option>
                    <option value="box">box</option>
                    <option value="bucket">bucket</option>
                    <option value="can">can</option>
                    <option value="bundle">bundle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Inward Rate (₹ Cost)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newWhPurchaseRupees}
                    onChange={(e) => setNewWhPurchaseRupees(e.target.value)}
                    placeholder="1800.00"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Wholesale Rate (₹ B2B)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newWhSellingRupees}
                    onChange={(e) => setNewWhSellingRupees(e.target.value)}
                    placeholder="2050.00"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">MRP Printed Rate (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={newWhMrpRupees}
                  onChange={(e) => setNewWhMrpRupees(e.target.value)}
                  placeholder="2300.00"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewWholesaleItemModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!newWhName.trim()) {
                      alert('Commodity name is required');
                      return;
                    }
                    const costPaise = Math.round(parseFloat(newWhPurchaseRupees || '1000') * 100);
                    const sellPaise = Math.round(parseFloat(newWhSellingRupees || '1200') * 100);
                    const mrpPaise = Math.round(parseFloat(newWhMrpRupees || '1400') * 100);

                    const newItem: WholesaleStockItem = {
                      id: `wh_stk_${Date.now()}`,
                      sku: newWhSku.trim() || `SKU-${Date.now().toString().slice(-4)}`,
                      name: newWhName.trim(),
                      category: newWhCategory,
                      unit: newWhUnit,
                      current_stock: 0,
                      purchase_rate_paise: costPaise,
                      wholesale_rate_paise: sellPaise,
                      mrp_paise: mrpPaise,
                      reorder_level: 50,
                    };

                    const updated = WholesaleDataService.addWholesaleStockItem(newItem);
                    setWholesaleStock(updated);
                    setSelectedInwardItemId(newItem.id);
                    setInwardCostRupees((costPaise / 100).toFixed(2));
                    setIsNewWholesaleItemModalOpen(false);
                    setNewWhName('');
                    setNewWhSku('');
                    setNewWhPurchaseRupees('');
                    setNewWhSellingRupees('');
                    setNewWhMrpRupees('');
                    posSound.playSuccess();
                    showToast(`Added ${newItem.name} to warehouse master!`);
                  }}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-md shadow-blue-600/30 cursor-pointer"
                >
                  Save & Inward
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Printable & Shareable Wholesale GRN Expense Bill */}
      <PurchaseExpenseBillModal
        isOpen={isPurchaseVoucherModalOpen}
        onClose={() => setIsPurchaseVoucherModalOpen(false)}
        voucher={activePurchaseVoucher}
      />
    </div>
  );
};
