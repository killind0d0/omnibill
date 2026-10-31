// ui/src/pages/GoodsReceipt.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  PackagePlus,
  Truck,
  Plus,
  Trash2,
  Calendar,
  FileText,
  Building2,
  CheckCircle2,
  AlertCircle,
  Barcode,
  History,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { apiPostPurchase, posStorage } from '../lib/api';
import { ErpStorageService } from '../lib/erpStorage';
import { Entity, ResourceItem } from '../types/accounting';
import { formatPaise } from '../lib/tax';
import { paiseToWords } from '../lib/numbersToWords';
import { posSound } from '../lib/sound';

interface GrnLineItem {
  id: string;
  resource_id: string;
  item_name: string;
  batch_number: string;
  expiry_date: string;
  quantity_units: string;
  cost_price_inr: string;
  mrp_inr: string;
  tax_rate_bps: number;
}

export const GoodsReceipt: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Entity[]>([]);
  const [products, setProducts] = useState<ResourceItem[]>([]);
  const [activeTab, setActiveTab] = useState<'NEW_GRN' | 'HISTORY'>('NEW_GRN');

  // Form Header State
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [customSupplierName, setCustomSupplierName] = useState<string>('');
  const [challanNumber, setChallanNumber] = useState<string>(
    () => `GRN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  );
  const [receiptDate, setReceiptDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );

  // Line Items State
  const [lines, setLines] = useState<GrnLineItem[]>([
    {
      id: 'line_' + Date.now(),
      resource_id: '',
      item_name: '',
      batch_number: `BATCH-${new Date().getMonth() + 1}${new Date().getDate()}`,
      expiry_date: '2027-12-31',
      quantity_units: '10',
      cost_price_inr: '',
      mrp_inr: '',
      tax_rate_bps: 500,
    },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Load suppliers and catalog
  useEffect(() => {
    const loadCatalog = () => {
      try {
        const allEntities = ErpStorageService.getEntities();
        setSuppliers(allEntities.filter((e) => e.entity_type === 'SUPPLIER'));

        const allItems = ErpStorageService.getItems();
        setProducts(allItems);
      } catch (err) {
        console.error('Failed to load suppliers/products:', err);
      }
    };
    loadCatalog();
    window.addEventListener('omnibill_catalog_sync', loadCatalog);

    // CF-13: Restore staged GRN intake draft across crashes/reloads
    try {
      const draft = localStorage.getItem('omnibill_grn_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.lines && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          setLines(parsed.lines);
        }
        if (parsed.selectedSupplierId) setSelectedSupplierId(parsed.selectedSupplierId);
        if (parsed.customSupplierName) setCustomSupplierName(parsed.customSupplierName);
        if (parsed.challanNumber) setChallanNumber(parsed.challanNumber);
        if (parsed.receiptDate) setReceiptDate(parsed.receiptDate);
      }
    } catch {}

    return () => window.removeEventListener('omnibill_catalog_sync', loadCatalog);
  }, []);

  // CF-13: Auto-save draft on any change
  useEffect(() => {
    try {
      localStorage.setItem(
        'omnibill_grn_draft',
        JSON.stringify({ lines, selectedSupplierId, customSupplierName, challanNumber, receiptDate })
      );
    } catch {}
  }, [lines, selectedSupplierId, customSupplierName, challanNumber, receiptDate]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: 'line_' + Date.now() + Math.random(),
        resource_id: '',
        item_name: '',
        batch_number: '',
        expiry_date: '2027-12-31',
        quantity_units: '1',
        cost_price_inr: '',
        mrp_inr: '',
        tax_rate_bps: 500,
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleLineChange = (id: string, field: keyof GrnLineItem, value: any) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;

        if (field === 'resource_id') {
          const selected = products.find((p) => p.id === value);
          return {
            ...line,
            resource_id: value,
            item_name: selected?.name || '',
            cost_price_inr: selected ? (selected.cost_price_paise / 100).toFixed(2) : '',
            mrp_inr: selected ? (selected.base_price_paise / 100).toFixed(2) : '',
            tax_rate_bps: selected?.tax_rate_bps ?? 500,
          };
        }

        return { ...line, [field]: value };
      })
    );
  };

  // Compute Live Totals
  const summary = useMemo(() => {
    let totalQtyMilli = 0;
    let totalTaxablePaise = 0;
    let totalTaxPaise = 0;

    lines.forEach((line) => {
      const qtyMilli = Math.round((parseFloat(line.quantity_units) || 0) * 1000);
      const costInr = parseFloat(line.cost_price_inr) || 0;
      const costPaise = Math.round(costInr * 100);
      const lineTaxable = Math.round((qtyMilli * costPaise) / 1000);
      const lineTax = Math.round((lineTaxable * line.tax_rate_bps) / 10000);

      totalQtyMilli += qtyMilli;
      totalTaxablePaise += lineTaxable;
      totalTaxPaise += lineTax;
    });

    const grandTotalPaise = totalTaxablePaise + totalTaxPaise;

    return {
      totalQtyUnits: totalQtyMilli / 1000,
      totalTaxablePaise,
      totalTaxPaise,
      grandTotalPaise,
      amountInWords: paiseToWords(grandTotalPaise),
    };
  }, [lines]);

  const handleSubmitGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    // Validation
    let matchedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
    let supplierId = matchedSupplier?.id;
    if (!supplierId && customSupplierName.trim()) {
      try {
        const newSup = ErpStorageService.addEntity({
          entity_code: `SUP-${Date.now().toString().slice(-4)}`,
          entity_type: 'SUPPLIER',
          full_name: customSupplierName.trim(),
          phone: '',
          state_code: '27',
          opening_balance_paise: 0,
          is_active: true,
        });
        supplierId = newSup.id;
        matchedSupplier = newSup;
      } catch {}
    }

    if (!challanNumber.trim()) {
      setStatusMessage({ type: 'error', text: 'Challan / Invoice number is required.' });
      return;
    }

    // Check for any incomplete row before submitting to prevent silent item omission
    const incompleteIndex = lines.findIndex(
      (l) => !l.resource_id || !(parseFloat(l.quantity_units) > 0) || !(parseFloat(l.cost_price_inr) >= 0)
    );
    if (incompleteIndex !== -1) {
      setStatusMessage({
        type: 'error',
        text: `Line #${incompleteIndex + 1} is incomplete. Please select a catalog product, quantity > 0, and non-negative cost price (or delete the row).`,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const purchasePayload = {
        supplier: matchedSupplier?.id || undefined,
        supplier_state_code: matchedSupplier?.state_code || undefined,
        invoice_number: challanNumber.trim(),
        invoice_date: receiptDate,
        price_mode: 'EXCLUSIVE' as const,
        lines: lines.map((l) => {
          const matchedProd = products.find((p) => p.id === l.resource_id);
          return {
            resource_id: l.resource_id,
            sku: matchedProd?.sku || l.item_name,
            name: matchedProd?.name || l.item_name,
            quantity_milli: Math.round(parseFloat(l.quantity_units) * 1000),
            cost_price_paise: Math.round(parseFloat(l.cost_price_inr) * 100),
            batch_number: l.batch_number.trim() || undefined,
            expiry_date: l.expiry_date.trim() || undefined,
            mrp_paise: l.mrp_inr ? Math.round(parseFloat(l.mrp_inr) * 100) : undefined,
            tax_rate_bps: l.tax_rate_bps,
          };
        }),
      };

      const res = await apiPostPurchase(purchasePayload);

      if (res.success) {
        posSound.playSuccess();
        try {
          localStorage.removeItem('omnibill_grn_draft');
        } catch {}
        setStatusMessage({
          type: 'success',
          text: `GRN #${challanNumber} posted successfully! Inward inventory committed into stock ledger.`,
        });

        // Reset form for next intake
        setChallanNumber(`GRN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
        setLines([
          {
            id: 'line_' + Date.now(),
            resource_id: '',
            item_name: '',
            batch_number: `BATCH-${new Date().getMonth() + 1}${new Date().getDate()}`,
            expiry_date: '2027-12-31',
            quantity_units: '10',
            cost_price_inr: '',
            mrp_inr: '',
            tax_rate_bps: 500,
          },
        ]);
      } else {
        setStatusMessage({
          type: 'error',
          text: res.error || 'Failed to post GRN to SQLite database.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'An unexpected error occurred during GRN intake.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const pastPurchases = useMemo(() => {
    return posStorage.getPurchases();
  }, [statusMessage]);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <PackagePlus className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-wide flex items-center space-x-2">
              <span>Goods Received Note (GRN) & Inward Stock</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
                Inward Intake
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Record supplier shipments, assign batch numbers & expiry, and commit stock into the double-entry ledger.
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-2 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('NEW_GRN')}
            className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
              activeTab === 'NEW_GRN'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PackagePlus className="w-3.5 h-3.5" />
            <span>New Inward Challan</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            className={`px-3 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors ${
              activeTab === 'HISTORY'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Inward History ({pastPurchases.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        {activeTab === 'NEW_GRN' ? (
          <form onSubmit={handleSubmitGrn} className="max-w-6xl mx-auto space-y-5">
            {/* Notification Banner */}
            {statusMessage && (
              <div
                className={`p-3.5 rounded-xl border flex items-center space-x-2.5 text-xs font-medium animate-in fade-in duration-200 ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Header Metadata Section */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              {/* Supplier Selection */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1 flex items-center">
                  <Building2 className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  <span>Supplier / Vendor</span>
                </label>
                {selectedSupplierId === '__CUSTOM__' ? (
                  <div className="flex items-center space-x-1.5">
                    <input
                      type="text"
                      value={customSupplierName}
                      onChange={(e) => setCustomSupplierName(e.target.value)}
                      placeholder="e.g. MicroTools India / Gujarat Tech"
                      className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplierId('');
                        setCustomSupplierName('');
                      }}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px]"
                      title="Back to dropdown"
                    >
                      List
                    </button>
                  </div>
                ) : (
                  <select
                    value={selectedSupplierId}
                    onChange={(e) => {
                      setSelectedSupplierId(e.target.value);
                      if (e.target.value !== '__CUSTOM__') setCustomSupplierName('');
                    }}
                    className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Select Registered Supplier --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} ({s.phone || 'No Phone'})
                      </option>
                    ))}
                    <option value="__CUSTOM__">+ Enter New / Custom Supplier...</option>
                  </select>
                )}
              </div>

              {/* Inward Challan / Bill No */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1 flex items-center">
                  <FileText className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  <span>Inward Challan / Bill Ref</span>
                </label>
                <input
                  type="text"
                  required
                  value={challanNumber}
                  onChange={(e) => setChallanNumber(e.target.value)}
                  placeholder="e.g. INV-PUR-4091"
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Receipt Date */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1 flex items-center">
                  <Calendar className="w-3.5 h-3.5 mr-1 text-slate-500" />
                  <span>Shipment Receipt Date</span>
                </label>
                <input
                  type="date"
                  required
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-md text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Security Invariant Pill */}
              <div className="flex flex-col justify-end">
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Trigger-Enforced Immutability: Inward movements cannot be deleted once committed.</span>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
              <div className="px-4 py-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
                <div className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <Barcode className="w-4 h-4 text-blue-400" />
                  <span>Inward Line Items & Batch Assignment</span>
                </div>
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center space-x-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Product</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 uppercase font-semibold">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Product / Resource</th>
                      <th className="py-2.5 px-3">Batch / Lot</th>
                      <th className="py-2.5 px-3">Expiry Date</th>
                      <th className="py-2.5 px-3">Qty (Units)</th>
                      <th className="py-2.5 px-3">Unit Cost (₹)</th>
                      <th className="py-2.5 px-3">GST (%)</th>
                      <th className="py-2.5 px-3">MRP (₹)</th>
                      <th className="py-2.5 px-3 text-right">Line Total (₹)</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {lines.map((line, idx) => {
                      const qtyUnits = parseFloat(line.quantity_units) || 0;
                      const costPaise = Math.round((parseFloat(line.cost_price_inr) || 0) * 100);
                      const taxablePaise = Math.round(qtyUnits * costPaise);
                      const taxPaise = Math.round((taxablePaise * line.tax_rate_bps) / 10000);
                      const lineTotalPaise = taxablePaise + taxPaise;

                      return (
                        <tr key={line.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-2 px-3">
                            <select
                              value={line.resource_id}
                              onChange={(e) => handleLineChange(line.id, 'resource_id', e.target.value)}
                              className="w-48 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 font-sans focus:outline-none focus:border-blue-500"
                            >
                              <option value="">-- Pick Catalog Item --</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.sku})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={line.batch_number}
                              onChange={(e) => handleLineChange(line.id, 'batch_number', e.target.value)}
                              placeholder="Batch #"
                              className="w-24 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="date"
                              value={line.expiry_date}
                              onChange={(e) => handleLineChange(line.id, 'expiry_date', e.target.value)}
                              className="w-28 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={line.quantity_units}
                              onChange={(e) => handleLineChange(line.id, 'quantity_units', e.target.value)}
                              className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-right focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.cost_price_inr}
                              onChange={(e) => handleLineChange(line.id, 'cost_price_inr', e.target.value)}
                              placeholder="0.00"
                              className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-right focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={line.tax_rate_bps}
                              onChange={(e) => handleLineChange(line.id, 'tax_rate_bps', parseInt(e.target.value, 10))}
                              className="w-16 px-1.5 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-blue-500"
                            >
                              <option value="0">0%</option>
                              <option value="500">5%</option>
                              <option value="1200">12%</option>
                              <option value="1800">18%</option>
                              <option value="2800">28%</option>
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.mrp_inr}
                              onChange={(e) => handleLineChange(line.id, 'mrp_inr', e.target.value)}
                              placeholder="MRP"
                              className="w-20 px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-right focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-200">
                            {formatPaise(lineTotalPaise)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.id)}
                              disabled={lines.length === 1}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Inward Totals & Words Summary Card */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-xs">
                <div className="text-slate-400">
                  Total Lines: <strong className="text-slate-200">{lines.length}</strong> | Total Units:{' '}
                  <strong className="text-slate-200">{summary.totalQtyUnits}</strong>
                </div>
                <div className="text-slate-400 font-sans">
                  Taxable Amount: <span className="font-mono text-slate-200">{formatPaise(summary.totalTaxablePaise)}</span> | Tax:{' '}
                  <span className="font-mono text-slate-200">{formatPaise(summary.totalTaxPaise)}</span>
                </div>
                <div className="text-[11px] text-emerald-400 italic">
                  &ldquo;{summary.amountInWords}&rdquo;
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-[10px] uppercase font-semibold text-slate-400">
                    Grand Inward Total
                  </div>
                  <div className="text-2xl font-mono font-bold text-blue-400">
                    {formatPaise(summary.grandTotalPaise)}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
                >
                  <PackagePlus className="w-4 h-4" />
                  <span>{isSubmitting ? 'Posting...' : 'Post GRN & Restock'}</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* History View */
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
              <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <History className="w-4 h-4 text-blue-400" />
                <span>Historical Goods Received Notes (Inward Ledger)</span>
              </div>

              {pastPurchases.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No inward shipments posted yet. Post your first GRN above.
                </div>
              ) : (
                <div className="divide-y divide-slate-800 text-xs">
                  {pastPurchases.map((p, idx) => (
                    <div key={p.id || idx} className="p-4 hover:bg-slate-800/30 transition-colors flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-blue-400">{p.invoice_number || 'CHALLAN'}</span>
                          <span className="text-slate-500">&bull;</span>
                          <span className="font-semibold text-slate-200">{p.supplier || 'Vendor'}</span>
                        </div>
                        <div className="text-slate-400 text-[11px] flex items-center space-x-3">
                          <span>Date: {p.invoice_date}</span>
                          <span>Lines: {p.lines?.length || 0}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
                          COMMITTED TO STOCK
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
