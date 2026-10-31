import React from 'react';
import { Trash2, Plus, Minus, Tag, PackageSearch, RotateCcw } from 'lucide-react';
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
  onToggleReturn?: (index: number) => void;
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
  onToggleReturn,
  isIntraState,
}) => {
  if (items.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/30 select-none">
        <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center mb-3 text-slate-400">
          <PackageSearch className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-slate-200 mb-1">Billing Cart is Empty</h4>
        <p className="text-xs text-slate-400 text-center max-w-sm mb-3">
          Scan a barcode or type in the Numpad Quick-Entry bar (<code className="text-blue-400 font-mono">Qty*Price</code> or <code className="text-blue-400 font-mono">Barcode</code>)
        </p>
        <div className="flex items-center space-x-2 text-[11px] text-slate-400 bg-slate-800/40 px-3 py-1.5 rounded-lg border border-slate-800">
          <kbd className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-300 font-mono">Enter / Tab</kbd>
          <span>Cycle Inputs</span>
          <span className="text-slate-600">•</span>
          <kbd className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-300 font-mono">Esc</kbd>
          <span>Clear Cart</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden border border-slate-800 rounded-xl bg-slate-900/50">
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-left text-xs border-collapse" aria-label="Billing Cart Items">
          {/* Sticky Header */}
          <thead className="bg-slate-900 sticky top-0 z-10 border-b border-slate-800 text-slate-400 font-semibold tracking-wider uppercase text-[11px] select-none">
            <tr>
              <th scope="col" className="py-2.5 px-3 w-10 text-center">#</th>
              <th scope="col" className="py-2.5 px-3">Item Description</th>
              <th scope="col" className="py-2.5 px-2 w-20">HSN</th>
              <th scope="col" className="py-2.5 px-3 w-36 text-center">Qty</th>
              <th scope="col" className="py-2.5 px-3 w-28 text-right">Rate</th>
              <th scope="col" className="py-2.5 px-3 w-24 text-right">Disc</th>
              <th scope="col" className="py-2.5 px-3 w-24 text-right">Taxable</th>
              <th scope="col" className="py-2.5 px-2 w-20 text-center">Tax %</th>
              <th scope="col" className="py-2.5 px-3 w-28 text-right font-bold text-slate-300">Total</th>
              <th scope="col" className="py-2.5 px-2 w-10 text-center">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-sans">
            {items.map((item, idx) => {
              const isSelected = selectedRowIndex === idx;
              const taxPct = (item.tax_rate_bps / 100).toFixed(0);
              const isReturn = !!item.is_return;

              const isNearExpiry = item.expiry_date
                ? (() => {
                    try {
                      const exp = new Date(item.expiry_date);
                      const now = new Date();
                      const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 3600 * 24));
                      return diffDays <= 30;
                    } catch {
                      return false;
                    }
                  })()
                : false;

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelectRow(idx)}
                  className={`group transition-colors ${
                    isReturn
                      ? isSelected
                        ? 'bg-rose-950/40 border-l-4 border-l-rose-500'
                        : 'bg-rose-950/20 hover:bg-rose-950/30 border-l-4 border-l-rose-400'
                      : isSelected
                      ? 'bg-blue-600/15 border-l-4 border-l-blue-500'
                      : 'hover:bg-slate-800/40 border-l-4 border-l-transparent'
                  }`}
                >
                  {/* Row Number */}
                  <td className="py-2 px-3 text-center text-slate-400 font-mono">
                    {idx + 1}
                  </td>

                  {/* Description & Barcode with Truncation & Word-Wrap */}
                  <td className="py-2 px-3 max-w-[260px]">
                    <div className="flex items-center gap-1.5 font-medium line-clamp-2 break-words" title={item.name}>
                      {isReturn && (
                        <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-bold tracking-wider shrink-0">
                          RETURN
                        </span>
                      )}
                      {isNearExpiry && (
                        <span
                          className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold tracking-wider shrink-0"
                          title={`Lot Near Expiry: ${item.expiry_date}`}
                        >
                          NEAR EXPIRY
                        </span>
                      )}
                      <span className={isReturn ? 'text-rose-200' : 'text-slate-100'}>{item.name}</span>
                    </div>
                    <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono mt-0.5">
                      <span className="text-slate-400">SKU: {item.sku}</span>
                      <span>•</span>
                      <span className="text-slate-400 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5" />
                        {item.barcode}
                      </span>
                    </div>
                  </td>

                  {/* HSN */}
                  <td className="py-2 px-2 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                    {item.hsn || '-'}
                  </td>

                  {/* Qty with Quick +/- and direct input & UOM */}
                  <td className="py-1.5 px-3">
                    <div className="flex items-center justify-center space-x-1">
                      <button
                        type="button"
                        aria-label={`Decrease quantity for ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextMilli = Math.max(1000, item.quantity_milli - 1000);
                          onUpdateQuantityMilli(idx, nextMilli);
                        }}
                        className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors focus-ring"
                        title="Decrease Qty"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        aria-label={`Quantity for ${item.name}`}
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
                        className="w-16 h-7 text-center bg-slate-950 border border-slate-700 rounded text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus-ring"
                        title="Quantity"
                      />
                      <span className="text-[10px] text-slate-400 font-mono uppercase px-0.5">{item.unit || 'pcs'}</span>
                      <button
                        type="button"
                        aria-label={`Increase quantity for ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateQuantityMilli(idx, item.quantity_milli + 1000);
                        }}
                        className="w-7 h-7 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors focus-ring"
                        title="Increase Qty"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>

                  {/* Unit Rate */}
                  <td className="py-1.5 px-3 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <span className="text-slate-400 text-[11px]">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`Unit price for ${item.name}`}
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
                        className="w-20 h-7 text-right bg-slate-950 border border-slate-700 rounded px-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus-ring"
                        title="Unit Price"
                      />
                    </div>
                  </td>

                  {/* Discount */}
                  <td className="py-1.5 px-3 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <span className="text-slate-400 text-[11px]">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`Discount for ${item.name}`}
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
                        className="w-16 h-7 text-right bg-slate-950 border border-slate-700 rounded px-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-blue-500 focus-ring"
                        title="Discount"
                      />
                    </div>
                  </td>

                  {/* Taxable */}
                  <td className="py-2 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                    {formatPaise(item.taxable_paise)}
                  </td>

                  {/* Tax % */}
                  <td className="py-2 px-2 text-center font-mono">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                      {taxPct}%
                    </span>
                    <div className="text-[9px] text-slate-400">
                      {isIntraState ? 'CGST+SGST' : 'IGST'}
                    </div>
                  </td>

                  {/* Line Total */}
                  <td className={`py-2 px-3 text-right font-mono font-bold whitespace-nowrap ${isReturn ? 'text-rose-400' : 'text-slate-100'}`}>
                    {formatPaise(item.line_total_paise)}
                  </td>

                  {/* Actions: Toggle Return & Delete */}
                  <td className="py-2 px-2 text-center">
                    <div className="flex items-center justify-center space-x-1">
                      {onToggleReturn && (
                        <button
                          type="button"
                          aria-label={`Toggle return status for ${item.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleReturn(idx);
                          }}
                          className={`w-7 h-7 rounded flex items-center justify-center transition-colors focus-ring ${
                            isReturn
                              ? 'bg-rose-600/30 text-rose-300 hover:bg-rose-600/50'
                              : 'text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10'
                          }`}
                          title={isReturn ? 'Switch to normal Sale' : 'Mark as Return'}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${item.name} from cart`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveItem(idx);
                        }}
                        className="w-7 h-7 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors focus-ring"
                        title="Remove Row (Delete)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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
