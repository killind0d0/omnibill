// ui/src/verticals/RetailPOS.tsx
// Retail Store Mode: Fast Barcode Lookup, MRP Discount Tags, Quick Tender Calculator, 80mm Thermal Receipt

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Barcode,
  Search,
  Plus,
  Minus,
  Trash2,
  DollarSign,
  Printer,
  Sparkles,
  QrCode,
  CheckCircle2,
  CreditCard,
  RotateCcw,
  Tag,
  ArrowRight,
  Receipt,
  Clock,
  User,
} from 'lucide-react';
import {
  ResourceItem,
  VerticalCartLine,
  PaymentMode,
  PaymentDetails,
  PostedTransactionReceipt,
} from './types';
import { VerticalIPCBridge } from './ipc';
import { computeSaleTotals, formatPaise, parseRupeesToPaise, computeLineSubtotalPaise } from '../lib/tax';
import { buildUpiString, generateQrDataUrl } from '../lib/upi';
import { useBarcodeScanner } from '../lib/scanner';

export const RetailPOS: React.FC = () => {
  // State
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cart, setCart] = useState<VerticalCartLine[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Customer state
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('Walk-in Customer');

  // Payment state
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [cashTenderedInput, setCashTenderedInput] = useState<string>('');
  const [showSlipModal, setShowSlipModal] = useState<boolean>(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);
  const [upiQrUrl, setUpiQrUrl] = useState<string>('');
  const [scanNotification, setScanNotification] = useState<string | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Load catalog on mount
  useEffect(() => {
    VerticalIPCBridge.getResources('RETAIL').then((items) => {
      setCatalog(items);
    });
  }, []);

  // Barcode Scanner wedge hook
  useBarcodeScanner({
    onScan: (scannedCode) => {
      handleBarcodeScan(scannedCode);
    },
    enabled: true,
  });

  // Handle scanned or entered barcode
  const handleBarcodeScan = (barcode: string) => {
    const cleanCode = barcode.trim();
    if (!cleanCode) return;

    const matchedItem = catalog.find(
      (item) => item.barcode === cleanCode || item.sku.toLowerCase() === cleanCode.toLowerCase()
    );

    if (matchedItem) {
      addItemToCart(matchedItem);
      setScanNotification(`Scanned: ${matchedItem.name}`);
      setTimeout(() => setScanNotification(null), 2500);
      setBarcodeInput('');
    } else {
      setScanNotification(`⚠️ Barcode not found: ${cleanCode}`);
      setTimeout(() => setScanNotification(null), 3000);
    }
  };

  // Add Item to Cart
  const addItemToCart = (item: ResourceItem) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((line) => line.resource_id === item.id);
      if (existingIndex >= 0) {
        const copy = [...prev];
        const existing = copy[existingIndex];
        const newQty = existing.quantity_milli + 1000;
        copy[existingIndex] = {
          ...existing,
          quantity_milli: newQty,
        };
        return copy;
      }

      // Maintain base_price_paise as unit_price_paise with discount_paise = 0
      // This ensures taxable_paise is exactly item.base_price_paise and prevents double-deduction.
      const newLine: VerticalCartLine = {
        id: `line_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        resource_id: item.id,
        sku: item.sku,
        barcode: item.barcode,
        name: item.name,
        hsn_sac: item.hsn_sac,
        unit: item.unit,
        tax_rate_bps: item.tax_rate_bps,
        quantity_milli: 1000,
        unit_price_paise: item.base_price_paise,
        mrp_paise: item.mrp_paise,
        discount_paise: 0,
        gross_paise: item.base_price_paise,
        taxable_paise: item.base_price_paise,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: item.base_price_paise,
      };

      return [...prev, newLine];
    });
  };

  const updateQuantity = (lineId: string, deltaMilli: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.id !== lineId) return line;
          const newQty = line.quantity_milli + deltaMilli;
          return newQty > 0 ? { ...line, quantity_milli: newQty } : null;
        })
        .filter((l): l is VerticalCartLine => l !== null)
    );
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  };

  const clearCart = () => {
    setCart([]);
    setCashTenderedInput('');
  };

  // Compute sale totals with tax calculation
  const computedDocument = useMemo(() => {
    const rawLines = cart.map((line) => ({
      ...line,
      // Pass required fields for lib/tax.ts
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

    return computeSaleTotals(rawLines as any, 'EXCLUSIVE', '27', '27');
  }, [cart]);

  // Compute Total Savings from MRP
  const totalSavingsPaise = useMemo(() => {
    return cart.reduce((acc, line) => {
      if (line.mrp_paise && line.mrp_paise > line.unit_price_paise) {
        const itemDiscount = computeLineSubtotalPaise(
          line.mrp_paise - line.unit_price_paise,
          line.quantity_milli
        );
        return acc + itemDiscount;
      }
      return acc + computeLineSubtotalPaise(line.discount_paise, line.quantity_milli);
    }, 0);
  }, [cart]);

  // Payment Tender Calculation
  const totalPayablePaise = computedDocument.totals.total_amount_paise;
  const cashTenderedPaise = cashTenderedInput ? parseRupeesToPaise(cashTenderedInput) : 0;
  const changeDuePaise = Math.max(0, cashTenderedPaise - totalPayablePaise);
  const remainingDuePaise = Math.max(0, totalPayablePaise - cashTenderedPaise);

  // Set Cash Tendered to Exact or Presets
  const setExactTender = () => {
    setCashTenderedInput((totalPayablePaise / 100).toFixed(2));
  };

  const addPresetTender = (rupees: number) => {
    const current = cashTenderedInput ? parseFloat(cashTenderedInput) : 0;
    setCashTenderedInput((current + rupees).toFixed(2));
  };

  // Generate UPI QR code when UPI mode is chosen
  useEffect(() => {
    if (paymentMode === 'UPI' && totalPayablePaise > 0) {
      const upiUri = buildUpiString({
        vpa: 'omnibill.store@okaxis',
        payeeName: 'OmniBill Retail Supermarket',
        amountPaise: totalPayablePaise,
        invoiceNumber: 'RET-QUICK-PAY',
        note: 'Retail POS Bill Payment',
      });
      generateQrDataUrl(upiUri, { width: 180 }).then(setUpiQrUrl);
    } else {
      setUpiQrUrl('');
    }
  }, [paymentMode, totalPayablePaise]);

  // Post Transaction to SQLite & Show 80mm Slip
  const handlePostTransaction = async () => {
    if (cart.length === 0) return;

    if (paymentMode === 'CASH' && cashTenderedPaise < totalPayablePaise) {
      alert(`Tender amount is insufficient. Amount due: ${formatPaise(totalPayablePaise)}, Tendered: ${formatPaise(cashTenderedPaise)}`);
      return;
    }

    const tenderAmount = paymentMode === 'CASH' ? cashTenderedPaise : totalPayablePaise;

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: tenderAmount,
      cash_tendered_paise: paymentMode === 'CASH' ? cashTenderedPaise : undefined,
      change_due_paise: paymentMode === 'CASH' ? changeDuePaise : 0,
      reference_number: paymentMode === 'UPI' ? `UPI-${Date.now().toString().slice(-6)}` : undefined,
    };

    const receipt = await VerticalIPCBridge.postTransaction({
      verticalMode: 'RETAIL',
      entityType: 'CUSTOMER',
      entityId: customerPhone ? `cust_${customerPhone}` : 'cust_walkin_cash',
      entityName: customerName,
      entityDetails: {
        phone: customerPhone,
        state_code: '27',
      },
      lines: cart,
      totals: computedDocument.totals,
      payment,
      notes: `Retail Cashier Sale. Customer Savings: ${formatPaise(totalSavingsPaise)}`,
    });

    setLastReceipt(receipt);
    setShowSlipModal(true);
    clearCart();
  };

  // Filter catalog items
  const filteredCatalog = useMemo(() => {
    return catalog.filter((item) => {
      const matchesSearch =
        searchQuery === '' ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.barcode && item.barcode.includes(searchQuery));

      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [catalog, searchQuery, selectedCategory]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    catalog.forEach((c) => {
      if (c.category) cats.add(c.category);
    });
    return ['ALL', ...Array.from(cats)];
  }, [catalog]);

  return (
    <div className="flex flex-col lg:flex-row h-full w-full gap-4 p-4 bg-slate-950 text-slate-100 font-sans">
      {/* LEFT COLUMN: Fast Barcode Lookup + Item Quick Catalog */}
      <div className="flex-1 flex flex-col space-y-4 min-w-0">
        {/* Top Action Bar: Barcode Input with Auto-focus */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg backdrop-blur">
          <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
            {/* Barcode Scanner Input */}
            <div className="relative flex-1 w-full">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-400">
                <Barcode className="w-5 h-5 animate-pulse" />
              </div>
              <input
                ref={barcodeInputRef}
                type="text"
                placeholder="Scan Barcode (F2) or type SKU / Barcode and press Enter..."
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleBarcodeScan(barcodeInput);
                  }
                }}
                className="w-full pl-11 pr-24 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-sm font-mono text-emerald-300 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
              />
              <button
                onClick={() => handleBarcodeScan(barcodeInput)}
                type="button"
                className="absolute right-1.5 top-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition"
              >
                Scan Add
              </button>
            </div>

            {/* Customer Quick Tag */}
            <div className="flex items-center space-x-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-44">
                <input
                  type="text"
                  placeholder="Cust Phone (Loyalty)"
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    if (e.target.value.length === 10) {
                      setCustomerName(`Loyalty Member (${e.target.value.slice(-4)})`);
                    }
                  }}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="text-xs px-2.5 py-1.5 bg-slate-800 text-slate-300 rounded-xl flex items-center space-x-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span className="truncate max-w-[120px]">{customerName}</span>
              </div>
            </div>
          </div>

          {/* Scan feedback alert */}
          {scanNotification && (
            <div className="mt-2.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs flex items-center space-x-2 animate-fadeIn">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="font-medium">{scanNotification}</span>
            </div>
          )}
        </div>

        {/* Category Pills & Quick Filter Search */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-1.5 overflow-x-auto py-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                type="button"
                className={`px-3 py-1 text-xs rounded-lg transition-all font-medium ${
                  selectedCategory === cat
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-slate-600"
            />
          </div>
        </div>

        {/* Quick Item Grid with MRP & Discount Tags */}
        <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 pr-1">
          {filteredCatalog.map((item) => {
            const hasDiscount = item.mrp_paise && item.mrp_paise > item.base_price_paise;
            const savingsPaise = hasDiscount ? (item.mrp_paise! - item.base_price_paise) : 0;
            const discountPercent = hasDiscount
              ? Math.round((savingsPaise / item.mrp_paise!) * 100)
              : 0;

            return (
              <div
                key={item.id}
                onClick={() => addItemToCart(item)}
                className="group relative flex flex-col justify-between p-3 bg-slate-900/80 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/50 rounded-xl cursor-pointer transition-all duration-150 shadow-sm hover:shadow-emerald-950/40"
              >
                {/* MRP Discount Tag Badge */}
                {hasDiscount && (
                  <div className="absolute -top-2 -right-2 bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-md flex items-center space-x-1">
                    <Tag className="w-2.5 h-2.5" />
                    <span>{discountPercent}% OFF</span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-1">
                    <span>{item.barcode || item.sku}</span>
                    <span className="text-emerald-400/80 text-[10px]">{item.tax_rate_bps / 100}% GST</span>
                  </div>
                  <h4 className="text-xs font-semibold text-slate-200 line-clamp-2 group-hover:text-emerald-300 transition-colors">
                    {item.name}
                  </h4>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-end justify-between">
                  <div>
                    {hasDiscount && (
                      <div className="text-[10px] text-slate-500 line-through">
                        {formatPaise(item.mrp_paise!)}
                      </div>
                    )}
                    <div className="text-sm font-bold text-slate-100">
                      {formatPaise(item.base_price_paise)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="p-1.5 bg-slate-800 group-hover:bg-emerald-600 text-slate-300 group-hover:text-white rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT COLUMN: Active Cart + Quick Tender Calculator + Slip Actions */}
      <div className="w-full lg:w-[420px] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Cart Header */}
        <div className="px-4 py-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Receipt className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">Current Cart</h3>
            <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[11px] font-mono">
              {cart.length} items
            </span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              type="button"
              className="text-slate-400 hover:text-rose-400 p-1 text-xs flex items-center space-x-1 transition"
              title="Clear Cart"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Cart Items Table */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-slate-800/40">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-2">
              <Barcode className="w-10 h-10 stroke-[1.5] text-slate-600 animate-pulse" />
              <p className="text-xs">Scan an item barcode or click a product from catalog to begin.</p>
            </div>
          ) : (
            cart.map((line) => {
              const qtyUnits = line.quantity_milli / 1000;
              const hasDiscount = line.mrp_paise && line.mrp_paise > line.unit_price_paise;
              const savingsPaise = hasDiscount ? (line.mrp_paise! - line.unit_price_paise) * qtyUnits : 0;

              return (
                <div key={line.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs">
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="font-semibold text-slate-200 truncate">{line.name}</div>
                    <div className="flex items-center space-x-2 text-[11px] text-slate-400 mt-0.5">
                      <span>{formatPaise(line.unit_price_paise)}</span>
                      {hasDiscount && (
                        <span className="line-through text-slate-500">
                          {formatPaise(line.mrp_paise!)}
                        </span>
                      )}
                      {savingsPaise > 0 && (
                        <span className="text-emerald-400 font-medium">
                          Saved {formatPaise(savingsPaise)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quantity Increment/Decrement */}
                  <div className="flex items-center space-x-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                    <button
                      onClick={() => updateQuantity(line.id, -1000)}
                      type="button"
                      className="text-slate-400 hover:text-slate-200 p-0.5"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-slate-200">
                      {qtyUnits}
                    </span>
                    <button
                      onClick={() => updateQuantity(line.id, 1000)}
                      type="button"
                      className="text-slate-400 hover:text-slate-200 p-0.5"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Line Total & Remove */}
                  <div className="text-right pl-3 min-w-[70px]">
                    <div className="font-bold text-slate-100 font-mono">
                      {formatPaise(computeLineSubtotalPaise(line.unit_price_paise, line.quantity_milli))}
                    </div>
                    <button
                      onClick={() => removeLine(line.id)}
                      type="button"
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Customer Savings Highlight Banner */}
        {totalSavingsPaise > 0 && (
          <div className="mx-3 my-2 px-3 py-1.5 bg-emerald-950/60 border border-emerald-500/40 rounded-xl flex items-center justify-between text-xs text-emerald-300">
            <span className="flex items-center space-x-1.5 font-medium">
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              <span>Customer Savings Today:</span>
            </span>
            <span className="font-bold font-mono text-emerald-200">
              {formatPaise(totalSavingsPaise)}
            </span>
          </div>
        )}

        {/* Totals Breakdown */}
        <div className="bg-slate-950/90 border-t border-slate-800 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal (Taxable):</span>
            <span className="font-mono">{formatPaise(computedDocument.totals.taxable_paise)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>GST (CGST + SGST):</span>
            <span className="font-mono">
              {formatPaise(computedDocument.totals.cgst_paise + computedDocument.totals.sgst_paise)}
            </span>
          </div>
          {computedDocument.totals.round_off_paise !== 0 && (
            <div className="flex justify-between text-slate-400">
              <span>Round Off:</span>
              <span className="font-mono">{formatPaise(computedDocument.totals.round_off_paise)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-sm font-extrabold text-slate-100">
            <span>Total Payable:</span>
            <span className="text-lg font-mono text-emerald-400">
              {formatPaise(totalPayablePaise)}
            </span>
          </div>
        </div>

        {/* QUICK PAYMENT TENDER CALCULATOR (Cash Tendered -> Change Due) */}
        <div className="p-3 bg-slate-850 border-t border-slate-800 space-y-3">
          {/* Payment Mode Selector Tabs */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setPaymentMode('CASH')}
              type="button"
              className={`py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 border transition ${
                paymentMode === 'CASH'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>Cash</span>
            </button>
            <button
              onClick={() => setPaymentMode('UPI')}
              type="button"
              className={`py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 border transition ${
                paymentMode === 'UPI'
                  ? 'bg-cyan-600 text-white border-cyan-500 shadow'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>UPI QR</span>
            </button>
            <button
              onClick={() => setPaymentMode('CARD')}
              type="button"
              className={`py-1.5 text-xs font-semibold rounded-lg flex items-center justify-center space-x-1.5 border transition ${
                paymentMode === 'CARD'
                  ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Card</span>
            </button>
          </div>

          {/* Cash Tender Interface with Calculator */}
          {paymentMode === 'CASH' && (
            <div className="space-y-2 bg-slate-900 p-2.5 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Cash Tendered:</span>
                <button
                  onClick={setExactTender}
                  type="button"
                  className="text-[10px] text-cyan-400 hover:underline font-mono"
                >
                  [Exact: {formatPaise(totalPayablePaise)}]
                </button>
              </div>

              {/* Tender Input */}
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400 text-sm font-bold">₹</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={cashTenderedInput}
                  onChange={(e) => setCashTenderedInput(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-lg font-mono font-bold text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center space-x-1.5 text-xs">
                <button
                  onClick={() => addPresetTender(50)}
                  type="button"
                  className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono text-[11px]"
                >
                  +₹50
                </button>
                <button
                  onClick={() => addPresetTender(100)}
                  type="button"
                  className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono text-[11px]"
                >
                  +₹100
                </button>
                <button
                  onClick={() => addPresetTender(500)}
                  type="button"
                  className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono text-[11px]"
                >
                  +₹500
                </button>
                <button
                  onClick={() => addPresetTender(2000)}
                  type="button"
                  className="flex-1 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono text-[11px]"
                >
                  +₹2000
                </button>
              </div>

              {/* CHANGE DUE DISPLAY */}
              <div
                className={`p-2.5 rounded-lg flex items-center justify-between border ${
                  changeDuePaise > 0
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : cashTenderedPaise > 0 && remainingDuePaise > 0
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                <span className="text-xs font-semibold">
                  {changeDuePaise > 0
                    ? 'Change to Return:'
                    : remainingDuePaise > 0 && cashTenderedPaise > 0
                    ? 'Short Amount:'
                    : 'Change Due:'}
                </span>
                <span className="text-base font-mono font-extrabold">
                  {changeDuePaise > 0
                    ? formatPaise(changeDuePaise)
                    : remainingDuePaise > 0 && cashTenderedPaise > 0
                    ? formatPaise(remainingDuePaise)
                    : '₹0.00'}
                </span>
              </div>
            </div>
          )}

          {/* UPI QR Display */}
          {paymentMode === 'UPI' && (
            <div className="flex flex-col items-center justify-center p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
              {upiQrUrl ? (
                <img
                  src={upiQrUrl}
                  alt="UPI QR Code"
                  className="w-36 h-36 bg-white p-2 rounded-xl shadow-md"
                />
              ) : (
                <div className="w-36 h-36 bg-slate-950 flex items-center justify-center text-slate-600 rounded-xl">
                  Add items to generate QR
                </div>
              )}
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-200">Scan via GPay / PhonePe / Paytm</p>
                <p className="text-[11px] text-slate-400 font-mono">Amount: {formatPaise(totalPayablePaise)}</p>
              </div>
            </div>
          )}

          {/* Card Swipe Prompt */}
          {paymentMode === 'CARD' && (
            <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 text-center space-y-2">
              <CreditCard className="w-8 h-8 text-indigo-400 mx-auto" />
              <p className="text-xs font-semibold text-slate-200">Swipe or Tap Card on EDC Machine</p>
              <p className="text-[11px] text-slate-400 font-mono">Authorize: {formatPaise(totalPayablePaise)}</p>
            </div>
          )}

          {/* Complete & Post Transaction Button */}
          <button
            onClick={handlePostTransaction}
            disabled={cart.length === 0}
            type="button"
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-950/60 flex items-center justify-center space-x-2 transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Complete & Print 80mm Slip</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 80MM THERMAL SLIP PRINT MODAL */}
      {showSlipModal && lastReceipt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-black w-full max-w-[360px] rounded-xl shadow-2xl p-5 overflow-y-auto max-h-[90vh] font-mono text-xs">
            {/* Action Bar */}
            <div className="flex justify-between items-center pb-3 mb-3 border-b border-dashed border-gray-300 non-printable">
              <span className="font-sans font-bold text-gray-700">80mm Thermal Receipt</span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  type="button"
                  className="px-2.5 py-1 bg-black text-white rounded text-xs flex items-center space-x-1"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  onClick={() => setShowSlipModal(false)}
                  type="button"
                  className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Thermal Receipt Content Container (80mm width standard) */}
            <div id="thermal-slip-print" className="space-y-3">
              {/* Header */}
              <div className="text-center space-y-1">
                <h2 className="text-sm font-extrabold uppercase tracking-wide">OMNIBILL SUPERMARKET</h2>
                <p className="text-[11px] text-gray-600">Branch: Andheri East, Mumbai</p>
                <p className="text-[10px] text-gray-600">GSTIN: 27AABCU9603R1ZM</p>
                <p className="text-[10px] text-gray-600">Phone: +91 98200 12345</p>
              </div>

              <div className="border-t border-b border-dashed border-gray-400 py-1.5 space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span>Bill No: {lastReceipt.invoice_number}</span>
                  <span>{lastReceipt.invoice_time}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date: {lastReceipt.invoice_date}</span>
                  <span>Cashier: POS-01</span>
                </div>
                <div className="flex justify-between">
                  <span>Customer: {lastReceipt.entity_name}</span>
                  <span>{lastReceipt.entity_details?.phone || 'Walk-in'}</span>
                </div>
              </div>

              {/* Items List */}
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="py-1">Item</th>
                    <th className="text-center">Qty</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-gray-200">
                  {lastReceipt.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1">
                        <div className="font-semibold truncate max-w-[140px]">{l.name}</div>
                        <div className="text-[9px] text-gray-500">{l.barcode || l.hsn_sac}</div>
                      </td>
                      <td className="text-center">{l.quantity_milli / 1000}</td>
                      <td className="text-right">{formatPaise(l.unit_price_paise, false)}</td>
                      <td className="text-right font-bold">
                        {formatPaise(computeLineSubtotalPaise(l.unit_price_paise, l.quantity_milli), false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Calculation Summary */}
              <div className="border-t border-dashed border-gray-400 pt-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatPaise(lastReceipt.totals.taxable_paise)}</span>
                </div>
                <div className="flex justify-between">
                  <span>CGST + SGST:</span>
                  <span>{formatPaise(lastReceipt.totals.cgst_paise + lastReceipt.totals.sgst_paise)}</span>
                </div>
                {lastReceipt.totals.round_off_paise !== 0 && (
                  <div className="flex justify-between">
                    <span>Round Off:</span>
                    <span>{formatPaise(lastReceipt.totals.round_off_paise)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-extrabold border-t border-gray-300 pt-1">
                  <span>NET PAYABLE:</span>
                  <span>{formatPaise(lastReceipt.totals.total_amount_paise)}</span>
                </div>

                {/* Tender & Change Breakdown */}
                <div className="border-t border-dotted border-gray-300 pt-1 mt-1 text-[10px] space-y-0.5">
                  <div className="flex justify-between">
                    <span>Payment Mode:</span>
                    <span className="font-bold">{lastReceipt.payment.mode}</span>
                  </div>
                  {lastReceipt.payment.cash_tendered_paise && (
                    <div className="flex justify-between">
                      <span>Cash Tendered:</span>
                      <span>{formatPaise(lastReceipt.payment.cash_tendered_paise)}</span>
                    </div>
                  )}
                  {lastReceipt.payment.change_due_paise > 0 && (
                    <div className="flex justify-between font-bold">
                      <span>Change Due:</span>
                      <span>{formatPaise(lastReceipt.payment.change_due_paise)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Greeting */}
              <div className="border-t border-dashed border-gray-400 pt-2 text-center text-[10px] space-y-1 text-gray-700">
                <p className="font-bold">*** THANK YOU FOR SHOPPING! ***</p>
                <p>Goods once sold can be exchanged within 7 days with bill.</p>
                <p className="text-[9px] text-gray-500">OmniBill ERP v2 • www.omnibill.io</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
