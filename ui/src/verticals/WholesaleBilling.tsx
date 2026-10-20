// ui/src/verticals/WholesaleBilling.tsx
// Wholesale & Distribution Mode: Multi-Line B2B GST Invoice, Credit Limit Warning, Lot Picker, e-Way Bill, A4 GST Tax Invoice

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
} from './types';
import { VerticalIPCBridge } from './ipc';
import { computeSaleTotals, formatPaise, parseRupeesToPaise, computeLineSubtotalPaise } from '../lib/tax';
import { posSound } from '../lib/sound';
import { PredictiveSearchDropdown } from '../components/pos/PredictiveSearchDropdown';

export const WholesaleBilling: React.FC = () => {
  // State
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [catalog, setCatalog] = useState<ResourceItem[]>([]);
  const [cart, setCart] = useState<VerticalCartLine[]>([]);

  // Search & Modals
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [showA4InvoiceModal, setShowA4InvoiceModal] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<PostedTransactionReceipt | null>(null);
  const [invoiceCopyType, setInvoiceCopyType] = useState<'ORIGINAL' | 'DUPLICATE' | 'TRIPLICATE'>('ORIGINAL');

  // e-Way Bill Fields
  const [ewayDetails, setEwayDetails] = useState<EWayBillDetails>({
    distance_km: 120,
    transporter_id: '27AAACL1966H1ZU',
    transporter_name: 'VRL Logistics Limited',
    transporter_doc_no: 'LR-2026-98124',
    vehicle_number: 'MH-12-QW-4412',
    eway_bill_no: '281900412891',
    supply_type: 'Outward - Supply',
  });

  // Payment Selection
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('BANK_TRANSFER');
  const [bankReference, setBankReference] = useState('');

  // New Customer Form State
  const [newCustName, setNewCustName] = useState('');
  const [newCustTradeName, setNewCustTradeName] = useState('');
  const [newCustGstin, setNewCustGstin] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustCreditLimit, setNewCustCreditLimit] = useState('200000');
  const [newCustStateCode, setNewCustStateCode] = useState('27');
  const [newCustCity, setNewCustCity] = useState('');

  // Load Customers & Catalog
  useEffect(() => {
    VerticalIPCBridge.getEntities('CUSTOMER').then((list) => {
      setCustomers(list as WholesaleCustomer[]);
      if (list.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(list[0].id);
      }
    });

    VerticalIPCBridge.getResources('WHOLESALE').then((res) => {
      setCatalog(res);
      // Auto-populate 2 initial items for quick demo if empty
      if (cart.length === 0 && res.length >= 2) {
        addResourceToInvoice(res[0], 10);
        addResourceToInvoice(res[1], 5);
      }
    });
  }, []);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || customers[0] || null;
  }, [customers, selectedCustomerId]);

  // Compute Taxes and Totals
  const isInterState = selectedCustomer ? selectedCustomer.state_code !== '27' : false;

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

  const totalInvoiceAmountPaise = computedDocument.totals.total_amount_paise;

  // Credit Limit Calculations
  const creditLimitPaise = selectedCustomer?.credit_limit_paise || 0;
  const currentBalancePaise = selectedCustomer?.current_balance_paise || 0;
  const availableCreditPaise = Math.max(0, creditLimitPaise - currentBalancePaise);
  const isCreditExceeded =
    paymentMode === 'BANK_TRANSFER' &&
    currentBalancePaise + totalInvoiceAmountPaise > creditLimitPaise;
  const excessCreditAmountPaise = isCreditExceeded
    ? currentBalancePaise + totalInvoiceAmountPaise - creditLimitPaise
    : 0;

  const creditUsagePercent = creditLimitPaise > 0
    ? Math.min(100, Math.round(((currentBalancePaise + totalInvoiceAmountPaise) / creditLimitPaise) * 100))
    : 0;

  // e-Way Bill requirement: Mandatory if total > ₹50,000 (5,000,000 paise)
  const isEwayBillRequired = totalInvoiceAmountPaise >= 5000000;

  // Add Resource to Cart with first available Lot
  const addResourceToInvoice = (resource: ResourceItem, initialUnits = 1) => {
    posSound.playItemAdd();
    const defaultLot = resource.lots && resource.lots.length > 0 ? resource.lots[0] : undefined;

    const newLine: VerticalCartLine = {
      id: `line_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      resource_id: resource.id,
      sku: resource.sku,
      name: resource.name,
      hsn_sac: resource.hsn_sac,
      unit: resource.unit,
      tax_rate_bps: resource.tax_rate_bps,
      quantity_milli: initialUnits * 1000,
      unit_price_paise: resource.base_price_paise,
      mrp_paise: defaultLot?.mrp_paise || resource.mrp_paise,
      discount_paise: 0,
      lot_id: defaultLot?.id,
      batch_number: defaultLot?.batch_number,
      expiry_date: defaultLot?.expiry_date,
      gross_paise: resource.base_price_paise * initialUnits,
      taxable_paise: resource.base_price_paise * initialUnits,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      line_total_paise: resource.base_price_paise * initialUnits,
    };

    setCart((prev) => [...prev, newLine]);
  };

  // Change Lot Selection for a line
  const updateLineLot = (lineId: string, lotId: string) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const res = catalog.find((r) => r.id === line.resource_id);
        const lot = res?.lots?.find((l) => l.id === lotId);
        if (!lot) return line;
        return {
          ...line,
          lot_id: lot.id,
          batch_number: lot.batch_number,
          expiry_date: lot.expiry_date,
          mrp_paise: lot.mrp_paise,
        };
      })
    );
  };

  const updateLineField = (
    lineId: string,
    field: 'quantity_milli' | 'unit_price_paise' | 'discount_paise',
    value: number
  ) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        return { ...line, [field]: value };
      })
    );
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  };

  // Quick Customer Registration
  const handleRegisterCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const newCust: WholesaleCustomer = {
      id: `ent_b2b_${Date.now()}`,
      entity_code: `CUST-B2B-${Math.floor(100 + Math.random() * 900)}`,
      entity_type: 'CUSTOMER',
      full_name: newCustName.trim(),
      trade_name: newCustTradeName.trim() || newCustName.trim(),
      gstin: newCustGstin.trim().toUpperCase() || undefined,
      phone: newCustPhone.trim(),
      state_code: newCustStateCode,
      is_active: true,
      credit_limit_paise: parseRupeesToPaise(newCustCreditLimit || '0'),
      current_balance_paise: 0,
      city: newCustCity.trim() || 'Mumbai',
    };

    await VerticalIPCBridge.createEntity(newCust);
    setCustomers((prev) => [newCust, ...prev]);
    setSelectedCustomerId(newCust.id);
    setShowNewCustomerModal(false);

    // Reset Form
    setNewCustName('');
    setNewCustTradeName('');
    setNewCustGstin('');
    setNewCustPhone('');
  };

  // Post B2B Transaction to SQLite & Launch A4 Layout
  const handlePostB2BInvoice = async () => {
    if (cart.length === 0 || !selectedCustomer) return;

    const payment: PaymentDetails = {
      mode: paymentMode,
      amount_tendered_paise: totalInvoiceAmountPaise,
      change_due_paise: 0,
      reference_number: bankReference || ewayDetails.transporter_doc_no,
    };

    const receipt = await VerticalIPCBridge.postTransaction({
      verticalMode: 'WHOLESALE',
      entityType: 'CUSTOMER',
      entityId: selectedCustomer.id,
      entityName: selectedCustomer.trade_name || selectedCustomer.full_name,
      entityDetails: selectedCustomer,
      lines: cart,
      totals: computedDocument.totals,
      payment,
      ewayBill: isEwayBillRequired ? ewayDetails : undefined,
      notes: `B2B GST Tax Invoice • Credit Mode: ${paymentMode}`,
    });

    setLastReceipt(receipt);
    setShowA4InvoiceModal(true);

    // Refresh customer entities from IPC bridge (NO direct selectedCustomer mutation)
    const updatedCustomers = await VerticalIPCBridge.getEntities('CUSTOMER');
    setCustomers(updatedCustomers as WholesaleCustomer[]);
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-100 p-4 space-y-4 overflow-y-auto">
      {/* TOP ROW: B2B Customer Selector + Customer Credit Limit Indicator */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Customer Selector Card */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Building2 className="w-5 h-5 text-blue-400" />
              <h2 className="text-sm font-bold text-slate-100">B2B Buyer (Consignee) Details</h2>
            </div>
            <button
              onClick={() => setShowNewCustomerModal(true)}
              type="button"
              className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold flex items-center space-x-1 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New B2B Customer</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Select Registered Customer:</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-medium"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.trade_name || c.full_name} ({c.gstin || 'Unregistered'})
                  </option>
                ))}
              </select>
            </div>

            {selectedCustomer && (
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">GSTIN:</span>
                  <span className="font-mono font-semibold text-blue-300">
                    {selectedCustomer.gstin || 'N/A (Unregistered)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Place of Supply:</span>
                  <span className="font-semibold text-slate-300">
                    State {selectedCustomer.state_code} ({isInterState ? 'Inter-State IGST' : 'Intra-State CGST+SGST'})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Contact:</span>
                  <span className="text-slate-300">{selectedCustomer.phone || 'N/A'}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CUSTOMER CREDIT LIMIT WARNING INDICATOR */}
        <div
          className={`border rounded-2xl p-4 shadow-md flex flex-col justify-between transition-all ${
            isCreditExceeded
              ? 'bg-rose-950/30 border-rose-500/60 text-rose-200'
              : creditUsagePercent > 80
              ? 'bg-amber-950/30 border-amber-500/50 text-amber-200'
              : 'bg-slate-900 border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5">
              {isCreditExceeded ? (
                <>
                  <ShieldAlert className="w-4 h-4 text-rose-400 animate-bounce" />
                  <span className="text-rose-400">Credit Limit Exceeded!</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  <span>Buyer Credit Facility</span>
                </>
              )}
            </span>
            <span className="text-xs font-mono font-bold">{creditUsagePercent}% Used</span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800 mb-3">
            <div
              className={`h-full transition-all duration-300 ${
                isCreditExceeded
                  ? 'bg-rose-500 animate-pulse'
                  : creditUsagePercent > 80
                  ? 'bg-amber-500'
                  : 'bg-blue-500'
              }`}
              style={{ width: `${creditUsagePercent}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-1 text-[11px] text-center border-t border-slate-800/80 pt-2">
            <div>
              <div className="text-slate-400">Total Limit</div>
              <div className="font-mono font-bold">{formatPaise(creditLimitPaise)}</div>
            </div>
            <div>
              <div className="text-slate-400">Current Dues</div>
              <div className="font-mono font-bold">{formatPaise(currentBalancePaise)}</div>
            </div>
            <div>
              <div className="text-slate-400">Available</div>
              <div
                className={`font-mono font-bold ${
                  availableCreditPaise < totalInvoiceAmountPaise ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {formatPaise(availableCreditPaise)}
              </div>
            </div>
          </div>

          {isCreditExceeded && (
            <div className="mt-2 text-[10px] text-rose-300 bg-rose-950/80 p-1.5 rounded-lg border border-rose-500/40 text-center font-semibold">
              ⚠️ Invoice of {formatPaise(totalInvoiceAmountPaise)} exceeds available credit by {formatPaise(excessCreditAmountPaise)}.
            </div>
          )}
        </div>
      </div>

      {/* MIDDLE SECTION: Multi-Line B2B Invoice Grid with Batch & Expiry Date Lot Picker */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-slate-100">Invoice Line Items & Lot Picker</h3>
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full text-xs font-mono">
              {cart.length} lines
            </span>
          </div>

          {/* Quick Add with Predictive Autocomplete & Select Fallback */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="Type item name, SKU to add..."
                value={itemSearchQuery}
                onChange={(e) => setItemSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              <PredictiveSearchDropdown
                query={itemSearchQuery}
                products={catalog}
                isOpen={itemSearchQuery.trim().length >= 1}
                onSelect={(res, qtyMilli) => {
                  addResourceToInvoice(res, Math.max(1, Math.round(qtyMilli / 1000)));
                  setItemSearchQuery('');
                }}
                onClose={() => setItemSearchQuery('')}
                anchorPosition="bottom"
              />
            </div>

            <select
              onChange={(e) => {
                const res = catalog.find((r) => r.id === e.target.value);
                if (res) addResourceToInvoice(res, 1);
                e.target.value = '';
              }}
              defaultValue=""
              className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="" disabled>
                + Catalog List...
              </option>
              {catalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({formatPaise(item.base_price_paise)} / {item.unit})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Invoice Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Item Description</th>
                <th className="py-2.5 px-3">HSN</th>
                <th className="py-2.5 px-3">Batch & Expiry Lot</th>
                <th className="py-2.5 px-3 text-center">Qty (Units)</th>
                <th className="py-2.5 px-3 text-right">Rate / Unit</th>
                <th className="py-2.5 px-3 text-right">Taxable</th>
                <th className="py-2.5 px-3 text-center">GST %</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {cart.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-slate-500">
                    No items on invoice. Select items from above to populate lines.
                  </td>
                </tr>
              ) : (
                cart.map((line, idx) => {
                  const qtyUnits = line.quantity_milli / 1000;
                  const res = catalog.find((r) => r.id === line.resource_id);
                  const availableLots = res?.lots || [];

                  return (
                    <tr key={line.id} className="hover:bg-slate-850/50 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-200">{line.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{line.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{line.hsn_sac}</td>

                      {/* BATCH & EXPIRY LOT PICKER */}
                      <td className="py-2.5 px-3 min-w-[200px]">
                        {availableLots.length > 0 ? (
                          <select
                            value={line.lot_id || ''}
                            onChange={(e) => updateLineLot(line.id, e.target.value)}
                            className="w-full px-2 py-1 bg-slate-950 border border-slate-700/80 rounded-lg text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                          >
                            {availableLots.map((lot) => (
                              <option key={lot.id} value={lot.id}>
                                {lot.batch_number} (Exp: {lot.expiry_date}) • Stk: {lot.stock_milli / 1000}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">Standard Stock</span>
                        )}
                        {line.expiry_date && (
                          <div className="text-[10px] text-slate-400 flex items-center space-x-1 mt-0.5">
                            <Calendar className="w-2.5 h-2.5 text-slate-500" />
                            <span>Expiry: {line.expiry_date}</span>
                          </div>
                        )}
                      </td>

                      {/* Quantity */}
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="number"
                          min="1"
                          value={qtyUnits}
                          onChange={(e) =>
                            updateLineField(line.id, 'quantity_milli', Math.max(1, parseInt(e.target.value) || 1) * 1000)
                          }
                          className="w-16 px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-center font-mono font-bold text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </td>

                      {/* Unit Price */}
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          value={(line.unit_price_paise / 100).toFixed(2)}
                          onChange={(e) =>
                            updateLineField(
                              line.id,
                              'unit_price_paise',
                              Math.round(parseFloat(e.target.value || '0') * 100)
                            )
                          }
                          className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-right font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                        />
                      </td>

                      {/* Taxable */}
                      <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                        {formatPaise(computeLineSubtotalPaise(line.unit_price_paise, line.quantity_milli))}
                      </td>

                      {/* GST Tax Rate */}
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 bg-slate-800 rounded font-mono text-[11px] text-blue-300">
                          {line.tax_rate_bps / 100}%
                        </span>
                      </td>

                      {/* Line Total */}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-100">
                        {formatPaise(line.line_total_paise || (line.unit_price_paise * qtyUnits))}
                      </td>

                      {/* Remove */}
                      <td className="py-2.5 px-2 text-center">
                        <button
                          onClick={() => removeLine(line.id)}
                          type="button"
                          className="p-1 text-slate-500 hover:text-rose-400 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* BOTTOM ROW: e-Way Bill Details + Invoice Summary & Post */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* e-Way Bill Fields Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Truck className="w-4 h-4 text-cyan-400" />
              <h4 className="text-xs font-bold text-slate-100">e-Way Bill & Transportation Logistics</h4>
            </div>
            {isEwayBillRequired ? (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[10px] font-bold">
                MANDATORY (&gt; ₹50k)
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">Optional (&lt; ₹50k)</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">Transporter Name / ID:</label>
              <input
                type="text"
                value={ewayDetails.transporter_name}
                onChange={(e) => setEwayDetails({ ...ewayDetails, transporter_name: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">Vehicle Number:</label>
              <input
                type="text"
                value={ewayDetails.vehicle_number}
                onChange={(e) => setEwayDetails({ ...ewayDetails, vehicle_number: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono uppercase"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">LR / Consignment No:</label>
              <input
                type="text"
                value={ewayDetails.transporter_doc_no}
                onChange={(e) => setEwayDetails({ ...ewayDetails, transporter_doc_no: e.target.value })}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-0.5">Approx Distance (KM):</label>
              <input
                type="number"
                value={ewayDetails.distance_km}
                onChange={(e) =>
                  setEwayDetails({ ...ewayDetails, distance_km: parseInt(e.target.value) || 0 })
                }
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Invoice Grand Totals & Action */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-md flex flex-col justify-between space-y-3">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal (Taxable Value):</span>
              <span className="font-mono">{formatPaise(computedDocument.totals.taxable_paise)}</span>
            </div>
            {isInterState ? (
              <div className="flex justify-between text-slate-400">
                <span>Integrated GST (IGST):</span>
                <span className="font-mono text-blue-300">
                  {formatPaise(computedDocument.totals.igst_paise)}
                </span>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-slate-400">
                  <span>Central GST (CGST):</span>
                  <span className="font-mono">{formatPaise(computedDocument.totals.cgst_paise)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>State GST (SGST):</span>
                  <span className="font-mono">{formatPaise(computedDocument.totals.sgst_paise)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-slate-400">
              <span>Round Off:</span>
              <span className="font-mono">{formatPaise(computedDocument.totals.round_off_paise)}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-sm font-extrabold text-slate-100">
              <span>Total Tax Invoice Value:</span>
              <span className="text-xl font-mono text-blue-400">
                {formatPaise(totalInvoiceAmountPaise)}
              </span>
            </div>
          </div>

          {/* Payment Terms & Post Button */}
          <div className="flex items-center space-x-3 pt-2">
            <div className="w-1/2">
              <label className="text-[10px] text-slate-400 block mb-1">Billing Settlement Mode:</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200"
              >
                <option value="BANK_TRANSFER">30-Day Credit (Ledger Ledger)</option>
                <option value="CHEQUE">PDC / Cheque</option>
                <option value="UPI">Immediate RTGS / NEFT / UPI</option>
                <option value="CASH">Cash Settlement</option>
              </select>
            </div>

            <button
              onClick={handlePostB2BInvoice}
              disabled={cart.length === 0 || !selectedCustomer}
              type="button"
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-950/60 flex items-center justify-center space-x-2 transition"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Post & View A4 GST Invoice</span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL 1: REGISTER NEW B2B CUSTOMER */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Register New B2B Enterprise</span>
              </h3>
              <button
                onClick={() => setShowNewCustomerModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterCustomer} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Company Legal Name *</label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Royal Traders Pvt Ltd"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Trade / Brand Name</label>
                <input
                  type="text"
                  placeholder="e.g. Royal Mart"
                  value={newCustTradeName}
                  onChange={(e) => setNewCustTradeName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">GSTIN (15 Digits)</label>
                  <input
                    type="text"
                    maxLength={15}
                    placeholder="27AA..."
                    value={newCustGstin}
                    onChange={(e) => {
                      setNewCustGstin(e.target.value);
                      if (e.target.value.length >= 2) {
                        setNewCustStateCode(e.target.value.substring(0, 2));
                      }
                    }}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">State Code</label>
                  <input
                    type="text"
                    value={newCustStateCode}
                    onChange={(e) => setNewCustStateCode(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Authorized Phone</label>
                  <input
                    type="text"
                    placeholder="+91..."
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Credit Limit (₹)</label>
                  <input
                    type="number"
                    value={newCustCreditLimit}
                    onChange={(e) => setNewCustCreditLimit(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewCustomerModal(false)}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-lg font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow"
                >
                  Save & Select
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: A4 GST TAX INVOICE PRINT VIEW */}
      {showA4InvoiceModal && lastReceipt && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl p-6 overflow-y-auto max-h-[95vh] font-sans text-xs">
            {/* Header controls (Non-printable) */}
            <div className="flex flex-wrap justify-between items-center pb-4 mb-4 border-b border-gray-300 non-printable">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-gray-700">A4 GST Tax Invoice Layout</span>
                {/* Copy Type Selector */}
                <div className="flex items-center space-x-1 bg-gray-100 p-1 rounded-lg border border-gray-300">
                  {(['ORIGINAL', 'DUPLICATE', 'TRIPLICATE'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setInvoiceCopyType(type)}
                      className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        invoiceCopyType === type ? 'bg-black text-white shadow-sm' : 'text-gray-600'
                      }`}
                    >
                      {type === 'ORIGINAL'
                        ? 'Original (Buyer)'
                        : type === 'DUPLICATE'
                        ? 'Duplicate (Transporter)'
                        : 'Triplicate (Supplier)'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => window.print()}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center space-x-1.5 shadow"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print A4 Invoice</span>
                </button>
                <button
                  onClick={() => setShowA4InvoiceModal(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg font-bold"
                >
                  Close
                </button>
              </div>
            </div>

            {/* A4 PRINT CONTAINER (Compliant with Rule 46 of CGST Rules 2017) */}
            <div id="a4-gst-invoice" className="border border-gray-400 p-5 space-y-4">
              {/* Top Banner */}
              <div className="flex justify-between items-start border-b border-gray-300 pb-3">
                <div>
                  <h1 className="text-xl font-extrabold text-blue-900 tracking-tight">OMNIBILL ENTERPRISES LTD</h1>
                  <p className="text-[11px] text-gray-600">Central Distribution Hub, Plot 88, Andheri MIDC, Mumbai - 400093</p>
                  <p className="text-[11px] font-mono">
                    <strong>GSTIN:</strong> 27AABCU9603R1ZM | <strong>State:</strong> Maharashtra (27)
                  </p>
                  <p className="text-[11px]">Email: dispatch@omnibill.io | Phone: +91 98200 12345</p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    {invoiceCopyType === 'ORIGINAL'
                      ? 'ORIGINAL FOR RECIPIENT'
                      : invoiceCopyType === 'DUPLICATE'
                      ? 'DUPLICATE FOR TRANSPORTER'
                      : 'TRIPLICATE FOR SUPPLIER'}
                  </div>
                  <h2 className="text-base font-black text-gray-800">TAX INVOICE</h2>
                  <p className="text-xs font-mono font-bold text-blue-800">
                    Invoice No: {lastReceipt.invoice_number}
                  </p>
                  <p className="text-[11px] text-gray-600">Date: {lastReceipt.invoice_date}</p>
                </div>
              </div>

              {/* B2B Consignee & Transport Meta */}
              <div className="grid grid-cols-2 gap-4 border border-gray-300 p-3 bg-gray-50 rounded">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                    Details of Receiver / Billed To:
                  </h4>
                  <div className="font-bold text-sm text-gray-900">{lastReceipt.entity_name}</div>
                  <p className="text-[11px] text-gray-700">{lastReceipt.entity_details?.address_line1 || 'Commercial Complex'}</p>
                  <p className="text-[11px] text-gray-700">{lastReceipt.entity_details?.city || 'Mumbai'}</p>
                  <p className="text-[11px] font-mono">
                    <strong>GSTIN / UIN:</strong> {lastReceipt.entity_details?.gstin || 'Unregistered'}
                  </p>
                  <p className="text-[11px]">
                    <strong>State & Code:</strong> State ({lastReceipt.entity_details?.state_code || '27'})
                  </p>
                </div>

                <div className="border-l border-gray-300 pl-4 space-y-1 text-[11px]">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                    Dispatch & e-Way Bill Summary:
                  </h4>
                  <div><strong>e-Way Bill No:</strong> {lastReceipt.eway_bill?.eway_bill_no || 'N/A'}</div>
                  <div><strong>Vehicle Number:</strong> {lastReceipt.eway_bill?.vehicle_number || 'N/A'}</div>
                  <div><strong>Transporter:</strong> {lastReceipt.eway_bill?.transporter_name || 'Direct'}</div>
                  <div><strong>LR / Doc No:</strong> {lastReceipt.eway_bill?.transporter_doc_no || 'N/A'}</div>
                  <div><strong>Payment Terms:</strong> {lastReceipt.payment.mode}</div>
                </div>
              </div>

              {/* Table of Goods with Lot & Expiry */}
              <table className="w-full text-left border border-gray-300 text-[11px]">
                <thead className="bg-gray-100 border-b border-gray-300">
                  <tr>
                    <th className="p-1.5 border-r border-gray-300">S.N</th>
                    <th className="p-1.5 border-r border-gray-300">Description of Goods</th>
                    <th className="p-1.5 border-r border-gray-300">HSN</th>
                    <th className="p-1.5 border-r border-gray-300">Batch / Lot</th>
                    <th className="p-1.5 border-r border-gray-300 text-center">Qty</th>
                    <th className="p-1.5 border-r border-gray-300 text-right">Rate</th>
                    <th className="p-1.5 border-r border-gray-300 text-right">Taxable</th>
                    <th className="p-1.5 text-right">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lastReceipt.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="p-1.5 border-r border-gray-300 font-mono text-center">{i + 1}</td>
                      <td className="p-1.5 border-r border-gray-300 font-semibold">{l.name}</td>
                      <td className="p-1.5 border-r border-gray-300 font-mono">{l.hsn_sac}</td>
                      <td className="p-1.5 border-r border-gray-300 font-mono text-[10px]">
                        {l.batch_number ? `${l.batch_number} (Exp: ${l.expiry_date})` : 'General'}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 text-center font-mono">
                        {l.quantity_milli / 1000} {l.unit}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 text-right font-mono">
                        {formatPaise(l.unit_price_paise, false)}
                      </td>
                      <td className="p-1.5 border-r border-gray-300 text-right font-mono">
                        {formatPaise(computeLineSubtotalPaise(l.unit_price_paise, l.quantity_milli), false)}
                      </td>
                      <td className="p-1.5 text-right font-bold font-mono">
                        {formatPaise(computeLineSubtotalPaise(l.unit_price_paise, l.quantity_milli), false)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* GST Tax Breakdown Box */}
              <div className="border border-gray-300 p-2.5 bg-gray-50 grid grid-cols-2 gap-4 text-[11px]">
                <div className="space-y-1">
                  <h5 className="font-bold uppercase text-gray-700">Bank Settlement Details (RTGS/NEFT):</h5>
                  <p>Bank: HDFC Bank Ltd | Branch: Andheri East</p>
                  <p className="font-mono">A/C No: 50200019284711 | IFSC: HDFC0000123</p>
                  <p className="text-[10px] text-gray-500 mt-2">
                    Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
                  </p>
                </div>

                <div className="space-y-1 font-mono text-right">
                  <div className="flex justify-between">
                    <span className="font-sans">Total Taxable Value:</span>
                    <span>{formatPaise(lastReceipt.totals.taxable_paise)}</span>
                  </div>
                  {lastReceipt.totals.igst_paise > 0 ? (
                    <div className="flex justify-between">
                      <span className="font-sans">IGST:</span>
                      <span>{formatPaise(lastReceipt.totals.igst_paise)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="font-sans">CGST:</span>
                        <span>{formatPaise(lastReceipt.totals.cgst_paise)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-sans">SGST:</span>
                        <span>{formatPaise(lastReceipt.totals.sgst_paise)}</span>
                      </div>
                    </>
                  )}
                  {lastReceipt.totals.round_off_paise !== 0 && (
                    <div className="flex justify-between">
                      <span className="font-sans">Round Off:</span>
                      <span>{formatPaise(lastReceipt.totals.round_off_paise)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black border-t border-gray-400 pt-1 text-blue-900">
                    <span className="font-sans">GRAND TOTAL:</span>
                    <span>{formatPaise(lastReceipt.totals.total_amount_paise)}</span>
                  </div>
                </div>
              </div>

              {/* Authorized Signatory */}
              <div className="flex justify-between items-end pt-4 border-t border-gray-300">
                <div className="text-[10px] text-gray-500">
                  Subject to Mumbai Jurisdiction. This is a computer-generated invoice.
                </div>
                <div className="text-center space-y-8">
                  <div className="text-[11px] font-bold">For OMNIBILL ENTERPRISES LTD</div>
                  <div className="text-[10px] text-gray-600 border-t border-gray-400 pt-1 px-4">
                    Authorized Signatory
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
