import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, Banknote, QrCode, Split, CheckCircle2, Star } from 'lucide-react';
import { Modal } from '../common/Modal';
import { PaymentDetails, PaymentMode } from '../../types/pos';
import { formatPaise, parseRupeesToPaise } from '../../lib/tax';
import { buildUpiString, generateQrDataUrl } from '../../lib/upi';
import { ErpStorageService } from '../../lib/erpStorage';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalAmountPaise: number;
  invoiceNumber: string;
  upiVpa: string;
  businessName: string;
  customerPhone?: string;
  onCompletePayment: (payment: PaymentDetails) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  totalAmountPaise,
  invoiceNumber,
  upiVpa,
  businessName,
  customerPhone,
  onCompletePayment,
}) => {
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [tenderedStr, setTenderedStr] = useState<string>('');
  const [splitCashStr, setSplitCashStr] = useState<string>('');
  const [splitUpiStr, setSplitUpiStr] = useState<string>('');
  const [splitCardStr, setSplitCardStr] = useState<string>('');
  const [splitCreditStr, setSplitCreditStr] = useState<string>('');
  const [upiQrUrl, setUpiQrUrl] = useState<string>('');
  const tenderedInputRef = useRef<HTMLInputElement>(null);

  // Customer Loyalty state
  const [isRedeemingLoyalty, setIsRedeemingLoyalty] = useState<boolean>(false);
  const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);
  const [loyaltyProfile, setLoyaltyProfile] = useState<any>(null);

  const loyaltyDiscountPaise = isRedeemingLoyalty ? pointsToRedeem * 100 : 0;
  const netPayablePaise = Math.max(0, totalAmountPaise - loyaltyDiscountPaise);
  const netPayableRupees = netPayablePaise / 100;

  useEffect(() => {
    if (isOpen) {
      // CF-18: Reset to default CASH mode on every open (avoid sticky split/card state)
      setMode('CASH');

      if (customerPhone && customerPhone.trim().length >= 10) {
        const prof = ErpStorageService.getCustomerLoyalty(customerPhone.trim());
        setLoyaltyProfile(prof);
      } else {
        setLoyaltyProfile(null);
      }
      setIsRedeemingLoyalty(false);
      setPointsToRedeem(0);

      setTenderedStr((totalAmountPaise / 100).toString());
      setSplitCashStr('');
      setSplitUpiStr('');
      setSplitCardStr('');
      setSplitCreditStr('');
      setTimeout(() => {
        tenderedInputRef.current?.select();
      }, 50);

      const upiUrl = buildUpiString({
        vpa: upiVpa || 'omnimart@icici',
        payeeName: businessName,
        amountPaise: totalAmountPaise,
        invoiceNumber,
      });
      generateQrDataUrl(upiUrl, { width: 160 }).then(setUpiQrUrl);
    }
  }, [isOpen, totalAmountPaise, upiVpa, businessName, invoiceNumber, customerPhone]);

  // Recompute UPI QR when loyalty discount is applied
  useEffect(() => {
    if (isOpen) {
      setTenderedStr(netPayableRupees.toString());
      const upiUrl = buildUpiString({
        vpa: upiVpa || 'omnimart@icici',
        payeeName: businessName,
        amountPaise: netPayablePaise,
        invoiceNumber,
      });
      generateQrDataUrl(upiUrl, { width: 160 }).then(setUpiQrUrl);
    }
  }, [netPayablePaise, netPayableRupees, isOpen, upiVpa, businessName, invoiceNumber]);

  const tenderedPaise = parseRupeesToPaise(tenderedStr);
  const changeDuePaise = Math.max(0, tenderedPaise - netPayablePaise);

  // Split amounts (CF-08: includes Udhaar/Customer Credit)
  const splitCashPaise = parseRupeesToPaise(splitCashStr || '0');
  const splitUpiPaise = parseRupeesToPaise(splitUpiStr || '0');
  const splitCardPaise = parseRupeesToPaise(splitCardStr || '0');
  const splitCreditPaise = parseRupeesToPaise(splitCreditStr || '0');
  const totalSplitPaise = splitCashPaise + splitUpiPaise + splitCardPaise + splitCreditPaise;
  const splitRemainingPaise = netPayablePaise - totalSplitPaise;

  const isNetRefund = netPayablePaise < 0;
  const isEvenExchange = netPayablePaise === 0;

  const isUnderTendered =
    isNetRefund || isEvenExchange
      ? false
      : mode === 'CASH'
      ? tenderedPaise < netPayablePaise
      : mode === 'SPLIT'
      ? totalSplitPaise !== netPayablePaise
      : false;

  const handleConfirm = () => {
    if (isUnderTendered) {
      return;
    }

    // CF-20: Always accrue or redeem loyalty points when customer is present
    if (customerPhone && customerPhone.trim().length >= 10) {
      ErpStorageService.processLoyaltyCheckout(
        customerPhone.trim(),
        totalAmountPaise,
        isRedeemingLoyalty ? pointsToRedeem : 0
      );
    }

    const payment: PaymentDetails = {
      mode,
      amount_tendered_paise: isNetRefund
        ? Math.abs(netPayablePaise)
        : isEvenExchange
        ? 0
        : mode === 'CASH'
        ? tenderedPaise
        : netPayablePaise,
      cash_tendered_paise: isNetRefund
        ? 0
        : mode === 'SPLIT'
        ? splitCashPaise
        : mode === 'CASH'
        ? tenderedPaise
        : undefined,
      upi_amount_paise: mode === 'SPLIT' ? splitUpiPaise : mode === 'UPI' ? netPayablePaise : undefined,
      card_amount_paise: mode === 'SPLIT' ? splitCardPaise : mode === 'CARD' ? netPayablePaise : undefined,
      credit_amount_paise: mode === 'SPLIT' ? splitCreditPaise : mode === 'CREDIT' ? netPayablePaise : undefined,
      change_due_paise: isNetRefund ? Math.abs(netPayablePaise) : mode === 'CASH' ? changeDuePaise : 0,
    };
    onCompletePayment(payment);
  };

  const handleSetTendered = (amtRupees: number) => {
    setTenderedStr(amtRupees.toString());
    tenderedInputRef.current?.focus();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Quick Payment Settlement (F4)"
      width="max-w-lg"
      icon={<CreditCard className="w-5 h-5 text-emerald-400" />}
    >
      <div className="space-y-4">
        {/* Payable Header */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">
              {loyaltyDiscountPaise > 0 ? 'Net Payable (Post-Loyalty)' : 'Total Net Amount'}
            </div>
            <div className="text-3xl font-black font-mono text-emerald-400">
              {formatPaise(netPayablePaise)}
            </div>
            {loyaltyDiscountPaise > 0 && (
              <span className="text-[11px] font-mono text-amber-400 block mt-0.5">
                (Original {formatPaise(totalAmountPaise)} − {formatPaise(loyaltyDiscountPaise)} Loyalty Discount)
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 font-mono">Invoice Reference</div>
            <div className="text-sm font-bold font-mono text-slate-300">{invoiceNumber}</div>
          </div>
        </div>

        {/* Customer Loyalty Points Redemption Section */}
        {customerPhone && loyaltyProfile && (
          <div className="bg-amber-950/20 border border-amber-800/40 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                Loyalty: {loyaltyProfile.tier} Member ({loyaltyProfile.points_balance} pts available)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">1 pt = ₹1.00</span>
            </div>

            {loyaltyProfile.points_balance > 0 && (
              <div className="flex items-center justify-between pt-1 border-t border-amber-900/30">
                <label className="text-xs text-slate-300 flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isRedeemingLoyalty}
                    onChange={(e) => {
                      setIsRedeemingLoyalty(e.target.checked);
                      if (e.target.checked) {
                        const maxPts = Math.min(loyaltyProfile.points_balance, Math.floor(totalAmountPaise / 100));
                        setPointsToRedeem(maxPts);
                      } else {
                        setPointsToRedeem(0);
                      }
                    }}
                    className="rounded border-slate-700 text-amber-500 focus:ring-amber-500"
                  />
                  <span>Redeem Points for Bill Discount</span>
                </label>

                {isRedeemingLoyalty && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={Math.min(loyaltyProfile.points_balance, Math.floor(totalAmountPaise / 100))}
                      value={pointsToRedeem}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(loyaltyProfile.points_balance, parseInt(e.target.value) || 0));
                        setPointsToRedeem(val);
                      }}
                      className="w-20 px-2 py-1 bg-slate-900 border border-amber-700/60 rounded text-xs font-mono font-bold text-amber-300 text-right focus:outline-none"
                    />
                    <span className="text-xs font-bold text-emerald-400 font-mono">
                      -₹{pointsToRedeem.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Payment Modes */}
        <div className="grid grid-cols-4 gap-2 select-none">
          <button
            type="button"
            onClick={() => setMode('CASH')}
            className={`py-3 px-2 rounded-xl flex flex-col items-center justify-center space-y-1.5 border font-semibold text-xs transition-all ${
              mode === 'CASH'
                ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500 shadow-md shadow-emerald-500/10'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white'
            }`}
          >
            <Banknote className="w-5 h-5" />
            <span>Cash</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('UPI')}
            className={`py-3 px-2 rounded-xl flex flex-col items-center justify-center space-y-1.5 border font-semibold text-xs transition-all ${
              mode === 'UPI'
                ? 'bg-blue-600/20 text-blue-300 border-blue-500 shadow-md shadow-blue-500/10'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span>UPI QR</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('CARD')}
            className={`py-3 px-2 rounded-xl flex flex-col items-center justify-center space-y-1.5 border font-semibold text-xs transition-all ${
              mode === 'CARD'
                ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500 shadow-md shadow-indigo-500/10'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white'
            }`}
          >
            <CreditCard className="w-5 h-5" />
            <span>Card</span>
          </button>

          <button
            type="button"
            onClick={() => setMode('SPLIT')}
            className={`py-3 px-2 rounded-xl flex flex-col items-center justify-center space-y-1.5 border font-semibold text-xs transition-all ${
              mode === 'SPLIT'
                ? 'bg-purple-600/20 text-purple-300 border-purple-500 shadow-md shadow-purple-500/10'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-white'
            }`}
          >
            <Split className="w-5 h-5" />
            <span>Split Pay</span>
          </button>
        </div>

        {/* Cash Tendered & Change Section */}
        {mode === 'CASH' && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Cash Tendered by Customer (₹)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 font-mono text-base">
                  ₹
                </span>
                <input
                  ref={tenderedInputRef}
                  type="number"
                  step="any"
                  value={tenderedStr}
                  onChange={(e) => setTenderedStr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirm();
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-lg pl-8 pr-4 py-2 font-mono text-xl text-white font-bold"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Quick Note Presets & Denomination Grid (CF-26) */}
            <div className="space-y-1.5 select-none pt-1">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSetTendered(netPayableRupees)}
                  className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 rounded text-xs font-semibold hover:bg-emerald-900/60 transition-colors focus-ring"
                >
                  Exact ({formatPaise(netPayablePaise)})
                </button>
                {[10, 20, 50, 100, 200, 500, 2000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleSetTendered(amt)}
                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition-colors focus-ring"
                  >
                    ₹{amt}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="text-[10px] uppercase font-bold text-slate-500">Add Cash:</span>
                {[10, 20, 50, 100, 500].map((addAmt) => (
                  <button
                    key={'add_' + addAmt}
                    type="button"
                    onClick={() => {
                      const cur = parseRupeesToPaise(tenderedStr || '0');
                      setTenderedStr(((cur + addAmt * 100) / 100).toString());
                    }}
                    className="px-1.5 py-0.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/60 text-slate-300 rounded font-mono text-[10px] transition-colors"
                  >
                    +₹{addAmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Change Due Display */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Change to Return:</span>
              <span
                className={`text-xl font-black font-mono ${
                  changeDuePaise > 0 ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {formatPaise(changeDuePaise)}
              </span>
            </div>

            {isUnderTendered && (
              <div role="alert" className="text-xs text-rose-400 font-semibold bg-rose-950/40 p-2 rounded-lg border border-rose-500/30 flex items-center justify-between">
                <span>⚠️ Cash tendered is insufficient.</span>
                <span className="font-mono">Due: {formatPaise(totalAmountPaise - tenderedPaise)}</span>
              </div>
            )}
          </div>
        )}

        {/* UPI Live Screen QR Section */}
        {mode === 'UPI' && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col items-center text-center space-y-2">
            <div className="text-xs text-slate-300 font-semibold">
              Scan this QR to Pay {formatPaise(totalAmountPaise)}
            </div>
            {upiQrUrl && (
              <div className="p-2 bg-white rounded-lg shadow">
                <img src={upiQrUrl} alt="UPI QR" className="w-36 h-36" />
              </div>
            )}
            <div className="text-xs font-mono text-slate-400">{upiVpa}</div>
          </div>
        )}

        {/* Split Tender Section */}
        {mode === 'SPLIT' && (
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="text-xs text-slate-300 font-semibold flex items-center justify-between border-b border-slate-800 pb-2">
              <span>Allocate Tender Across Payment Modes</span>
              <span className="font-mono text-xs font-bold text-purple-400">
                Total: {formatPaise(totalAmountPaise)}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <span className="w-20 text-xs text-slate-400 font-medium">Cash (₹):</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={splitCashStr}
                  onChange={(e) => setSplitCashStr(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-sm text-white"
                />
              </div>

              <div className="flex items-center space-x-2">
                <span className="w-20 text-xs text-slate-400 font-medium">UPI (₹):</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={splitUpiStr}
                  onChange={(e) => setSplitUpiStr(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-sm text-white"
                />
                {splitRemainingPaise > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseRupeesToPaise(splitUpiStr || '0');
                      setSplitUpiStr(((cur + splitRemainingPaise) / 100).toFixed(2));
                    }}
                    className="px-2 py-1 bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded text-[11px] font-bold cursor-pointer focus-ring"
                  >
                    + Fill {formatPaise(splitRemainingPaise)}
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <span className="w-20 text-xs text-slate-400 font-medium">Card (₹):</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={splitCardStr}
                  onChange={(e) => setSplitCardStr(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-mono text-sm text-white focus-ring"
                />
                {splitRemainingPaise > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseRupeesToPaise(splitCardStr || '0');
                      setSplitCardStr(((cur + splitRemainingPaise) / 100).toFixed(2));
                    }}
                    className="px-2 py-1 bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 rounded text-[11px] font-bold cursor-pointer focus-ring"
                  >
                    + Fill {formatPaise(splitRemainingPaise)}
                  </button>
                )}
              </div>

              {/* CF-08: Kirana Udhaar / Customer Credit Split */}
              <div className="flex items-center space-x-2">
                <span className="w-20 text-xs text-amber-400 font-medium">Udhaar (₹):</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={splitCreditStr}
                  onChange={(e) => setSplitCreditStr(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-slate-900 border border-amber-700/60 rounded-lg px-3 py-1.5 font-mono text-sm text-amber-200 focus-ring"
                />
                {splitRemainingPaise > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const cur = parseRupeesToPaise(splitCreditStr || '0');
                      setSplitCreditStr(((cur + splitRemainingPaise) / 100).toFixed(2));
                    }}
                    className="px-2 py-1 bg-amber-600/20 text-amber-300 border border-amber-500/30 rounded text-[11px] font-bold cursor-pointer focus-ring"
                  >
                    + Udhaar {formatPaise(splitRemainingPaise)}
                  </button>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Allocation Status:</span>
              <span
                className={`font-mono font-bold text-sm ${
                  splitRemainingPaise === 0
                    ? 'text-emerald-400'
                    : splitRemainingPaise > 0
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {splitRemainingPaise === 0 ? '✓ 100% Balanced' : `${formatPaise(Math.abs(splitRemainingPaise))} ${splitRemainingPaise > 0 ? 'Remaining' : 'Excess'}`}
              </span>
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
          >
            Cancel (Esc)
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isUnderTendered}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center space-x-2 shadow-lg transition-all ${
              isUnderTendered
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer shadow-emerald-600/30'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Complete & Print (Enter)</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
