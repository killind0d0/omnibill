import React, { useState, useEffect, useRef } from 'react';
import { CreditCard, Banknote, QrCode, Split, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { PaymentDetails, PaymentMode } from '../../types/pos';
import { formatPaise, parseRupeesToPaise } from '../../lib/tax';
import { buildUpiString, generateQrDataUrl } from '../../lib/upi';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalAmountPaise: number;
  invoiceNumber: string;
  upiVpa: string;
  businessName: string;
  onCompletePayment: (payment: PaymentDetails) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  totalAmountPaise,
  invoiceNumber,
  upiVpa,
  businessName,
  onCompletePayment,
}) => {
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [tenderedStr, setTenderedStr] = useState<string>('');
  const [upiQrUrl, setUpiQrUrl] = useState<string>('');
  const tenderedInputRef = useRef<HTMLInputElement>(null);

  const totalRupees = totalAmountPaise / 100;

  useEffect(() => {
    if (isOpen) {
      setTenderedStr(totalRupees.toString());
      setTimeout(() => {
        tenderedInputRef.current?.select();
      }, 50);

      // Generate UPI QR for instant screen display
      const upiUrl = buildUpiString({
        vpa: upiVpa || 'omnimart@icici',
        payeeName: businessName,
        amountPaise: totalAmountPaise,
        invoiceNumber,
      });
      generateQrDataUrl(upiUrl, { width: 160 }).then(setUpiQrUrl);
    }
  }, [isOpen, totalRupees, totalAmountPaise, upiVpa, businessName, invoiceNumber]);

  const tenderedPaise = parseRupeesToPaise(tenderedStr);
  const changeDuePaise = Math.max(0, tenderedPaise - totalAmountPaise);
  const isUnderTendered = mode === 'CASH' && tenderedPaise < totalAmountPaise;

  const handleConfirm = () => {
    if (isUnderTendered) {
      return;
    }
    const payment: PaymentDetails = {
      mode,
      amount_tendered_paise: mode === 'CASH' ? tenderedPaise : totalAmountPaise,
      change_due_paise: mode === 'CASH' ? changeDuePaise : 0,
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
            <div className="text-xs text-slate-400 uppercase font-semibold">Total Net Amount</div>
            <div className="text-3xl font-black font-mono text-emerald-400">
              {formatPaise(totalAmountPaise)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 font-mono">Invoice Reference</div>
            <div className="text-sm font-bold font-mono text-slate-300">{invoiceNumber}</div>
          </div>
        </div>

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

            {/* Quick Note Presets */}
            <div className="flex flex-wrap gap-1.5 select-none pt-1">
              <button
                type="button"
                onClick={() => handleSetTendered(totalRupees)}
                className="px-2.5 py-1 bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 rounded text-xs font-semibold hover:bg-emerald-900/60 transition-colors"
              >
                Exact (₹{totalRupees.toFixed(0)})
              </button>
              {[100, 200, 500, 1000, 2000].map((amt) => {
                if (amt < totalRupees && totalRupees > 500 && amt < 500) return null;
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleSetTendered(amt)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-mono transition-colors"
                  >
                    ₹{amt}
                  </button>
                );
              })}
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
              <div className="text-xs text-rose-400 font-semibold bg-rose-950/40 p-2 rounded-lg border border-rose-500/30 flex items-center justify-between">
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
