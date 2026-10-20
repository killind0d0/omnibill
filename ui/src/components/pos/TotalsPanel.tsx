import React from 'react';
import { CreditCard, Printer, RotateCcw, ArrowRightLeft, User } from 'lucide-react';
import { ComputedDocumentTotals, PriceMode } from '../../types/pos';
import { formatPaise } from '../../lib/tax';

interface TotalsPanelProps {
  totals: ComputedDocumentTotals;
  priceMode: PriceMode;
  onTogglePriceMode: () => void;
  isIntraState: boolean;
  onToggleIntraState: () => void;
  sellerStateCode: string;
  placeOfSupplyStateCode: string;
  onChangePlaceOfSupply: (code: string) => void;
  customerPhone: string;
  onChangeCustomerPhone: (val: string) => void;
  customerName: string;
  onChangeCustomerName: (val: string) => void;
  itemCount: number;
  onOpenPayment: () => void;
  onSaveAndPrintSlip: () => void;
  onClearCart: () => void;
}

const INDIAN_STATES = [
  { code: '27', name: '27 - Maharashtra (Intra-State)' },
  { code: '29', name: '29 - Karnataka (Inter-State)' },
  { code: '24', name: '24 - Gujarat (Inter-State)' },
  { code: '07', name: '07 - Delhi (Inter-State)' },
  { code: '33', name: '33 - Tamil Nadu (Inter-State)' },
  { code: '06', name: '06 - Haryana (Inter-State)' },
  { code: '19', name: '19 - West Bengal (Inter-State)' },
  { code: '36', name: '36 - Telangana (Inter-State)' },
];

export const TotalsPanel: React.FC<TotalsPanelProps> = ({
  totals,
  priceMode,
  onTogglePriceMode,
  isIntraState,
  placeOfSupplyStateCode,
  onChangePlaceOfSupply,
  customerPhone,
  onChangeCustomerPhone,
  customerName,
  onChangeCustomerName,
  itemCount,
  onOpenPayment,
  onSaveAndPrintSlip,
  onClearCart,
}) => {
  const roundOffSign = totals.round_off_paise > 0 ? '+' : '';

  return (
    <div className="w-80 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between shadow-lg p-4 select-none">
      <div className="space-y-4">
        {/* Customer & Tax Settings Bar */}
        <div className="space-y-2.5 pb-3 border-b border-slate-800">
          {/* Price Mode Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Pricing Mode</span>
            <button
              type="button"
              onClick={onTogglePriceMode}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                priceMode === 'INCLUSIVE'
                  ? 'bg-purple-950/50 text-purple-300 border-purple-700/50 hover:bg-purple-900/50'
                  : 'bg-blue-950/50 text-blue-300 border-blue-700/50 hover:bg-blue-900/50'
              }`}
              title="Click to toggle Tax Exclusive / Inclusive"
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span>{priceMode === 'INCLUSIVE' ? 'Tax Inclusive' : 'Tax Exclusive'}</span>
            </button>
          </div>

          {/* Place of Supply State Selector */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Place of Supply</span>
            <select
              value={placeOfSupplyStateCode}
              onChange={(e) => onChangePlaceOfSupply(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1 font-mono focus:outline-none focus:border-blue-500"
            >
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Customer Input (Quick Phone + Name) */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center space-x-1.5 text-xs text-slate-400">
              <User className="w-3 h-3 text-slate-500" />
              <span>Customer (Optional)</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                placeholder="Phone (10 digits)"
                value={customerPhone}
                onChange={(e) => onChangeCustomerPhone(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                placeholder="Customer Name"
                value={customerName}
                onChange={(e) => onChangeCustomerName(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Real-Time Financial Totals Breakdown */}
        <div className="space-y-2 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'}):</span>
            <span className="font-mono text-slate-200">{formatPaise(totals.subtotal_paise)}</span>
          </div>

          {totals.discount_paise > 0 && (
            <div className="flex justify-between text-emerald-400 font-medium">
              <span>Total Discount:</span>
              <span className="font-mono">-{formatPaise(totals.discount_paise)}</span>
            </div>
          )}

          <div className="flex justify-between text-slate-400">
            <span>Taxable Value:</span>
            <span className="font-mono text-slate-200">{formatPaise(totals.taxable_paise)}</span>
          </div>

          {isIntraState ? (
            <>
              <div className="flex justify-between text-slate-400">
                <span>CGST:</span>
                <span className="font-mono text-slate-200">{formatPaise(totals.cgst_paise)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>SGST:</span>
                <span className="font-mono text-slate-200">{formatPaise(totals.sgst_paise)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between text-amber-400">
              <span>IGST (Inter-State):</span>
              <span className="font-mono">{formatPaise(totals.igst_paise)}</span>
            </div>
          )}

          <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800/80">
            <span className="flex items-center gap-1">
              <span>Round Off:</span>
              <span className="text-[10px] text-slate-500">(-49 to +50p)</span>
            </span>
            <span className={`font-mono ${totals.round_off_paise < 0 ? 'text-amber-400' : totals.round_off_paise > 0 ? 'text-blue-400' : 'text-slate-400'}`}>
              {totals.round_off_paise !== 0 ? `${roundOffSign}${formatPaise(totals.round_off_paise)}` : '₹0.00'}
            </span>
          </div>
        </div>

        {/* High-Impact Total Amount Box */}
        <div className="bg-slate-950 border-2 border-emerald-500/40 rounded-xl p-3 shadow-inner">
          <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5">
            Net Payable Amount
          </div>
          <div className="text-3xl font-black font-mono tracking-tight text-white flex items-baseline">
            {formatPaise(totals.total_amount_paise)}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-4">
        {/* F4 Pay & Settle */}
        <button
          type="button"
          onClick={onOpenPayment}
          disabled={itemCount === 0}
          className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-between transition-all ${
            itemCount > 0
              ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center space-x-2">
            <CreditCard className="w-4 h-4" />
            <span>Pay & Settle</span>
          </div>
          <kbd className="bg-emerald-700/80 text-emerald-100 text-[10px] px-1.5 py-0.5 rounded">
            F4
          </kbd>
        </button>

        {/* Alt+S Save & Print Thermal Slip */}
        <button
          type="button"
          onClick={onSaveAndPrintSlip}
          disabled={itemCount === 0}
          className={`w-full py-2 px-4 rounded-xl font-semibold text-xs flex items-center justify-between transition-all ${
            itemCount > 0
              ? 'bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 cursor-pointer'
              : 'bg-slate-800/40 text-slate-600 border border-slate-800 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center space-x-2">
            <Printer className="w-4 h-4 text-indigo-400" />
            <span>Save & Print Slip</span>
          </div>
          <kbd className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded">
            Alt+S
          </kbd>
        </button>

        {/* Clear Cart Esc */}
        <button
          type="button"
          onClick={onClearCart}
          disabled={itemCount === 0}
          className="w-full py-1.5 px-4 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/20 text-xs flex items-center justify-between transition-colors"
        >
          <div className="flex items-center space-x-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear Cart</span>
          </div>
          <kbd className="bg-slate-900 border border-slate-800 text-slate-500 text-[10px] px-1.5 py-0.5 rounded">
            Esc
          </kbd>
        </button>
      </div>
    </div>
  );
};
