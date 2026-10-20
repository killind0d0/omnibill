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
  LogOut,
  Volume2,
  VolumeX,
  ShoppingBag,
  Building2,
  GraduationCap,
  HeartPulse,
  Store,
} from 'lucide-react';
import { LightningPOS } from './components/pos/LightningPOS';
import { VerticalBillingApp } from './verticals/VerticalBillingApp';
import { ItemMaster } from './pages/ItemMaster';
import { EntityLedger } from './pages/EntityLedger';
import { ReportsDashboard } from './pages/ReportsDashboard';
import { LoginScreen, UserSession, BusinessType } from './components/auth/LoginScreen';
import { posSound } from './lib/sound';

export type AppRoute = 'POS' | 'VERTICALS' | 'ITEM_MASTER' | 'ENTITY_LEDGER' | 'REPORTS';

export const App: React.FC = () => {
  // Session State
  const [session, setSession] = useState<UserSession | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('omnibill_active_session');
        if (stored) {
          return JSON.parse(stored) as UserSession;
        }
      } catch {
        return null;
      }
    }
    return null;
  });

  const [currentRoute, setCurrentRoute] = useState<AppRoute>('POS');
  const [showNavHelp, setShowNavHelp] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(posSound.enabled);

  // Sync route based on business type on initial load or session change
  useEffect(() => {
    if (session) {
      if (session.businessType === 'RETAIL') {
        setCurrentRoute('POS');
      } else {
        // Wholesale, School, Hospital start directly in their customized vertical
        setCurrentRoute('VERTICALS');
      }
    }
  }, [session?.businessType]);

  const toggleSound = () => {
    const nextVal = !soundEnabled;
    posSound.setEnabled(nextVal);
    setSoundEnabled(nextVal);
    if (nextVal) {
      posSound.playItemAdd();
    }
  };

  const handleLogout = () => {
    posSound.playWarning();
    setSession(null);
  };

  // Global Keyboard Shortcuts for Navigation (Active only when logged in)
  useEffect(() => {
    if (!session) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';

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
      // Alt+H or ?: Help toggle (when not typing in input)
      else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setShowNavHelp((prev) => !prev);
      }
      // Alt+L: Lock counter / Switch Business
      else if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session]);

  // If no active session, present the clean Business Login & Onboarding Portal
  if (!session) {
    return (
      <LoginScreen
        onLogin={(newSession) => {
          setSession(newSession);
        }}
        savedSession={session}
      />
    );
  }

  // Visual helper for active vertical icon and theme
  const getVerticalBadge = (type: BusinessType) => {
    switch (type) {
      case 'RETAIL':
        return {
          label: 'Retail Store POS',
          icon: ShoppingBag,
          pillClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        };
      case 'WHOLESALE':
        return {
          label: 'Wholesale B2B',
          icon: Building2,
          pillClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        };
      case 'SCHOOL':
        return {
          label: 'School & College',
          icon: GraduationCap,
          pillClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        };
      case 'HOSPITAL':
        return {
          label: 'Hospital & Clinic',
          icon: HeartPulse,
          pillClass: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        };
    }
  };

  const badgeInfo = getVerticalBadge(session.businessType);
  const BadgeIcon = badgeInfo.icon;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Application Bar & Main Navigation */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-3 md:px-4 flex items-center justify-between shadow-lg z-20 shrink-0">
        {/* Brand & Business Identity */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-md shadow-blue-500/20">
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-extrabold tracking-tight text-white hidden sm:inline">
                {session.storeName || 'OmniBill ERP'}
              </span>
              {/* Business Profile Tag */}
              <div
                className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full border text-[11px] font-bold ${badgeInfo.pillClass}`}
              >
                <BadgeIcon className="w-3 h-3" />
                <span>{badgeInfo.label}</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 hidden md:block">
              👤 {session.operatorName} • Counter: <span className="font-mono text-slate-300">{session.counterId}</span>
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 space-x-1">
          {/* POS Invoicing (Primary for Retail, accessible for all) */}
          <button
            onClick={() => setCurrentRoute('POS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              currentRoute === 'POS'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Lightning POS (F8)"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Quick POS</span>
            <kbd
              className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentRoute === 'POS' ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400'
              }`}
            >
              F8
            </kbd>
          </button>

          {/* Industry Hub & Verticals (Wholesale / School / Hospital) */}
          <button
            onClick={() => setCurrentRoute('VERTICALS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              currentRoute === 'VERTICALS'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Industry Verticals: Retail, Wholesale, School, Hospital (Alt+V)"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {session.businessType === 'RETAIL'
                ? 'Industry Hub'
                : session.businessType === 'WHOLESALE'
                ? 'B2B Invoicing'
                : session.businessType === 'SCHOOL'
                ? 'Fee Collection'
                : 'Clinical Billing'}
            </span>
            <kbd
              className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentRoute === 'VERTICALS'
                  ? 'bg-indigo-700 text-indigo-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              Alt+V
            </kbd>
          </button>

          {/* Item Master */}
          <button
            onClick={() => setCurrentRoute('ITEM_MASTER')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              currentRoute === 'ITEM_MASTER'
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Item & Inventory Master (F10)"
          >
            <Package className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Items</span>
            <kbd
              className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentRoute === 'ITEM_MASTER'
                  ? 'bg-emerald-700 text-emerald-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              F10
            </kbd>
          </button>

          {/* Entity & Ledger */}
          <button
            onClick={() => setCurrentRoute('ENTITY_LEDGER')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              currentRoute === 'ENTITY_LEDGER'
                ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Entity Directory & Ledger Statement (F11)"
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Parties</span>
            <kbd
              className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentRoute === 'ENTITY_LEDGER'
                  ? 'bg-purple-700 text-purple-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              F11
            </kbd>
          </button>

          {/* Reports Dashboard */}
          <button
            onClick={() => setCurrentRoute('REPORTS')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              currentRoute === 'REPORTS'
                ? 'bg-amber-600 text-white shadow-sm shadow-amber-600/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="Audit & Financial Reports Dashboard (F12)"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reports</span>
            <kbd
              className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                currentRoute === 'REPORTS'
                  ? 'bg-amber-700 text-amber-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              F12
            </kbd>
          </button>
        </nav>

        {/* Global Controls: Sound, Shortcuts, Switch Store / Logout */}
        <div className="flex items-center space-x-2">
          {/* POS Sound Toggle */}
          <button
            onClick={toggleSound}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              soundEnabled
                ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
            }`}
            title={soundEnabled ? 'Mute POS Audio Beeps' : 'Enable POS Audio Beeps'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Keyboard Shortcuts Hint */}
          <button
            onClick={() => setShowNavHelp(!showNavHelp)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Global Navigation Shortcuts (Alt+H)"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Switch Store / Lock Counter */}
          <button
            onClick={handleLogout}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-300 text-xs font-semibold transition cursor-pointer"
            title="Lock Counter & Switch Business Type (Alt+L)"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Switch Store</span>
          </button>
        </div>
      </header>

      {/* Navigation Shortcuts Helper Bar (Expandable) */}
      {showNavHelp && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-2 flex items-center justify-between text-xs text-slate-300 select-none animate-in fade-in duration-100">
          <div className="flex items-center space-x-4 flex-wrap">
            <span className="font-bold text-blue-400 flex items-center gap-1">
              <Command className="w-3.5 h-3.5" /> Hotkeys:
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                F8
              </kbd>{' '}
              POS
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                Alt+V
              </kbd>{' '}
              Industry Mode
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                F10
              </kbd>{' '}
              Item Master
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                F11
              </kbd>{' '}
              Entity Ledger
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                F12
              </kbd>{' '}
              Reports
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                Alt+L
              </kbd>{' '}
              Lock Counter
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                Esc
              </kbd>{' '}
              Close Modal
            </span>
          </div>
          <button
            onClick={() => setShowNavHelp(false)}
            className="text-slate-400 hover:text-white text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main View Router Outlet - Preserves State on Tab Switch */}
      <main className="flex-1 flex overflow-hidden relative">
        <div
          className={`h-full w-full flex-1 flex overflow-hidden ${
            currentRoute === 'POS' ? '' : 'hidden'
          }`}
        >
          <LightningPOS />
        </div>

        <div
          className={`h-full w-full flex-1 flex overflow-hidden ${
            currentRoute === 'VERTICALS' ? '' : 'hidden'
          }`}
        >
          <VerticalBillingApp
            initialVertical={session.businessType}
            onNavigateHome={() => setCurrentRoute('POS')}
          />
        </div>

        <div
          className={`h-full w-full flex-1 flex overflow-hidden ${
            currentRoute === 'ITEM_MASTER' ? '' : 'hidden'
          }`}
        >
          <ItemMaster />
        </div>

        <div
          className={`h-full w-full flex-1 flex overflow-hidden ${
            currentRoute === 'ENTITY_LEDGER' ? '' : 'hidden'
          }`}
        >
          <EntityLedger />
        </div>

        <div
          className={`h-full w-full flex-1 flex overflow-hidden ${
            currentRoute === 'REPORTS' ? '' : 'hidden'
          }`}
        >
          <ReportsDashboard />
        </div>
      </main>
    </div>
  );
};

export default App;
