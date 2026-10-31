// ui/src/components/pos/PurchaseEntry.tsx
// Comprehensive Stock Inward, Expense Bill Generation & Purchase vs Sales Profitability Engine

import React, { useState, useEffect, useMemo } from 'react';
import {
  Truck,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowLeft,
  PackageCheck,
  FileText,
  DollarSign,
  TrendingUp,
  Receipt,
  Search,
  Building2,
  PlusCircle,
  Eye,
  Printer,
  Calendar,
  AlertCircle,
  IndianRupee,
} from 'lucide-react';
import { ResourceItem, BusinessProfile } from '../../types/pos';
import {
  formatPaise,
  parseRupeesToPaise,
  parseQtyToMilli,
  formatMilliQty,
} from '../../lib/tax';
import { apiPostPurchase, posStorage } from '../../lib/api';
import { ErpStorageService } from '../../lib/erpStorage';
import { posSound } from '../../lib/sound';
import {
  PurchaseExpenseBillModal,
  PurchaseExpenseVoucher,
} from '../common/PurchaseExpenseBillModal';
import { Modal } from '../common/Modal';

interface PurchaseEntryProps {
  products: ResourceItem[];
  businessDate: string;
  onBackToSales: () => void;
  onRefreshProducts: () => void;
}

interface PurchaseLine {
  resource_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity_milli: number;
  cost_price_paise: number;
}

const STORAGE_KEY_RETAIL_VOUCHERS = 'omnibill_retail_purchase_vouchers';

export const PurchaseEntry: React.FC<PurchaseEntryProps> = ({
  products,
  businessDate,
  onBackToSales,
  onRefreshProducts,
}) => {
  const [activeTab, setActiveTab] = useState<'NEW_INWARD' | 'VOUCHERS' | 'FINANCIAL_REPORT'>('NEW_INWARD');

  // Supplier & Voucher Header
  const [supplier, setSupplier] = useState('Metro Wholesale Pvt Ltd');
  const [supplierGstin, setSupplierGstin] = useState('27AABCU9603R1ZM');
  const [supplierPhone, setSupplierPhone] = useState('9820011223');
  const [invNumber, setInvNumber] = useState(`PUR-${Date.now().toString().slice(-6)}`);
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'BANK_TRANSFER' | 'CREDIT' | 'UPI'>('BANK_TRANSFER');
  const [remarks, setRemarks] = useState('');

  // Inward Lines
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [qtyInput, setQtyInput] = useState('10');
  const [costInput, setCostInput] = useState('');
  const [searchProductQuery, setSearchProductQuery] = useState('');

  // Status & Modals
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [activeVoucher, setActiveVoucher] = useState<PurchaseExpenseVoucher | null>(null);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [isCreateProductModalOpen, setIsCreateProductModalOpen] = useState(false);

  // New Product Form State
  const [newProdName, setNewProdName] = useState('');
  const [newProdSku, setNewProdSku] = useState('');
  const [newProdBarcode, setNewProdBarcode] = useState('');
  const [newProdUnit, setNewProdUnit] = useState('pcs');
  const [newProdSellingPrice, setNewProdSellingPrice] = useState('');
  const [newProdCostPrice, setNewProdCostPrice] = useState('');
  const [newProdTaxBps, setNewProdTaxBps] = useState(1800);

  // Saved Vouchers History
  const [savedVouchers, setSavedVouchers] = useState<PurchaseExpenseVoucher[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RETAIL_VOUCHERS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const business = posStorage.getBusinessProfile();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_RETAIL_VOUCHERS, JSON.stringify(savedVouchers));
    } catch {}
  }, [savedVouchers]);

  useEffect(() => {
    const handleSync = () => {
      onRefreshProducts();
    };
    window.addEventListener('omnibill_catalog_sync', handleSync);
    return () => {
      window.removeEventListener('omnibill_catalog_sync', handleSync);
    };
  }, [onRefreshProducts]);

  useEffect(() => {
    if ((!selectedProductId || !products.some((p) => p.id === selectedProductId)) && products.length > 0) {
      setSelectedProductId(products[0].id);
      setCostInput((products[0].cost_price_paise / 100).toFixed(2));
    }
  }, [products, selectedProductId]);

  // Selected product lookup
  const selectedProd = products.find((p) => p.id === selectedProductId) || products[0];

  useEffect(() => {
    if (selectedProd && !costInput) {
      setCostInput((selectedProd.cost_price_paise / 100).toFixed(2));
    }
  }, [selectedProd]);

  // Filter products for dropdown
  const filteredProducts = useMemo(() => {
    if (!searchProductQuery.trim()) return products;
    const q = searchProductQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
    );
  }, [products, searchProductQuery]);

  const handleAddLine = () => {
    const targetProd = selectedProd || filteredProducts[0] || products[0];
    if (!targetProd) return;
    const qMilli = parseQtyToMilli(qtyInput);
    if (qMilli <= 0) {
      alert('Please enter a valid quantity greater than zero');
      return;
    }

    const cPaise = costInput ? parseRupeesToPaise(costInput) : targetProd.cost_price_paise;

    setLines((prev) => [
      ...prev,
      {
        resource_id: targetProd.id,
        product_name: targetProd.name,
        sku: targetProd.sku,
        unit: targetProd.unit,
        quantity_milli: qMilli,
        cost_price_paise: cPaise,
      },
    ]);

    setQtyInput('10');
    setCostInput('');
    posSound.playItemAdd();
  };

  const handleRemoveLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalCostPaise = lines.reduce(
    (sum, l) => sum + Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
    0
  );

  // Quick Create New Product Modal Action
  const handleCreateNewProduct = () => {
    if (!newProdName.trim()) {
      alert('Product name is required');
      return;
    }

    const basePricePaise = parseRupeesToPaise(newProdSellingPrice || '100');
    const costPricePaise = parseRupeesToPaise(newProdCostPrice || '80');
    const sku = newProdSku.trim().toUpperCase() || `SKU-${Date.now().toString().slice(-4)}`;
    const barcode = newProdBarcode.trim() || `890${Date.now().toString().slice(-10)}`;

    let createdId = '';
    // 1. Add to ErpStorageService (Item Master & Inventory Lots)
    try {
      const created = ErpStorageService.addItem({
        sku,
        barcode,
        name: newProdName.trim(),
        hsn_sac: '9999',
        unit: newProdUnit,
        tax_rate_bps: newProdTaxBps,
        base_price_paise: basePricePaise,
        cost_price_paise: costPricePaise,
        is_stock_tracked: true,
        reorder_level_milli: 5000,
        category: 'General',
        initial_stock_milli: 0,
      });
      createdId = created.id;
    } catch (e) {
      console.warn('Failed to add item to ErpStorageService:', e);
    }

    // 2. Refresh products list
    onRefreshProducts();

    // Select the new product automatically using authoritative ID
    if (createdId) {
      setSelectedProductId(createdId);
    }
    setCostInput((costPricePaise / 100).toFixed(2));
    setIsCreateProductModalOpen(false);

    const createdName = newProdName.trim();
    // Reset form
    setNewProdName('');
    setNewProdSku('');
    setNewProdBarcode('');
    setNewProdSellingPrice('');
    setNewProdCostPrice('');

    posSound.playSuccess();
    alert(`Added "${createdName}" to catalog! You can now inward its stock.`);
  };

  // Submit Purchase, Update Stock, and Generate Expense Bill
  const handleSubmitPurchase = async () => {
    if (lines.length === 0) return;
    setIsSubmitting(true);
    try {
      const res = await apiPostPurchase({
        supplier,
        invoice_number: invNumber,
        invoice_date: businessDate,
        lines: lines.map((l) => ({
          resource_id: l.resource_id,
          sku: l.sku,
          quantity_milli: l.quantity_milli,
          cost_price_paise: l.cost_price_paise,
        })),
      });

      if (!res.success) {
        posSound.playWarning();
        alert(`Failed to post purchase: ${res.error || 'Unknown error'}`);
        return;
      }

      // Build Purchase Expense Voucher
      const voucher: PurchaseExpenseVoucher = {
        voucherNumber: invNumber,
        invoiceDate: businessDate,
        supplierName: supplier,
        supplierGstin: supplierGstin || undefined,
        supplierPhone: supplierPhone || undefined,
        businessName: business.legal_name || business.trade_name || 'Retail Supermarket',
        businessGstin: business.gstin || undefined,
        businessAddress: business.address_line1 || undefined,
        paymentMode,
        remarks: remarks || undefined,
        items: lines.map((l) => ({
          name: l.product_name,
          sku: l.sku,
          quantity: l.quantity_milli / 1000,
          unit: l.unit,
          costPricePaise: l.cost_price_paise,
          lineTotalPaise: Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
        })),
        totalExpensePaise: totalCostPaise,
        verticalType: 'RETAIL',
      };

      setSavedVouchers((prev) => [voucher, ...prev]);
      setActiveVoucher(voucher);
      setIsVoucherModalOpen(true);
      posSound.playSuccess();

      setSuccessMessage(`Purchase ${invNumber} posted! Stock updated and Expense Bill generated.`);
      setLines([]);
      setInvNumber(`PUR-${Date.now().toString().slice(-6)}`);
      onRefreshProducts();
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      console.error('Failed to post purchase:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Financial Calculations: Sales Sold vs Purchases Cost
  const salesHistory = posStorage.getRecentSales();
  const totalSalesRevenuePaise = useMemo(() => {
    return salesHistory.reduce((sum, s) => sum + s.totals.total_amount_paise, 0);
  }, [salesHistory]);

  const totalPurchasesCostPaise = useMemo(() => {
    return savedVouchers.reduce((sum, v) => sum + v.totalExpensePaise, 0);
  }, [savedVouchers]);

  const grossProfitPaise = totalSalesRevenuePaise - totalPurchasesCostPaise;
  const marginPercentage =
    totalSalesRevenuePaise > 0
      ? ((grossProfitPaise / totalSalesRevenuePaise) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto font-sans">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onBackToSales}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="Back to Sales POS (F8)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-400" />
              <span>Purchases, Stock Inward & Expense Invoicing (F9)</span>
            </h2>
            <div className="text-xs text-slate-400">
              Inward inventory at cost price, generate expense vouchers, and track purchase-vs-sales profitability
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center space-x-2">
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('NEW_INWARD')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'NEW_INWARD'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Stock Inwarding
            </button>
            <button
              onClick={() => setActiveTab('VOUCHERS')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'VOUCHERS'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Expense Bills ({savedVouchers.length})
            </button>
            <button
              onClick={() => setActiveTab('FINANCIAL_REPORT')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'FINANCIAL_REPORT'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              P&L Profitability Report
            </button>
          </div>

          <button
            type="button"
            onClick={onBackToSales}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition cursor-pointer"
          >
            Sales POS (F8)
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="bg-emerald-950/80 border border-emerald-600/60 p-3.5 rounded-xl text-emerald-300 text-xs flex items-center justify-between shadow-lg animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">{successMessage}</span>
          </div>
          {activeVoucher && (
            <button
              onClick={() => setIsVoucherModalOpen(true)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold cursor-pointer"
            >
              View Expense Bill
            </button>
          )}
        </div>
      )}

      {/* TAB 1: NEW STOCK INWARD */}
      {activeTab === 'NEW_INWARD' && (
        <div className="space-y-4">
          {/* Supplier & Invoice Header Card */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier Name</label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                placeholder="e.g. Metro Wholesale / Super Stockist"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier GSTIN</label>
              <input
                type="text"
                value={supplierGstin}
                onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                placeholder="27AABCU9603R1ZM"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Inward Voucher #</label>
              <input
                type="text"
                value={invNumber}
                onChange={(e) => setInvNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Payment Mode</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS)</option>
                <option value="UPI">UPI Payment</option>
                <option value="CASH">Cash Outflow</option>
                <option value="CREDIT">Supplier Credit (Pay Later)</option>
              </select>
            </div>
          </div>

          {/* Add Inward Item Form Bar */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <span>Select Item to Inward</span>
                <span className="text-[11px] text-slate-500 font-normal lowercase">
                  ({products.length} products in catalog)
                </span>
              </h4>
              <button
                type="button"
                onClick={() => setIsCreateProductModalOpen(true)}
                className="px-3 py-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ Create New Product</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {/* Product Selector */}
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Choose Catalog Product</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const prod = products.find((p) => p.id === e.target.value);
                    if (prod) {
                      setCostInput((prod.cost_price_paise / 100).toFixed(2));
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current Stock: {formatMilliQty(p.stock_milli)} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Purchased Quantity */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Purchased Qty ({selectedProd?.unit || 'units'})
                </label>
                <input
                  type="number"
                  step="any"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono font-bold"
                  placeholder="e.g. 50"
                />
              </div>

              {/* Purchase Rate (Cost Price) */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Purchase Rate (₹ Cost)</label>
                <input
                  type="number"
                  step="0.01"
                  value={costInput}
                  onChange={(e) => setCostInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                  placeholder={selectedProd ? (selectedProd.cost_price_paise / 100).toFixed(2) : '0.00'}
                />
              </div>

              {/* Add Button */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center justify-center space-x-1.5 transition-colors cursor-pointer shadow-md shadow-blue-600/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add to Inward Bill</span>
                </button>
              </div>
            </div>
          </div>

          {/* Table of Inward Items */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm">
            <div className="p-3 border-b border-slate-800 font-bold text-xs text-slate-300 flex items-center justify-between">
              <span>Inward Items to be Credited ({lines.length})</span>
              <span className="text-[11px] text-slate-500 font-normal">
                Clicking Post will increment inventory and issue an Expense Bill
              </span>
            </div>

            <div className="overflow-x-auto">
              {lines.length === 0 ? (
                <div className="p-10 text-center text-slate-500 text-xs space-y-1">
                  <PackageCheck className="w-8 h-8 text-slate-600 mx-auto" />
                  <div className="font-semibold text-slate-400">No Inward Items Added Yet</div>
                  <p className="text-[11px] text-slate-600">
                    Select a product from the list above, enter the quantity & purchase rate, and click Add.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3 text-center">SKU</th>
                      <th className="py-2.5 px-3 text-center">Purchased Qty</th>
                      <th className="py-2.5 px-3 text-right">Purchase Rate (₹)</th>
                      <th className="py-2.5 px-3 text-right">Line Expense Total</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {lines.map((l, idx) => {
                      const lineTotal = Math.round((l.quantity_milli * l.cost_price_paise) / 1000);
                      return (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-mono text-slate-500">{idx + 1}</td>
                          <td className="py-2 px-3 text-slate-100 font-medium">{l.product_name}</td>
                          <td className="py-2 px-3 text-center font-mono text-slate-400 text-[11px]">{l.sku}</td>
                          <td className="py-2 px-3 text-center font-mono font-bold text-white">
                            {formatMilliQty(l.quantity_milli)} {l.unit}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-300">
                            {formatPaise(l.cost_price_paise)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                            {formatPaise(lineTotal)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="p-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                              title="Remove item"
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

            {/* Bottom Subtotal & Submit */}
            <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 mr-2">Total Inward Purchase Expense:</span>
                <span className="text-xl font-black font-mono text-emerald-400">
                  {formatPaise(totalCostPaise)}
                </span>
                <span className="text-xs text-slate-500 ml-2">({lines.length} items)</span>
              </div>
              <button
                type="button"
                onClick={handleSubmitPurchase}
                disabled={lines.length === 0 || isSubmitting}
                className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all ${
                  lines.length > 0 && !isSubmitting
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
                    : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                }`}
              >
                <PackageCheck className="w-4 h-4" />
                <span>{isSubmitting ? 'Posting...' : 'Post Purchase & Generate Expense Bill'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PAST PURCHASE EXPENSE VOUCHERS */}
      {activeTab === 'VOUCHERS' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm space-y-3 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>Recorded Purchase Expense Bills & Inward Vouchers</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Proof of purchase expenses and inventory inwards. Click any voucher to reprint or share on WhatsApp.
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400">Total Purchase Outflow:</span>
              <span className="text-base font-bold text-emerald-400 font-mono ml-2">
                {formatPaise(totalPurchasesCostPaise)}
              </span>
            </div>
          </div>

          {savedVouchers.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No purchase expense bills recorded yet. Create an inward above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Voucher #</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Supplier</th>
                    <th className="py-2.5 px-3 text-center">Items</th>
                    <th className="py-2.5 px-3">Payment Mode</th>
                    <th className="py-2.5 px-3 text-right">Expense Amount</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {savedVouchers.map((v, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-400">{v.voucherNumber}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-300">{v.invoiceDate}</td>
                      <td className="py-2.5 px-3 text-white font-medium">{v.supplierName}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{v.items.length} items</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                          {v.paymentMode}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                        {formatPaise(v.totalExpensePaise)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveVoucher(v);
                            setIsVoucherModalOpen(true);
                          }}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold flex items-center space-x-1 mx-auto transition cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-blue-400" />
                          <span>View Bill</span>
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

      {/* TAB 3: FINANCIAL REPORT (PURCHASE VS SALES PROFITABILITY) */}
      {activeTab === 'FINANCIAL_REPORT' && (
        <div className="space-y-4">
          {/* Key Metric Tiles */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Total Sales Revenue */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Amount Sold (Sales Revenue)</span>
                <DollarSign className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-black text-blue-400 font-mono mt-1">
                {formatPaise(totalSalesRevenuePaise)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {salesHistory.length} completed counter sales
              </div>
            </div>

            {/* Total Purchases Cost */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Amount Purchased (Inward Cost)</span>
                <Truck className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-amber-400 font-mono mt-1">
                {formatPaise(totalPurchasesCostPaise)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {savedVouchers.length} stock inward purchase bills
              </div>
            </div>

            {/* Gross Profit Margin */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Gross Trading Margin</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div className={`text-2xl font-black font-mono mt-1 ${grossProfitPaise >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPaise(Math.abs(grossProfitPaise))}
                {grossProfitPaise < 0 && ' (Deficit)'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Sales Revenue minus Purchase Cost
              </div>
            </div>

            {/* Profit Margin % */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-sm">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Profit Margin</span>
                <span className="text-[11px] font-mono text-emerald-400 font-bold">%</span>
              </div>
              <div className="text-2xl font-black text-purple-400 font-mono mt-1">
                {marginPercentage}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Gross margin realization
              </div>
            </div>
          </div>

          {/* Detailed Financial Explanation */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <h4 className="text-sm font-bold text-white flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Financial Profit & Loss Breakdown</span>
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              By tracking both the <b>purchase rate</b> at which goods were inwarded and the <b>selling rate</b> at which customers bought them, OmniBill computes the exact trading spread. This guarantees that financial statements accurately reflect gross profit without relying on estimated inventory costs.
            </p>

            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <span className="text-slate-500 text-[11px]">Total Realized Inflow</span>
                <div className="font-bold text-white font-mono text-sm">
                  {formatPaise(totalSalesRevenuePaise)}
                </div>
                <div className="text-[10px] text-slate-400">Cash, UPI & Card sales</div>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 text-[11px]">Total Stock Acquisition Cost</span>
                <div className="font-bold text-amber-400 font-mono text-sm">
                  {formatPaise(totalPurchasesCostPaise)}
                </div>
                <div className="text-[10px] text-slate-400">Total inward purchase expenses</div>
              </div>
              <div className="space-y-1">
                <span className="text-slate-500 text-[11px]">Net Commercial Surplus</span>
                <div className="font-bold text-emerald-400 font-mono text-sm">
                  {formatPaise(grossProfitPaise)}
                </div>
                <div className="text-[10px] text-slate-400">Spread earned on sold products</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create New Product on the Fly */}
      <Modal
        isOpen={isCreateProductModalOpen}
        onClose={() => setIsCreateProductModalOpen(false)}
        title="Create New Product in Catalog"
        width="max-w-md"
        icon={<PlusCircle className="w-5 h-5 text-indigo-400" />}
      >
        <div className="space-y-3 text-xs">
          <p className="text-slate-400 text-[11px]">
            Add a new item to your master product catalog. You can immediately inward its initial batch with purchase rate and quantity.
          </p>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Product Name *</label>
            <input
              type="text"
              value={newProdName}
              onChange={(e) => setNewProdName(e.target.value)}
              placeholder="e.g. Britannia Bourbon Biscuits 120g"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">SKU / Code</label>
              <input
                type="text"
                value={newProdSku}
                onChange={(e) => setNewProdSku(e.target.value)}
                placeholder="BOURBON-120"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Barcode</label>
              <input
                type="text"
                value={newProdBarcode}
                onChange={(e) => setNewProdBarcode(e.target.value)}
                placeholder="890123456789"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Unit</label>
              <select
                value={newProdUnit}
                onChange={(e) => setNewProdUnit(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="pcs">pcs (Pieces)</option>
                <option value="pkt">pkt (Packets)</option>
                <option value="kg">kg (Kilograms)</option>
                <option value="ltr">ltr (Litres)</option>
                <option value="box">box (Boxes)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Purchase Cost (₹)</label>
              <input
                type="number"
                step="0.01"
                value={newProdCostPrice}
                onChange={(e) => setNewProdCostPrice(e.target.value)}
                placeholder="25.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Selling Price (₹)</label>
              <input
                type="number"
                step="0.01"
                value={newProdSellingPrice}
                onChange={(e) => setNewProdSellingPrice(e.target.value)}
                placeholder="30.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">GST Bracket</label>
            <select
              value={newProdTaxBps}
              onChange={(e) => setNewProdTaxBps(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
            >
              <option value={0}>0% (Exempt)</option>
              <option value={500}>5% GST</option>
              <option value={1200}>12% GST</option>
              <option value={1800}>18% GST</option>
              <option value={2800}>28% GST</option>
            </select>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsCreateProductModalOpen(false)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateNewProduct}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Save Product & Use in Inward
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Printable & Shareable Purchase Expense Bill */}
      <PurchaseExpenseBillModal
        isOpen={isVoucherModalOpen}
        onClose={() => setIsVoucherModalOpen(false)}
        voucher={activeVoucher}
      />
    </div>
  );
};
export default PurchaseEntry;
