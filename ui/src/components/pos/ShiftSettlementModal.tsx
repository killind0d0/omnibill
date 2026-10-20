// ui/src/components/pos/ShiftSettlementModal.tsx
// Commercial Cash Drawer Shift Settlement & 80mm Z-Report Thermal Slip Generator

import React, { useState, useEffect } from 'react';
import {
  Coins,
  Receipt,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Printer,
  X,
  ArrowRight,
  ShieldCheck,
  Calculator,
  User,
  Monitor,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { shiftManager, ShiftManager, ShiftRecord, ShiftDenominations } from '../../lib/shiftManager';
import { formatPaise, parseRupeesToPaise } from '../../lib/tax';
import { posSound } from '../../lib/sound';

interface ShiftSettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  operatorName: string;
  counterId: string;
  storeName: string;
}

export const ShiftSettlementModal: React.FC<ShiftSettlementModalProps> = ({
  isOpen,
  onClose,
  operatorName,
  counterId,
  storeName,
}) => {
  const [currentShift, setCurrentShift] = useState<ShiftRecord | null>(null);
  const [openingFloatInr, setOpeningFloatInr] = useState<string>('2000');
  const [denoms, setDenoms] = useState<ShiftDenominations>({
    d500: 0,
    d200: 0,
    d100: 0,
    d50: 0,
    d20: 0,
    d10: 0,
    coins_paise: 0,
  });
  const [coinsInr, setCoinsInr] = useState<string>('0');
  const [notes, setNotes] = useState<string>('');
  const [showZReportSlip, setShowZReportSlip] = useState<boolean>(false);
  const [lastClosedShift, setLastClosedShift] = useState<ShiftRecord | null>(null);

  useEffect(() => {
    if (isOpen) {
      const active = shiftManager.getCurrentShift();
      setCurrentShift(active);
      setShowZReportSlip(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle starting a new shift
  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    const floatPaise = parseRupeesToPaise(openingFloatInr || '0');
    const started = shiftManager.openShift(operatorName, counterId, storeName, floatPaise);
    setCurrentShift(started);
    posSound.playSuccess();
  };

  // Update coin input
  const handleCoinsChange = (val: string) => {
    setCoinsInr(val);
    const parsedPaise = parseRupeesToPaise(val || '0');
    setDenoms((prev) => ({ ...prev, coins_paise: parsedPaise }));
  };

  // Calculate actual cash from denominations
  const actualCashPaise = ShiftManager.calculateDenominationTotalPaise({
    ...denoms,
    coins_paise: parseRupeesToPaise(coinsInr || '0'),
  });

  const expectedCashPaise = currentShift ? currentShift.expected_cash_paise : 0;
  const variancePaise = actualCashPaise - expectedCashPaise;

  // Handle closing shift
  const handleCloseShift = () => {
    try {
      const closed = shiftManager.closeShift(
        actualCashPaise,
        { ...denoms, coins_paise: parseRupeesToPaise(coinsInr || '0') },
        notes.trim() || undefined
      );
      setLastClosedShift(closed);
      setCurrentShift(null);
      setShowZReportSlip(true);
      posSound.playSuccess();
    } catch (err: any) {
      alert(`Shift closing error: ${err?.message || 'Could not close shift'}`);
    }
  };

  const handlePrintSlip = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-850 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-500 flex items-center justify-center text-slate-950 shadow-md shadow-amber-500/20">
              <Coins className="w-5 h-5 font-bold" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Cash Drawer & Shift Settlement</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase font-mono font-bold">
                  {currentShift ? `Shift #${currentShift.shift_number} Active` : 'Shift Setup'}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                End-of-day drawer reconciliation and official 80mm Z-Report settlement.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* CASE 1: NO ACTIVE SHIFT - PROMPT OPENING FLOAT */}
          {!currentShift && !showZReportSlip && (
            <form onSubmit={handleOpenShift} className="space-y-6 max-w-md mx-auto text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
                <Coins className="w-8 h-8" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-white">Start Your Cashier Shift</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Enter the opening cash float placed in the physical cash drawer before starting sales.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-left space-y-3">
                <label className="block text-xs font-semibold text-slate-300">
                  Opening Cash Float Amount (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-base font-bold text-slate-500 font-mono">₹</span>
                  <input
                    type="number"
                    step="any"
                    value={openingFloatInr}
                    onChange={(e) => setOpeningFloatInr(e.target.value)}
                    placeholder="2000"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-lg font-bold text-white font-mono focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center space-x-2 pt-1">
                  <span className="text-[11px] text-slate-500">Quick:</span>
                  {['1000', '2000', '5000', '10000'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setOpeningFloatInr(preset)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-mono transition cursor-pointer"
                    >
                      ₹{preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-500 hover:from-amber-500 hover:to-yellow-500 text-slate-950 rounded-xl text-sm font-bold shadow-xl shadow-amber-600/20 flex items-center justify-center space-x-2 transition transform hover:scale-[1.01] cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>Start Shift & Open Cash Drawer</span>
                </button>
              </div>
            </form>
          )}

          {/* CASE 2: SHIFT ACTIVE - RECONCILIATION & DENOMINATIONS */}
          {currentShift && !showZReportSlip && (
            <div className="space-y-6">
              {/* Shift Overview KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
                <div>
                  <div className="text-slate-400">Opening Float</div>
                  <div className="text-sm font-bold text-white font-mono mt-0.5">
                    {formatPaise(currentShift.opening_float_paise)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Cash Inflows</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    +{formatPaise(currentShift.cash_sales_paise)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Cash Paid Out</div>
                  <div className="text-sm font-bold text-rose-400 font-mono mt-0.5">
                    -{formatPaise(currentShift.cash_refunds_paise + currentShift.petty_cash_expenses_paise)}
                  </div>
                </div>
                <div>
                  <div className="text-amber-300 font-semibold">Expected Cash</div>
                  <div className="text-base font-extrabold text-amber-400 font-mono mt-0.5">
                    {formatPaise(currentShift.expected_cash_paise)}
                  </div>
                </div>
              </div>

              {/* Digital & Non-Cash Turnover Summary */}
              <div className="flex items-center justify-between text-xs px-4 py-2.5 bg-slate-850 rounded-xl border border-slate-800/80">
                <div className="flex items-center space-x-4">
                  <span className="text-slate-400">Digital Sales:</span>
                  <span className="font-mono font-bold text-blue-400">
                    UPI: {formatPaise(currentShift.upi_sales_paise)}
                  </span>
                  <span className="font-mono font-bold text-indigo-400">
                    Card: {formatPaise(currentShift.card_sales_paise)}
                  </span>
                </div>
                <div className="text-slate-400">
                  Bills Issued: <span className="text-white font-bold font-mono">{currentShift.total_bills_count}</span>
                </div>
              </div>

              {/* Denomination Counter (Quick Cash Calculator) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <Calculator className="w-4 h-4 text-amber-400" />
                    <span>Physical Cash Denomination Count</span>
                  </h4>
                  <span className="text-[11px] text-slate-400">Enter note counts below</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs">
                  {[
                    { label: '₹500 Notes', key: 'd500', value: denoms.d500, mult: 500 },
                    { label: '₹200 Notes', key: 'd200', value: denoms.d200, mult: 200 },
                    { label: '₹100 Notes', key: 'd100', value: denoms.d100, mult: 100 },
                    { label: '₹50 Notes', key: 'd50', value: denoms.d50, mult: 50 },
                    { label: '₹20 Notes', key: 'd20', value: denoms.d20, mult: 20 },
                    { label: '₹10 Notes', key: 'd10', value: denoms.d10, mult: 10 },
                  ].map((row) => (
                    <div key={row.key} className="bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                        <span>{row.label}</span>
                        <span className="font-bold text-white">₹{row.value * row.mult}</span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={row.value === 0 ? '' : row.value}
                        onChange={(e) => {
                          const count = parseInt(e.target.value) || 0;
                          setDenoms({ ...denoms, [row.key]: count });
                        }}
                        placeholder="0"
                        className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-right text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  ))}

                  {/* Coins & Change */}
                  <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 sm:col-span-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>Loose Coins Total (₹)</span>
                      <span className="font-bold text-white">₹{coinsInr || '0'}</span>
                    </div>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={coinsInr}
                      onChange={(e) => handleCoinsChange(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-right text-xs text-white focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Tally & Live Variance Indicator */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-400">Total Counted Physical Cash:</div>
                  <div className="text-xl font-black text-white font-mono">
                    {formatPaise(actualCashPaise)}
                  </div>
                </div>

                {/* Variance Badge */}
                <div className="text-right">
                  <div className="text-xs text-slate-400">Cash Variance (Over / Short):</div>
                  <div className="mt-0.5">
                    {variancePaise === 0 ? (
                      <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>PERFECT MATCH (₹0.00)</span>
                      </span>
                    ) : variancePaise > 0 ? (
                      <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold font-mono">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span>CASH OVER: +{formatPaise(variancePaise)}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold font-mono">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                        <span>CASH SHORT: {formatPaise(variancePaise)}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Closing Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Cashier Closing Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. ₹50 short due to change rounding or coin shortage"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Close Shift Submit */}
              <div className="pt-2 flex justify-between items-center">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Continue Shift
                </button>

                <button
                  type="button"
                  onClick={handleCloseShift}
                  className="px-6 py-2.5 bg-gradient-to-r from-rose-600 via-amber-600 to-yellow-600 hover:from-rose-500 hover:to-yellow-500 text-white rounded-xl text-xs font-bold shadow-xl shadow-amber-600/30 flex items-center space-x-2 transition transform hover:scale-[1.01] cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                  <span>Close Shift & Generate Z-Report</span>
                </button>
              </div>
            </div>
          )}

          {/* CASE 3: SHIFT CLOSED - 80MM THERMAL Z-REPORT SLIP PREVIEW */}
          {showZReportSlip && lastClosedShift && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Shift #{lastClosedShift.shift_number} Closed Successfully</span>
                </div>
                <p className="text-xs text-slate-400">
                  Official End-of-Day Z-Report Settlement Slip
                </p>
              </div>

              {/* 80mm Thermal Receipt Simulation Card */}
              <div className="max-w-sm mx-auto bg-white text-slate-950 p-5 rounded-lg shadow-2xl font-mono text-xs leading-relaxed border-t-8 border-slate-800 print:shadow-none">
                <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
                  <h3 className="font-black text-sm uppercase tracking-tight">{lastClosedShift.store_name}</h3>
                  <div className="font-bold text-[11px] uppercase tracking-wider text-slate-700">
                    *** END OF DAY Z-REPORT ***
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Shift #{lastClosedShift.shift_number} • Reg: {lastClosedShift.counter_id}
                  </div>
                </div>

                <div className="py-2.5 border-b border-dashed border-slate-300 text-[10px] space-y-1">
                  <div className="flex justify-between">
                    <span>Cashier:</span>
                    <span className="font-bold">{lastClosedShift.operator_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Started:</span>
                    <span>{new Date(lastClosedShift.start_time).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Closed:</span>
                    <span>{lastClosedShift.end_time ? new Date(lastClosedShift.end_time).toLocaleTimeString() : 'NOW'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Invoices:</span>
                    <span className="font-bold">{lastClosedShift.total_bills_count}</span>
                  </div>
                </div>

                {/* Sales Breakdown */}
                <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
                  <div className="flex justify-between font-bold">
                    <span>TOTAL SALES TURNOVER:</span>
                    <span>
                      {formatPaise(
                        lastClosedShift.cash_sales_paise +
                        lastClosedShift.upi_sales_paise +
                        lastClosedShift.card_sales_paise +
                        lastClosedShift.other_sales_paise
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600 pl-2">
                    <span>- Cash Sales:</span>
                    <span>{formatPaise(lastClosedShift.cash_sales_paise)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 pl-2">
                    <span>- UPI Digital:</span>
                    <span>{formatPaise(lastClosedShift.upi_sales_paise)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 pl-2">
                    <span>- Card Payment:</span>
                    <span>{formatPaise(lastClosedShift.card_sales_paise)}</span>
                  </div>
                </div>

                {/* Cash Drawer Reconciliation */}
                <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>(+) Opening Float:</span>
                    <span>{formatPaise(lastClosedShift.opening_float_paise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>(+) Cash Collected:</span>
                    <span>{formatPaise(lastClosedShift.cash_sales_paise)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>(-) Cash Drops/Expenses:</span>
                    <span>-{formatPaise(lastClosedShift.petty_cash_expenses_paise)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
                    <span>EXPECTED IN DRAWER:</span>
                    <span>{formatPaise(lastClosedShift.expected_cash_paise)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>ACTUAL PHYSICAL CASH:</span>
                    <span>{formatPaise(lastClosedShift.actual_cash_paise)}</span>
                  </div>
                  <div className="flex justify-between font-extrabold text-[12px] pt-1">
                    <span>VARIANCE:</span>
                    <span className={lastClosedShift.variance_paise < 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {lastClosedShift.variance_paise >= 0 ? '+' : ''}
                      {formatPaise(lastClosedShift.variance_paise)}
                    </span>
                  </div>
                </div>

                {/* Signatures */}
                <div className="pt-8 pb-2 flex justify-between text-[10px] text-slate-600">
                  <div className="border-t border-slate-400 pt-1 text-center w-24">
                    Cashier Sign
                  </div>
                  <div className="border-t border-slate-400 pt-1 text-center w-24">
                    Manager Sign
                  </div>
                </div>

                <div className="text-center text-[9px] text-slate-400 pt-2 border-t border-dashed border-slate-300">
                  OmniBill ERP • Shift Audit Verified • Offline Immutability
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-center space-x-3">
                <button
                  type="button"
                  onClick={handlePrintSlip}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center space-x-2 transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print 80mm Z-Report Slip</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
