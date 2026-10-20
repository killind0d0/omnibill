import React, { useState, useEffect } from 'react';
import {
  Zap,
  ShoppingCart,
  Layers,
  Package,
  Users,
  BarChart3,
  HelpCircle,
  Command,
} from 'lucide-react';
import { LightningPOS } from './components/pos/LightningPOS';
import { VerticalBillingApp } from './verticals/VerticalBillingApp';
import { ItemMaster } from './pages/ItemMaster';
import { EntityLedger } from './pages/EntityLedger';
import { ReportsDashboard } from './pages/ReportsDashboard';

export type AppRoute = 'POS' | 'VERTICALS' | 'ITEM_MASTER' | 'ENTITY_LEDGER' | 'REPORTS';

export const App: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('POS');
  const [showNavHelp, setShowNavHelp] = useState(false);

  // Global Keyboard Shortcuts for Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F8: POS Invoicing
      if (e.key === 'F8') {
        e.preventDefault();
        setCurrentRoute('POS');
      }
      // F10: Item Master
      else if (e.key === 'F10') {
        e.preventDefault();
        setCurrentRoute('ITEM_MASTER');
      }
      // F11: Entity Ledger Statement
      else if (e.key === 'F11') {
        e.preventDefault();
        setCurrentRoute('ENTITY_LEDGER');
      }
      // F12: Reports Dashboard
      else if (e.key === 'F12') {
        e.preventDefault();
        setCurrentRoute('REPORTS');
      }
      // Alt+V: Multi-Vertical Hub
      else if (e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        setCurrentRoute('VERTICALS');
      }
      // Alt+H or ?: Help toggle
      else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setShowNavHelp((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Application Bar & Main Navigation */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between shadow-lg z-20 shrink-0">
        {/* Brand & Identity */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-md shadow-blue-500/20">
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-base font-extrabold tracking-tight text-white">OmniBill</span>
            <span className="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold uppercase tracking-wider">
              ERP Suite
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 space-x-1">
          {/* POS Invoicing */}
          <button
            onClick={() => setCurrentRoute('POS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentRoute === 'POS'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Lightning POS (F8)"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span className="hidden md:inline">POS Invoicing</span>
            <kbd className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${currentRoute === 'POS' ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400'}`}>
              F8
            </kbd>
          </button>

          {/* Industry Verticals */}
          <button
            onClick={() => setCurrentRoute('VERTICALS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentRoute === 'VERTICALS'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Industry Verticals: Retail, Wholesale, School, Hospital (Alt+V)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Industry Verticals</span>
            <kbd className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${currentRoute === 'VERTICALS' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-800 text-slate-400'}`}>
              Alt+V
            </kbd>
          </button>

          {/* Item Master */}
          <button
            onClick={() => setCurrentRoute('ITEM_MASTER')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentRoute === 'ITEM_MASTER'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Item & Inventory Master (F10)"
          >
            <Package className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Item Master</span>
            <kbd className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${currentRoute === 'ITEM_MASTER' ? 'bg-emerald-700 text-emerald-100' : 'bg-slate-800 text-slate-400'}`}>
              F10
            </kbd>
          </button>

          {/* Entity & Ledger */}
          <button
            onClick={() => setCurrentRoute('ENTITY_LEDGER')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentRoute === 'ENTITY_LEDGER'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Entity Directory & Ledger Statement (F11)"
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Entity Ledger</span>
            <kbd className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${currentRoute === 'ENTITY_LEDGER' ? 'bg-purple-700 text-purple-100' : 'bg-slate-800 text-slate-400'}`}>
              F11
            </kbd>
          </button>

          {/* Reports Dashboard */}
          <button
            onClick={() => setCurrentRoute('REPORTS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentRoute === 'REPORTS'
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Audit & Financial Reports Dashboard (F12)"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reports & Audit</span>
            <kbd className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${currentRoute === 'REPORTS' ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-400'}`}>
              F12
            </kbd>
          </button>
        </nav>

        {/* Global Controls & Status */}
        <div className="flex items-center space-x-2">
          <div className="hidden lg:flex items-center space-x-1.5 text-[11px] text-slate-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-mono text-slate-300">GST: 27AABCO1234F1Z5</span>
          </div>

          <button
            onClick={() => setShowNavHelp(!showNavHelp)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Global Navigation Shortcuts (Alt+H)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Navigation Shortcuts Helper Bar (Expandable) */}
      {showNavHelp && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-2 flex items-center justify-between text-xs text-slate-300 select-none animate-in fade-in duration-100">
          <div className="flex items-center space-x-4 flex-wrap">
            <span className="font-bold text-blue-400 flex items-center gap-1">
              <Command className="w-3.5 h-3.5" /> Shortcuts:
            </span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">F8</kbd> POS</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">Alt+V</kbd> Verticals</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">F10</kbd> Item Master</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">F11</kbd> Entity Ledger</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">F12</kbd> Reports</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">F4</kbd> Pay</span>
            <span><kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">Esc</kbd> Close Modal</span>
          </div>
          <button
            onClick={() => setShowNavHelp(false)}
            className="text-slate-400 hover:text-white text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main View Router Outlet */}
      <main className="flex-1 flex overflow-hidden">
        {currentRoute === 'POS' && <LightningPOS />}
        {currentRoute === 'VERTICALS' && (
          <VerticalBillingApp onNavigateHome={() => setCurrentRoute('POS')} />
        )}
        {currentRoute === 'ITEM_MASTER' && <ItemMaster />}
        {currentRoute === 'ENTITY_LEDGER' && <EntityLedger />}
        {currentRoute === 'REPORTS' && <ReportsDashboard />}
      </main>
    </div>
  );
};

export default App;
