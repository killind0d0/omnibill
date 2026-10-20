import React from 'react';
import { Trash2, Plus, Minus, Tag, PackageSearch } from 'lucide-react';
import { CartLineItem } from '../../types/pos';
import { formatPaise, formatMilliQty } from '../../lib/tax';

interface CartTableProps {
  items: CartLineItem[];
  selectedRowIndex: number;
  onSelectRow: (index: number) => void;
  onUpdateQuantityMilli: (index: number, newMilli: number) => void;
  onUpdateUnitPricePaise: (index: number, newPaise: number) => void;
  onUpdateDiscountPaise: (index: number, newPaise: number) => void;
  onRemoveItem: (index: number) => void;
  isIntraState: boolean;
}

export const CartTable: React.FC<CartTableProps> = ({
  items,
  selectedRowIndex,
  onSelectRow,
  onUpdateQuantityMilli,
  onUpdateUnitPricePaise,
  onUpdateDiscountPaise,
  onRemoveItem,
  isIntraState,
}) => {
  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-900/30 select-none">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4 text-slate-400">
          <PackageSearch className="w-8 h-8" />
        </div>
        <h4 className="text-base font-semibold text-slate-300 mb-1">Billing Cart is Empty</h4>
        <p className="text-sm text-slate-400 text-center max-w-sm mb-4">
          Scan a barcode or type in the Numpad Quick-Entry bar (<code className="text-blue-400 font-mono">Qty*Price</code> or <code className="text-blue-400 font-mono">Barcode</code>)
        </p>
        <div className="flex items-center space-x-2 text-xs text-slate-500 bg-slate-800/40 px-3 py-1.5 rounded-lg border border-slate-800">
          <kbd className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-400">Enter / Tab</kbd>
          <span>Cycle Inputs</span>
          <span className="text-slate-600">•</span>
          <kbd className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-400">Esc</kbd>
          <span>Clear Cart</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden border border-slate-800 rounded-xl bg-slate-900/50">
      <div className="overflow-x-auto overflow-y-auto flex-1">
        <table className="w-full text-left text-xs border-collapse">
          {/* Sticky Header */}
          <thead className="bg-slate-900/95 sticky top-0 z-10 border-b border-slate-800 text-slate-400 font-semibold tracking-wider uppercase text-[11px] select-none">
            <tr>
              <th className="py-2.5 px-3 w-10 text-center">#</th>
              <th className="py-2.5 px-3">Item Description</th>
              <th className="py-2.5 px-2 w-20">HSN</th>
              <th className="py-2.5 px-3 w-36 text-center">Qty</th>
              <th className="py-2.5 px-3 w-28 text-right">Rate</th>
              <th className="py-2.5 px-3 w-24 text-right">Disc</th>
              <th className="py-2.5 px-3 w-24 text-right">Taxable</th>
              <th className="py-2.5 px-2 w-20 text-center">Tax %</th>
              <th className="py-2.5 px-3 w-28 text-right font-bold text-slate-300">Total</th>
              <th className="py-2.5 px-2 w-10 text-center"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {items.map((item, idx) => {
              const isSelected = selectedRowIndex === idx;
              const taxPct = (item.tax_rate_bps / 100).toFixed(0);

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelectRow(idx)}
                  className={`group transition-colors ${
                    isSelected
                      ? 'bg-blue-600/15 border-l-4 border-l-blue-500'
                      : 'hover:bg-slate-800/40 border-l-4 border-l-transparent'
                  }`}
                >
                  {/* Row Number */}
                  <td className="py-2 px-3 text-center text-slate-500 font-mono">
                    {idx + 1}
                  </td>

                  {/* Description & Barcode */}
                  <td className="py-2 px-3">
                    <div className="font-medium text-slate-100 flex items-center gap-1.5">
                      <span>{item.name}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono mt-0.5">
                      <span className="text-slate-500">SKU: {item.sku}</span>
                      <span>•</span>
                      <span className="text-slate-500 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />
                        {item.barcode}
                      </span>
                    </div>
                  </td>

                  {/* HSN */}
                  <td className="py-2 px-2 text-slate-400 font-mono text-[11px]">
                    {item.hsn || '-'}
                  </td>

                  {/* Qty with Quick +/- and direct input */}
                  <td className="py-1.5 px-3">
                    <div className="flex items-center justify-center space-x-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextMilli = Math.max(1000, item.quantity_milli - 1000);
                          onUpdateQuantityMilli(idx, nextMilli);
                        }}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
                        title="Decrease Qty"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        value={formatMilliQty(item.quantity_milli)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            onUpdateQuantityMilli(idx, Math.round(val * 1000));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-16 h-7 text-center bg-slate-950 border border-slate-700 rounded text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        title="Quantity"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateQuantityMilli(idx, item.quantity_milli + 1000);
                        }}
                        className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
                        title="Increase Qty"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </td>

                  {/* Unit Rate */}
                  <td className="py-1.5 px-3 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <span className="text-slate-500 text-[11px]">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={(item.unit_price_paise / 100).toFixed(2)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            onUpdateUnitPricePaise(idx, Math.round(val * 100));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-20 h-7 text-right bg-slate-950 border border-slate-700 rounded px-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        title="Unit Price"
                      />
                    </div>
                  </td>

                  {/* Discount */}
                  <td className="py-1.5 px-3 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <span className="text-slate-500 text-[11px]">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={(item.discount_paise / 100).toFixed(2)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val >= 0) {
                            onUpdateDiscountPaise(idx, Math.round(val * 100));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className="w-16 h-7 text-right bg-slate-950 border border-slate-700 rounded px-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        title="Discount"
                      />
                    </div>
                  </td>

                  {/* Taxable */}
                  <td className="py-2 px-3 text-right font-mono text-slate-300">
                    {formatPaise(item.taxable_paise)}
                  </td>

                  {/* Tax % */}
                  <td className="py-2 px-2 text-center font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                      {taxPct}%
                    </span>
                    <div className="text-[9px] text-slate-500">
                      {isIntraState ? 'CGST+SGST' : 'IGST'}
                    </div>
                  </td>

                  {/* Line Total */}
                  <td className="py-2 px-3 text-right font-mono font-bold text-slate-100">
                    {formatPaise(item.line_total_paise)}
                  </td>

                  {/* Action Delete */}
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(idx);
                      }}
                      className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove Row (Delete)"
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
  );
};
