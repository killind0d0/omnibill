import React from 'react';
import {
  Zap,
  Calendar,
  CreditCard,
  Printer,
  HelpCircle,
  ShoppingCart,
  Truck,
  Building2,
  Tag,
  PauseCircle,
  PlayCircle,
  Headset,
} from 'lucide-react';
import { BusinessProfile } from '../../types/pos';

interface HeaderProps {
  business: BusinessProfile;
  businessDate: string;
  activeMode: 'SALES' | 'PURCHASES';
  onModeChange: (mode: 'SALES' | 'PURCHASES') => void;
  onOpenHelp: () => void;
  onOpenDateModal: () => void;
  onOpenPayment: () => void;
  onOpenSlip: () => void;
  cartCount: number;
  onPriceCheck?: () => void;
  onHoldBill?: () => void;
  onRecallBills?: () => void;
  heldBillsCount?: number;
  onOpenLiveSupport?: () => void;
  onOpenStoreProfile?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  business,
  businessDate,
  activeMode,
  onModeChange,
  onOpenHelp,
  onOpenDateModal,
  onOpenPayment,
  onOpenSlip,
  cartCount,
  onPriceCheck,
  onHoldBill,
  onRecallBills,
  heldBillsCount = 0,
  onOpenLiveSupport,
  onOpenStoreProfile,
}) => {
  return (
    <header className="h-12 bg-slate-900 border-b border-slate-800 px-3.5 flex items-center justify-between select-none shadow-md shrink-0">
      {/* Brand & Store Name */}
      <div className="flex items-center space-x-2.5">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-md shadow-blue-500/20">
          <Zap className="w-3.5 h-3.5 fill-current" />
        </div>
        <div>
          <button
            type="button"
            onClick={onOpenStoreProfile}
            className="flex items-center space-x-1.5 hover:bg-slate-800/80 px-1.5 py-0.5 rounded cursor-pointer transition text-left"
            title="Click to configure Store Profile & GSTIN Settings"
          >
            <h1 className="text-xs font-bold tracking-tight text-white flex items-center gap-1">
              <span>{business.trade_name || 'OmniBill Store'}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold tracking-wider uppercase">
                POS
              </span>
            </h1>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-400 font-mono text-[10px]">GST: {business.gstin}</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => onModeChange('SALES')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all focus-ring ${
            activeMode === 'SALES'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ShoppingCart className="w-3 h-3" />
          <span>Sales Invoicing</span>
          <kbd className={`text-[10px] px-1 py-0.2 rounded font-mono ${activeMode === 'SALES' ? 'bg-blue-700/80 text-blue-100' : 'bg-slate-800 text-slate-400'}`}>
            F8
          </kbd>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('PURCHASES')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all focus-ring ${
            activeMode === 'PURCHASES'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Truck className="w-3 h-3" />
          <span>Purchases Entry</span>
          <kbd className={`text-[10px] px-1 py-0.2 rounded font-mono ${activeMode === 'PURCHASES' ? 'bg-emerald-700/80 text-emerald-100' : 'bg-slate-800 text-slate-400'}`}>
            F9
          </kbd>
        </button>
      </div>

      {/* Navigation Shortcut Actions */}
      <div className="flex items-center space-x-1.5">
        {/* Price & Stock Check (F5) */}
        {onPriceCheck && (
          <button
            type="button"
            onClick={onPriceCheck}
            aria-label="Price and stock check (F5)"
            className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/60 text-cyan-300 text-xs font-medium transition-colors cursor-pointer focus-ring"
            title="Price & Stock Check (F5)"
          >
            <Tag className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">Price</span>
            <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
              F5
            </kbd>
          </button>
        )}

        {/* Hold Bill (F6) */}
        {onHoldBill && (
          <button
            type="button"
            onClick={onHoldBill}
            disabled={cartCount === 0}
            aria-label="Hold or suspend current bill (F6)"
            className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors focus-ring ${
              cartCount > 0
                ? 'bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 text-amber-300 cursor-pointer'
                : 'bg-slate-800/30 text-slate-500 border border-slate-800 cursor-not-allowed'
            }`}
            title="Hold / Suspend Current Bill (F6)"
          >
            <PauseCircle className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">Hold</span>
            <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
              F6
            </kbd>
          </button>
        )}

        {/* Recall Bills (F7) with Count Badge */}
        {onRecallBills && (
          <button
            type="button"
            onClick={onRecallBills}
            aria-label={`Recall suspended bills (${heldBillsCount} held)`}
            className={`relative flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer focus-ring ${
              heldBillsCount > 0
                ? 'bg-purple-950/60 hover:bg-purple-900/60 border border-purple-700/70 text-purple-200'
                : 'bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 text-slate-300'
            }`}
            title="Recall Suspended / Parked Bills (F7)"
          >
            <PlayCircle className="w-3 h-3 text-purple-400" />
            <span className="hidden sm:inline">Recall</span>
            {heldBillsCount > 0 && (
              <span className="px-1 py-0.2 rounded-full bg-purple-500 text-white font-mono text-[9px] font-bold">
                {heldBillsCount}
              </span>
            )}
            <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
              F7
            </kbd>
          </button>
        )}

        {/* Business Date Pill */}
        <button
          type="button"
          onClick={onOpenDateModal}
          aria-label={`Change business date, currently ${businessDate}`}
          className="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-xs font-medium transition-colors focus-ring"
          title="Change Business Date (F2)"
        >
          <Calendar className="w-3 h-3 text-blue-400" />
          <span className="font-mono text-[11px]">{businessDate}</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
            F2
          </kbd>
        </button>

        {/* Payment Receipt Quick Modal */}
        <button
          type="button"
          onClick={onOpenPayment}
          disabled={cartCount === 0}
          aria-label="Payment settle modal (F4)"
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all focus-ring ${
            cartCount > 0
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 cursor-pointer'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
          title="Payment Receipt Quick Modal (F4)"
        >
          <CreditCard className="w-3 h-3 text-emerald-400" />
          <span>Pay</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
            F4
          </kbd>
        </button>

        {/* Save & Print Slip */}
        <button
          type="button"
          onClick={onOpenSlip}
          disabled={cartCount === 0}
          aria-label="Save and print thermal slip (Alt+S)"
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all focus-ring ${
            cartCount > 0
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 cursor-pointer'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
          title="Save & Print Thermal Slip (Alt+S)"
        >
          <Printer className="w-3 h-3 text-indigo-400" />
          <span>Slip</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
            Alt+S
          </kbd>
        </button>

        {/* Live Support Remote Assistance Button */}
        {onOpenLiveSupport && (
          <button
            type="button"
            onClick={onOpenLiveSupport}
            aria-label="Live Support remote assistance"
            className="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/60 text-sky-300 text-xs font-semibold transition-colors cursor-pointer focus-ring"
            title="Live Remote Assistance (Screen Share with HQ)"
          >
            <Headset className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">Support</span>
          </button>
        )}

        {/* Help / Cheat Sheet */}
        <button
          type="button"
          onClick={onOpenHelp}
          aria-label="Shortcuts Cheat Sheet (F1)"
          className="flex items-center space-x-1 p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-200 text-xs transition-colors focus-ring"
          title="Shortcuts Cheat Sheet (F1)"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded font-mono">
            F1
          </kbd>
        </button>
      </div>
    </header>
  );
};
