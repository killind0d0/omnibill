// ui/src/verticals/VerticalBillingApp.tsx
// Multi-Vertical Hub & Top Navigation Application Container

import React, { useState } from 'react';
import {
  Layers,
  History,
  Store,
  Sparkles,
  Printer,
  X,
  CreditCard,
  FileSpreadsheet,
  CheckCircle,
} from 'lucide-react';
import { VerticalMode, PostedTransactionReceipt } from './types';
import { VerticalSwitcher, VERTICALS } from './VerticalSwitcher';
import { RetailPOS } from './RetailPOS';
import { WholesaleBilling } from './WholesaleBilling';
import { SchoolBilling } from './SchoolBilling';
import { HospitalBilling } from './HospitalBilling';
import { VerticalIPCBridge } from './ipc';
import { formatPaise } from '../lib/tax';

interface VerticalBillingAppProps {
  initialVertical?: VerticalMode;
  onNavigateHome?: () => void;
}

export const VerticalBillingApp: React.FC<VerticalBillingAppProps> = ({
  initialVertical = 'RETAIL',
  onNavigateHome,
}) => {
  const [currentVertical, setCurrentVertical] = useState<VerticalMode>(initialVertical);
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyList, setHistoryList] = useState<PostedTransactionReceipt[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<PostedTransactionReceipt | null>(null);

  const activeConfig = VERTICALS.find((v) => v.id === currentVertical) || VERTICALS[0];

  const openHistory = () => {
    const list = VerticalIPCBridge.getTransactionHistory();
    setHistoryList(list);
    setShowHistoryModal(true);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* TOP NAVIGATION BAR WITH MULTI-VERTICAL SWITCHER */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between z-30 select-none shadow-sm">
        {/* Brand & Home Navigation */}
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
            <Store className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-white">OmniBill ERP</span>
              <span className="px-1.5 py-0.2 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded text-[10px] font-mono">
                v2.0
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">Integrated Enterprise Billing Engine</p>
          </div>
        </div>

        {/* MULTI-VERTICAL SWITCHER (CENTER STAGE) */}
        <div className="flex-1 flex justify-center px-4">
          <VerticalSwitcher
            currentVertical={currentVertical}
            onSelectVertical={setCurrentVertical}
          />
        </div>

        {/* Action Controls & Audit History */}
        <div className="flex items-center space-x-2">
          <button
            onClick={openHistory}
            type="button"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold border border-slate-700/80 transition"
            title="View Posted Transactions Ledger"
          >
            <History className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">Ledger Log</span>
          </button>

          <div className="hidden xl:flex items-center space-x-2 pl-2 border-l border-slate-800 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>SQLite Connected</span>
          </div>
        </div>
      </header>

      {/* ACTIVE VERTICAL WORKSPACE - Preserves Cart State Across Verticals */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`h-full w-full ${currentVertical === 'RETAIL' ? '' : 'hidden'}`}>
          <RetailPOS />
        </div>
        <div className={`h-full w-full ${currentVertical === 'WHOLESALE' ? '' : 'hidden'}`}>
          <WholesaleBilling />
        </div>
        <div className={`h-full w-full ${currentVertical === 'SCHOOL' ? '' : 'hidden'}`}>
          <SchoolBilling />
        </div>
        <div className={`h-full w-full ${currentVertical === 'HOSPITAL' ? '' : 'hidden'}`}>
          <HospitalBilling />
        </div>
      </main>

      {/* FOOTER SHORTCUT HELPER STRIP */}
      <footer className="h-7 bg-slate-900/90 border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center space-x-4">
          <span className="font-semibold text-slate-300">Active Vertical: {activeConfig.name}</span>
          <span className="hidden md:inline text-slate-500">•</span>
          <span className="hidden md:inline text-slate-400">{activeConfig.tagline}</span>
        </div>

        <div className="hidden sm:flex items-center space-x-3 font-mono text-[10px]">
          <span><kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300">Alt+1</kbd> Retail</span>
          <span><kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300">Alt+2</kbd> Wholesale</span>
          <span><kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300">Alt+3</kbd> School</span>
          <span><kbd className="bg-slate-800 px-1 py-0.5 rounded text-slate-300">Alt+4</kbd> Hospital</span>
        </div>
      </footer>

      {/* RECENT TRANSACTION LEDGER LOG MODAL */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 w-full max-w-3xl rounded-2xl p-5 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <History className="w-4 h-4 text-cyan-400" />
                <span>Central Transaction History & Reprints</span>
              </h3>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {historyList.length === 0 ? (
                <p className="text-center py-10 text-slate-500 text-xs">
                  No transactions posted yet. Post a sale in any vertical to see receipts recorded here.
                </p>
              ) : (
                historyList.map((rec) => (
                  <div
                    key={rec.transaction_id}
                    className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs hover:border-slate-700 transition"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-cyan-400">{rec.invoice_number}</span>
                        <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[10px] uppercase font-bold text-slate-300">
                          {rec.vertical_mode}
                        </span>
                        <span className="text-[10px] text-slate-500">{rec.invoice_date} {rec.invoice_time}</span>
                      </div>
                      <div className="text-slate-200 font-semibold mt-1">
                        {rec.entity_name} ({rec.entity_type})
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {rec.lines.length} items • Paid via {rec.payment.mode}
                      </div>
                    </div>

                    <div className="text-right flex items-center space-x-3">
                      <div>
                        <div className="text-slate-400 text-[10px]">Net Total</div>
                        <div className="font-mono font-extrabold text-slate-100 text-sm">
                          {formatPaise(rec.totals.total_amount_paise)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
