import React, { useState } from 'react';
import { Truck, Plus, Trash2, CheckCircle2, ArrowLeft, PackageCheck } from 'lucide-react';
import { ResourceItem } from '../../types/pos';
import { formatPaise, parseRupeesToPaise, parseQtyToMilli, formatMilliQty } from '../../lib/tax';
import { apiPostPurchase } from '../../lib/api';

interface PurchaseEntryProps {
  products: ResourceItem[];
  businessDate: string;
  onBackToSales: () => void;
  onRefreshProducts: () => void;
}

interface PurchaseLine {
  resource_id: string;
  product_name: string;
  quantity_milli: number;
  cost_price_paise: number;
}

export const PurchaseEntry: React.FC<PurchaseEntryProps> = ({
  products,
  businessDate,
  onBackToSales,
  onRefreshProducts,
}) => {
  const [supplier, setSupplier] = useState('Metro Wholesale Pvt Ltd');
  const [invNumber, setInvNumber] = useState(`PUR-${Date.now().toString().slice(-6)}`);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '');
  const [qtyInput, setQtyInput] = useState('10');
  const [costInput, setCostInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const selectedProd = products.find((p) => p.id === selectedProductId);

  const handleAddLine = () => {
    if (!selectedProd) return;
    const qMilli = parseQtyToMilli(qtyInput);
    const cPaise = costInput ? parseRupeesToPaise(costInput) : selectedProd.cost_price_paise;

    setLines((prev) => [
      ...prev,
      {
        resource_id: selectedProd.id,
        product_name: selectedProd.name,
        quantity_milli: qMilli,
        cost_price_paise: cPaise,
      },
    ]);

    setQtyInput('10');
    setCostInput('');
  };

  const handleRemoveLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalCostPaise = lines.reduce(
    (sum, l) => sum + Math.round((l.quantity_milli * l.cost_price_paise) / 1000),
    0
  );

  const handleSubmitPurchase = async () => {
    if (lines.length === 0) return;
    setIsSubmitting(true);
    try {
      await apiPostPurchase({
        supplier,
        invoice_number: invNumber,
        invoice_date: businessDate,
        lines: lines.map((l) => ({
          resource_id: l.resource_id,
          quantity_milli: l.quantity_milli,
          cost_price_paise: l.cost_price_paise,
        })),
      });

      setSuccessMessage(`Purchase ${invNumber} posted successfully! Inventory updated.`);
      setLines([]);
      setInvNumber(`PUR-${Date.now().toString().slice(-6)}`);
      onRefreshProducts();
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('Failed to post purchase:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onBackToSales}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Back to Sales POS (F8)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-400" />
              <span>Purchases & Goods Inward (F9)</span>
            </h2>
            <div className="text-xs text-slate-400">
              Record incoming stock and update weighted-average cost price
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToSales}
          className="px-3 py-1.5 bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded-lg text-xs font-semibold hover:bg-blue-600/30 transition-all"
        >
          Return to Sales (F8)
        </button>
      </div>

      {successMessage && (
        <div className="bg-emerald-950/80 border border-emerald-600/60 p-3 rounded-xl text-emerald-300 text-xs flex items-center space-x-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Supplier & Invoice Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier Name</label>
          <input
            type="text"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">Supplier Invoice #</label>
          <input
            type="text"
            value={invNumber}
            onChange={(e) => setInvNumber(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1">Invoice Date</label>
          <input
            type="date"
            value={businessDate}
            readOnly
            className="w-full bg-slate-950 border border-slate-800 text-slate-400 rounded-lg px-3 py-2 text-xs font-mono"
          />
        </div>
      </div>

      {/* Add Item Bar */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Add Inward Item
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">Select Product</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock: {formatMilliQty(p.stock_milli)} {p.unit})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Quantity</label>
            <input
              type="number"
              step="any"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
              placeholder="e.g. 10"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cost Price (₹)</label>
            <input
              type="number"
              step="0.01"
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
              placeholder={selectedProd ? (selectedProd.cost_price_paise / 100).toFixed(2) : '0.00'}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddLine}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add to Purchase List</span>
        </button>
      </div>

      {/* Table of Inward Items */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
        <div className="p-3 border-b border-slate-800 font-bold text-xs text-slate-300">
          Inward Line Items ({lines.length})
        </div>
        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No items added to this purchase yet. Add items above.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3 text-center">Qty</th>
                  <th className="py-2.5 px-3 text-right">Cost Price</th>
                  <th className="py-2.5 px-3 text-right">Line Total</th>
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
                      <td className="py-2 px-3 text-center font-mono">{formatMilliQty(l.quantity_milli)}</td>
                      <td className="py-2 px-3 text-right font-mono">{formatPaise(l.cost_price_paise)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-200">
                        {formatPaise(lineTotal)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="p-1 text-slate-500 hover:text-red-400 transition-colors"
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
            <span className="text-xs text-slate-400 mr-2">Total Inward Value:</span>
            <span className="text-xl font-bold font-mono text-emerald-400">
              {formatPaise(totalCostPaise)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSubmitPurchase}
            disabled={lines.length === 0 || isSubmitting}
            className={`px-6 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all ${
              lines.length > 0 && !isSubmitting
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            <PackageCheck className="w-4 h-4" />
            <span>{isSubmitting ? 'Posting...' : 'Post Purchase & Update Stock'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
