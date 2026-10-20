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
}) => {
  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none shadow-md">
      {/* Brand & Store Name */}
      <div className="flex items-center space-x-3.5">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-500/20">
          <Zap className="w-5 h-5 fill-current" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>OmniBill</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold tracking-wider uppercase">
                Lightning POS
              </span>
            </h1>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Building2 className="w-3 h-3 text-slate-500" />
            <span className="truncate max-w-[220px]" title={business.legal_name}>
              {business.trade_name || business.legal_name}
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-emerald-400 font-mono text-[11px]">GST: {business.gstin}</span>
          </div>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => onModeChange('SALES')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeMode === 'SALES'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>Sales Invoicing</span>
          <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${activeMode === 'SALES' ? 'bg-blue-700/80 text-blue-100' : 'bg-slate-800 text-slate-400'}`}>
            F8
          </kbd>
        </button>

        <button
          onClick={() => onModeChange('PURCHASES')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeMode === 'PURCHASES'
              ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Purchases Entry</span>
          <kbd className={`text-[10px] px-1.5 py-0.5 rounded ${activeMode === 'PURCHASES' ? 'bg-emerald-700/80 text-emerald-100' : 'bg-slate-800 text-slate-400'}`}>
            F9
          </kbd>
        </button>
      </div>

      {/* Navigation Shortcut Actions */}
      <div className="flex items-center space-x-2">
        {/* Business Date Pill */}
        <button
          onClick={onOpenDateModal}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-xs font-medium transition-colors"
          title="Change Business Date (F2)"
        >
          <Calendar className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-mono">{businessDate}</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded">
            F2
          </kbd>
        </button>

        {/* Payment Receipt Quick Modal */}
        <button
          onClick={onOpenPayment}
          disabled={cartCount === 0}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            cartCount > 0
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 cursor-pointer'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
          title="Payment Receipt Quick Modal (F4)"
        >
          <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
          <span>Pay</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded">
            F4
          </kbd>
        </button>

        {/* Save & Print Slip */}
        <button
          onClick={onOpenSlip}
          disabled={cartCount === 0}
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            cartCount > 0
              ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 cursor-pointer'
              : 'bg-slate-800/40 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
          title="Save & Print Thermal Slip (Alt+S)"
        >
          <Printer className="w-3.5 h-3.5 text-indigo-400" />
          <span>Thermal Slip</span>
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded">
            Alt+S
          </kbd>
        </button>

        {/* Help / Cheat Sheet */}
        <button
          onClick={onOpenHelp}
          className="flex items-center space-x-1.5 p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-200 text-xs transition-colors"
          title="Shortcuts Cheat Sheet (F1)"
        >
          <HelpCircle className="w-4 h-4" />
          <kbd className="text-[10px] bg-slate-900 border border-slate-700 text-slate-400 px-1 rounded">
            F1
          </kbd>
        </button>
      </div>
    </header>
  );
};
