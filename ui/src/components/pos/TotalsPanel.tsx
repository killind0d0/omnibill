import React, { useMemo, useEffect } from 'react';
import { CreditCard, Printer, RotateCcw, ArrowRightLeft, User, Coins, ShieldAlert, ShieldCheck, Wallet, CheckCircle2, PauseCircle, PlayCircle, AlertCircle, Star } from 'lucide-react';
import { ComputedDocumentTotals, PriceMode } from '../../types/pos';
import { formatPaise } from '../../lib/tax';
import { ErpStorageService } from '../../lib/erpStorage';
import { Entity } from '../../types/accounting';

interface CustomerEntity extends Entity {
  trade_name?: string;
  legal_name?: string;
  credit_limit_paise?: number;
}

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
  onOpenShift?: () => void;
  onHoldBill?: () => void;
  onRecallBills?: () => void;
  heldBillsCount?: number;
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
  onOpenShift,
  onHoldBill,
  onRecallBills,
  heldBillsCount = 0,
}) => {
  const roundOffSign = totals.round_off_paise > 0 ? '+' : '';

  // Load customer entities for real-time Khata & Credit balance checks
  const registeredCustomers = useMemo<CustomerEntity[]>(() => {
    try {
      return ErpStorageService.getEntities('CUSTOMER') as CustomerEntity[];
    } catch {
      return [];
    }
  }, []);

  const matchedCustomer = useMemo<CustomerEntity | null>(() => {
    const p = customerPhone.trim();
    const n = customerName.trim().toLowerCase();
    if (p.length >= 4) {
      const byPhone = registeredCustomers.find((c) => c.phone && c.phone.includes(p));
      if (byPhone) return byPhone;
    }
    if (n.length >= 2) {
      const byName = registeredCustomers.find(
        (c) =>
          (c.full_name && c.full_name.toLowerCase().includes(n)) ||
          (c.trade_name && c.trade_name.toLowerCase().includes(n)) ||
          (c.legal_name && c.legal_name.toLowerCase().includes(n))
      );
      if (byName) return byName;
    }
    return null;
  }, [registeredCustomers, customerPhone, customerName]);

  // Auto-fill customer name if 10-digit phone matches an existing customer
  useEffect(() => {
    if (customerPhone.trim().length === 10 && matchedCustomer && !customerName.trim()) {
      onChangeCustomerName(matchedCustomer.trade_name || matchedCustomer.full_name || matchedCustomer.legal_name || '');
    }
  }, [customerPhone, matchedCustomer, customerName, onChangeCustomerName]);

  const creditLimitPaise = matchedCustomer?.credit_limit_paise || 0;
  const currentDuesPaise = matchedCustomer?.current_balance_paise || 0;
  const availableCreditPaise = Math.max(0, creditLimitPaise - Math.max(0, currentDuesPaise));
  const isCreditExceeded =
    creditLimitPaise > 0 && currentDuesPaise + totals.total_amount_paise > creditLimitPaise;

  // CF-20: Customer Loyalty tier & points balance
  const customerLoyalty = useMemo(() => {
    const p = customerPhone.trim() || matchedCustomer?.phone;
    if (p && p.length >= 10) {
      try {
        return ErpStorageService.getCustomerLoyalty(p);
      } catch {
        return null;
      }
    }
    return null;
  }, [customerPhone, matchedCustomer]);

  return (
    <div className="w-80 h-full min-h-0 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between shadow-lg p-3 sm:p-4 select-none">
      {/* Scrollable Upper Section: Customer, Taxes & Line Breakdown */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
        {/* Customer & Tax Settings Bar */}
        <div className="space-y-2.5 pb-2.5 border-b border-slate-800">
          {/* Price Mode Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Pricing Mode</span>
            <button
              type="button"
              onClick={onTogglePriceMode}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all focus-ring ${
                priceMode === 'INCLUSIVE'
                  ? 'bg-purple-950/50 text-purple-300 border-purple-700/50 hover:bg-purple-900/50'
                  : 'bg-blue-950/50 text-blue-300 border-blue-700/50 hover:bg-blue-900/50'
              }`}
              title="Click to toggle Tax Exclusive / Inclusive"
              aria-label={`Toggle pricing mode, currently ${priceMode === 'INCLUSIVE' ? 'Tax Inclusive' : 'Tax Exclusive'}`}
            >
              <ArrowRightLeft className="w-3 h-3" />
              <span>{priceMode === 'INCLUSIVE' ? 'Tax Inclusive' : 'Tax Exclusive'}</span>
            </button>
          </div>

          {/* Place of Supply State Selector */}
          <div className="flex items-center justify-between">
            <label htmlFor="pos-place-of-supply" className="text-xs text-slate-400 font-medium">Place of Supply</label>
            <select
              id="pos-place-of-supply"
              value={placeOfSupplyStateCode}
              onChange={(e) => onChangePlaceOfSupply(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-md px-2 py-1 font-mono focus-ring"
              aria-label="Select Place of Supply State"
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
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 font-mono placeholder-slate-600 focus-ring"
                aria-label="Customer Phone Number"
              />
              <input
                type="text"
                placeholder="Customer Name"
                value={customerName}
                onChange={(e) => onChangeCustomerName(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 placeholder-slate-600 focus-ring"
                aria-label="Customer Full Name"
              />
            </div>

            {/* Real-time Customer Khata & Credit Indicator */}
            {matchedCustomer ? (
              <div className="mt-1.5 p-2 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1 text-slate-200 font-semibold truncate max-w-[170px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      {matchedCustomer.trade_name || matchedCustomer.full_name || matchedCustomer.legal_name}
                    </span>
                  </div>
                  <span
                    className={`font-mono font-bold ${
                      currentDuesPaise > 0 ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    Khata: {formatPaise(Math.abs(currentDuesPaise))} {currentDuesPaise >= 0 ? 'Dr' : 'Cr'}
                  </span>
                </div>

                {/* Amber Due-Guard Alert for Previous Pending Balance */}
                {currentDuesPaise > 0 && (
                  <div role="status" aria-live="polite" className="flex items-center space-x-1.5 p-1.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-300 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      Prior Pending Due: <strong>{formatPaise(currentDuesPaise)}</strong>
                    </span>
                  </div>
                )}
                {creditLimitPaise > 0 && (
                  <div className="pt-1 border-t border-slate-800/80">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Available: {formatPaise(availableCreditPaise)}</span>
                      <span className="font-mono">Limit: {formatPaise(creditLimitPaise)}</span>
                    </div>
                    {isCreditExceeded && (
                      <div role="alert" aria-live="assertive" className="mt-1 flex items-center space-x-1 text-[10px] text-rose-400 font-semibold bg-rose-950/40 p-1 rounded border border-rose-500/30">
                        <ShieldAlert className="w-3 h-3 shrink-0" />
                        <span>
                          Exceeds limit by {formatPaise(currentDuesPaise + totals.total_amount_paise - creditLimitPaise)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : customerPhone.trim().length >= 4 ? (
              <div className="mt-1 text-[10px] text-slate-500 flex items-center space-x-1">
                <User className="w-3 h-3 text-slate-600" />
                <span>New customer (Will be auto-enrolled on checkout)</span>
              </div>
            ) : null}
            {/* CF-20: Customer Loyalty Indicator */}
            {customerLoyalty && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2 py-1 rounded">
                <span className="flex items-center gap-1 font-bold">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  Loyalty: {customerLoyalty.tier}
                </span>
                <span className="font-mono font-bold">
                  {customerLoyalty.points_balance} pts (₹{customerLoyalty.points_balance.toFixed(2)})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Real-Time Financial Totals Breakdown */}
        <div className="space-y-1.5 text-xs">
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
              {totals.round_off_paise !== 0 ? (totals.round_off_paise > 0 ? `+${formatPaise(totals.round_off_paise)}` : formatPaise(totals.round_off_paise)) : '₹0.00'}
            </span>
            {/* CF-20: Customer Loyalty Indicator */}
            {customerLoyalty && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2 py-1 rounded">
                <span className="flex items-center gap-1 font-bold">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  Loyalty: {customerLoyalty.tier}
                </span>
                <span className="font-mono font-bold">
                  {customerLoyalty.points_balance} pts (₹{customerLoyalty.points_balance.toFixed(2)})
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pinned Bottom Section: Net Payable Amount / Refund & Action Buttons */}
      <div className="shrink-0 pt-2.5 border-t border-slate-800 space-y-2">
        {/* High-Impact Total Amount Box (Adapts to Refund vs Exchange vs Sale) */}
        <div
          className={`border-2 rounded-xl p-2.5 sm:p-3 shadow-inner ${
            totals.total_amount_paise < 0
              ? 'bg-rose-950/40 border-rose-500/50'
              : totals.total_amount_paise === 0 && itemCount > 0
              ? 'bg-blue-950/40 border-blue-500/50'
              : 'bg-slate-950 border-emerald-500/40'
          }`}
        >
          <div
            className={`text-[11px] font-bold uppercase tracking-wider mb-0.5 ${
              totals.total_amount_paise < 0
                ? 'text-rose-400'
                : totals.total_amount_paise === 0 && itemCount > 0
                ? 'text-blue-400'
                : 'text-emerald-400'
            }`}
          >
            {totals.total_amount_paise < 0
              ? 'Refund Due to Customer'
              : totals.total_amount_paise === 0 && itemCount > 0
              ? 'Even Exchange (No Due)'
              : 'Net Payable Amount'}
          </div>
          <div
            className={`text-2xl sm:text-3xl font-black font-mono tracking-tight flex items-baseline ${
              totals.total_amount_paise < 0 ? 'text-rose-300' : 'text-white'
            }`}
          >
            {totals.total_amount_paise < 0
              ? `Refund: ${formatPaise(Math.abs(totals.total_amount_paise))}`
              : totals.total_amount_paise === 0 && itemCount > 0
              ? '₹0.00'
              : formatPaise(totals.total_amount_paise)}
            {/* CF-20: Customer Loyalty Indicator */}
            {customerLoyalty && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2 py-1 rounded">
                <span className="flex items-center gap-1 font-bold">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  Loyalty: {customerLoyalty.tier}
                </span>
                <span className="font-mono font-bold">
                  {customerLoyalty.points_balance} pts (₹{customerLoyalty.points_balance.toFixed(2)})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-1.5">
          {/* F4 Pay & Settle / Process Refund */}
          <button
            type="button"
            onClick={onOpenPayment}
            disabled={itemCount === 0}
            className={`w-full py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-between transition-all focus-ring ${
              itemCount === 0
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : totals.total_amount_paise < 0
                ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-lg shadow-rose-600/30 cursor-pointer'
                : totals.total_amount_paise === 0
                ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg shadow-blue-600/30 cursor-pointer'
                : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 cursor-pointer'
            }`}
            aria-label={`${
              totals.total_amount_paise < 0
                ? 'Process Refund'
                : totals.total_amount_paise === 0
                ? 'Complete Exchange'
                : 'Pay and Settle'
            }, total ${formatPaise(Math.abs(totals.total_amount_paise))} (Hotkey F4)`}
          >
            <div className="flex items-center space-x-2">
              {totals.total_amount_paise < 0 ? (
                <RotateCcw className="w-4 h-4" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              <span>
                {totals.total_amount_paise < 0
                  ? `Process Refund (${formatPaise(Math.abs(totals.total_amount_paise))})`
                  : totals.total_amount_paise === 0
                  ? 'Complete Exchange (₹0.00)'
                  : 'Pay & Settle'}
              </span>
            </div>
            <kbd
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                totals.total_amount_paise < 0
                  ? 'bg-rose-700/80 text-rose-100'
                  : totals.total_amount_paise === 0
                  ? 'bg-blue-700/80 text-blue-100'
                  : 'bg-emerald-700/80 text-emerald-100'
              }`}
            >
              F4
            </kbd>
          </button>

          {/* Alt+S Save & Print Thermal Slip */}
          <button
            type="button"
            onClick={onSaveAndPrintSlip}
            disabled={itemCount === 0}
            className={`w-full py-1.5 px-3 rounded-xl font-semibold text-xs flex items-center justify-between transition-all focus-ring ${
              itemCount > 0
                ? 'bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 cursor-pointer'
                : 'bg-slate-800/40 text-slate-600 border border-slate-800 cursor-not-allowed'
            }`}
            aria-label="Save and Print Thermal Slip (Hotkey Alt+S)"
          >
            <div className="flex items-center space-x-2">
              <Printer className="w-4 h-4 text-indigo-400" />
              <span>Save & Print Slip</span>
            </div>
            <kbd className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded">
              Alt+S
            </kbd>
          </button>

          {/* Cash Drawer & Shift Settlement Alt+Z */}
          {onOpenShift && (
            <button
              type="button"
              onClick={onOpenShift}
              className="w-full py-1.5 px-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-xs flex items-center justify-between transition-colors cursor-pointer focus-ring"
              title="Open Cash Drawer Shift Settlement & Z-Report (Alt+Z)"
              aria-label="Open Cash Drawer Shift Settlement and Z-Report (Hotkey Alt+Z)"
            >
              <div className="flex items-center space-x-1.5">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>Shift & Drawer (Z-Report)</span>
              </div>
              <kbd className="bg-slate-900 border border-slate-800 text-amber-400/80 text-[10px] px-1.5 py-0.5 rounded">
                Alt+Z
              </kbd>
            </button>
          )}

          {/* Hold & Recall Parked Bills (F6 / F7) */}
          {(onHoldBill || onRecallBills) && (
            <div className="grid grid-cols-2 gap-1.5">
              {onHoldBill && (
                <button
                  type="button"
                  onClick={onHoldBill}
                  disabled={itemCount === 0}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors focus-ring ${
                    itemCount > 0
                      ? 'bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 text-amber-300 cursor-pointer'
                      : 'bg-slate-800/30 text-slate-500 border border-slate-800/50 cursor-not-allowed'
                  }`}
                  title="Suspend / Park active cart for later resumption (F6)"
                  aria-label="Hold and park current cart (Hotkey F6)"
                >
                  <div className="flex items-center space-x-1">
                    <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Hold Bill</span>
                  </div>
                  <kbd className="bg-slate-900 border border-slate-800 text-slate-400 text-[9px] px-1 rounded">
                    F6
                  </kbd>
                </button>
              )}

              {onRecallBills && (
                <button
                  type="button"
                  onClick={onRecallBills}
                  className={`py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer focus-ring ${
                    heldBillsCount > 0
                      ? 'bg-purple-950/60 hover:bg-purple-900/60 border border-purple-700/70 text-purple-200'
                      : 'bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-slate-300'
                  }`}
                  title="Recall suspended carts (F7)"
                  aria-label={`Recall parked bills, ${heldBillsCount} held (Hotkey F7)`}
                >
                  <div className="flex items-center space-x-1">
                    <PlayCircle className="w-3.5 h-3.5 text-purple-400" />
                    <span>Recall {heldBillsCount > 0 ? `(${heldBillsCount})` : ''}</span>
                  </div>
                  <kbd className="bg-slate-900 border border-slate-800 text-slate-400 text-[9px] px-1 rounded">
                    F7
                  </kbd>
                </button>
              )}
            </div>
          )}

          {/* Clear Cart Esc */}
          <button
            type="button"
            onClick={onClearCart}
            disabled={itemCount === 0}
            className="w-full py-1 px-3 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/20 text-xs flex items-center justify-between transition-colors focus-ring"
            aria-label="Clear active cart (Hotkey Escape)"
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
    </div>
  );
};
