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
  Sun,
  Moon,
  Coins,
  TrendingUp,
  PackagePlus,
  Headset,
  Database,
} from 'lucide-react';
import { DatabaseBackupModal } from './components/common/DatabaseBackupModal';
import { StoreProfileModal } from './components/common/StoreProfileModal';
import { ErpStorageService } from './lib/erpStorage';
import { LightningPOS } from './components/pos/LightningPOS';
import { VerticalBillingApp } from './verticals/VerticalBillingApp';
import { ItemMaster } from './pages/ItemMaster';
import { GoodsReceipt } from './pages/GoodsReceipt';
import { EntityLedger } from './pages/EntityLedger';
import { ReportsDashboard } from './pages/ReportsDashboard';
import { LoginScreen, UserSession, BusinessType } from './components/auth/LoginScreen';
import { ShiftSettlementModal } from './components/pos/ShiftSettlementModal';
import { posSound } from './lib/sound';
import { DiscoveryPage } from './features/discovery/DiscoveryPage';
import { SellGraphPage } from './features/sellgraph/SellGraphPage';
import { discoveryStore } from './features/discovery/store';
import { AlertsPanel } from './features/alerts/AlertsPanel';
import { AlertsBellButton } from './features/alerts/AlertsBellButton';
import { LiveSupportModal } from './features/support/LiveSupportModal';
import { ExpiryBanner, RenewalModal } from './features/licensing';

export type AppRoute =
  | 'POS'
  | 'VERTICALS'
  | 'ITEM_MASTER'
  | 'GOODS_RECEIPT'
  | 'ENTITY_LEDGER'
  | 'REPORTS'
  | 'DISCOVERY'
  | 'SELL_GRAPH';

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

  // Theme State (Daylight vs Midnight)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('omnibill_theme');
      if (stored === 'light' || stored === 'dark') return stored;
    }
    return 'dark';
  });

  // Sync theme to HTML class
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (theme === 'light') {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
      localStorage.setItem('omnibill_theme', theme);
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
    posSound.playItemAdd();
  };

  const [currentRoute, setCurrentRoute] = useState<AppRoute>('POS');
  const [showNavHelp, setShowNavHelp] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(posSound.enabled);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [isLiveSupportOpen, setIsLiveSupportOpen] = useState(false);
  const [isRenewalOpen, setIsRenewalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isStoreProfileOpen, setIsStoreProfileOpen] = useState(false);

  // Sync profile changes across components
  useEffect(() => {
    const handleProfileSync = (e: any) => {
      const updated = e.detail;
      if (updated?.trade_name) {
        setSession((prev) => (prev ? { ...prev, storeName: updated.trade_name } : prev));
      }
    };
    window.addEventListener('omnibill_profile_sync', handleProfileSync);
    return () => window.removeEventListener('omnibill_profile_sync', handleProfileSync);
  }, []);

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

  // Synchronize with shared backend SQLite database across all browsers (Firefox, Chrome, Tauri)
  useEffect(() => {
    ErpStorageService.initSharedSync();

    const handleFocus = () => {
      ErpStorageService.initSharedSync();
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleFocus);
    };
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem('omnibill_active_session');
      localStorage.removeItem('omnibill_access_session');
      localStorage.removeItem('omnibill_active_vertical');
      window.location.reload();
    }
  };

  // Global Keyboard Shortcuts for Navigation (Active only when logged in)
  useEffect(() => {
    if (!session) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select';

      // Retail-specific shortcuts (active only when logged into Retail Supermarket)
      if (session.businessType === 'RETAIL') {
        // F8: POS Invoicing
        if (e.key === 'F8') {
          e.preventDefault();
          setCurrentRoute('POS');
        }
        // F9: Purchases Entry
        else if (e.key === 'F9') {
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
      }

      // Alt+H or ?: Help toggle (when not typing in input)
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setShowNavHelp((prev) => !prev);
      }
      // Alt+L: Lock counter / Switch Business
      else if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        handleLogout();
      }
      // Alt+T: Toggle Daylight / Midnight Mode
      else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        toggleTheme();
      }
      // Alt+Z: Drawer Shift Settlement & Z-Report
      else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsShiftModalOpen(true);
      }
      // Alt+B: Database Backup, Restore & Health
      else if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setIsBackupModalOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, theme]);

  // If no active session, present the clean Business Login & Onboarding Portal
  if (!session) {
    return (
      <LoginScreen
        onLogin={(newSession) => {
          if (typeof window !== 'undefined') {
            localStorage.setItem('omnibill_active_vertical', newSession.businessType);
          }
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
          pillClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        };
      case 'WHOLESALE':
        return {
          label: 'Wholesale B2B',
          icon: Building2,
          pillClass: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        };
      case 'SCHOOL':
        return {
          label: 'School & College',
          icon: GraduationCap,
          pillClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        };
      case 'HOSPITAL':
        return {
          label: 'Hospital & Clinic',
          icon: HeartPulse,
          pillClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        };
    }
  };

  const badgeInfo = getVerticalBadge(session.businessType);
  const BadgeIcon = badgeInfo.icon;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* License Expiry & Grace Period Warning Banner */}
      <ExpiryBanner onOpenRenewal={() => setIsRenewalOpen(true)} />

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

        {/* Navigation Tabs - Strictly Isolated by Business Type */}
        <nav className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/80 space-x-1">
          {session.businessType === 'RETAIL' && (
            <>
              {/* POS Invoicing */}
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

              {/* Goods Receipt Note (GRN) Inward */}
              <button
                onClick={() => setCurrentRoute('GOODS_RECEIPT')}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentRoute === 'GOODS_RECEIPT'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Goods Received Note & Inward Stock Intake"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Inward GRN</span>
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

              {/* Discovery Hub */}
              <button
                onClick={() => setCurrentRoute('DISCOVERY')}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentRoute === 'DISCOVERY'
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Inventory Discovery Hub & Sorting Analytics"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Discovery</span>
              </button>

              {/* Sell Graph */}
              <button
                onClick={() => setCurrentRoute('SELL_GRAPH')}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  currentRoute === 'SELL_GRAPH'
                    ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title="Sell Graph Business Intelligence & Turnover Analysis"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Sell Graph</span>
              </button>
            </>
          )}

          {session.businessType === 'SCHOOL' && (
            <div className="flex items-center space-x-2 px-3 py-1 text-xs">
              <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                <GraduationCap className="w-4 h-4 text-amber-400" />
                <span>School ERP & Student Billing Suite</span>
              </div>
              <span className="text-[11px] text-slate-400 hidden xl:inline">
                • Student Records • Month-Wise Fee Rules • Defaulters Engine • Editable Bill
              </span>
            </div>
          )}

          {session.businessType === 'WHOLESALE' && (
            <div className="flex items-center space-x-2 px-3 py-1 text-xs">
              <div className="flex items-center space-x-1.5 font-bold text-blue-300">
                <Building2 className="w-4 h-4 text-blue-400" />
                <span>Wholesale & B2B Distribution Invoicing</span>
              </div>
            </div>
          )}

          {session.businessType === 'HOSPITAL' && (
            <div className="flex items-center space-x-2 px-3 py-1 text-xs">
              <div className="flex items-center space-x-1.5 font-bold text-rose-300">
                <HeartPulse className="w-4 h-4 text-rose-400" />
                <span>Hospital & Clinical Billing Suite</span>
              </div>
            </div>
          )}
        </nav>

        {/* Global Controls: Shift Settlement, Daylight Theme, Sound, Shortcuts, Switch Store */}
        <div className="flex items-center space-x-2">
          {/* Shift Drawer Settlement Button */}
          <button
            onClick={() => setIsShiftModalOpen(true)}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-semibold transition cursor-pointer"
            title="Cash Drawer Shift Settlement & Z-Report (Alt+Z)"
          >
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden lg:inline">Shift / Drawer</span>
          </button>

          {/* 1-Click Database Safety & Backup Hub */}
          <button
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-semibold transition cursor-pointer"
            title="Database Backup, Restore & Health (Alt+B)"
          >
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden lg:inline">Backup & DB</span>
          </button>

          {/* Store Profile & GSTIN Settings */}
          <button
            onClick={() => setIsStoreProfileOpen(true)}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition cursor-pointer"
            title="Configure Store Profile, Name & GSTIN"
          >
            <Store className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline">Store Setup</span>
          </button>

          {/* Risk & Inventory Alerts Bell Button */}
          <AlertsBellButton onClick={() => setIsAlertsOpen(true)} />

          {/* 1-Click Live Support Remote Assistance Button */}
          <button
            type="button"
            onClick={() => setIsLiveSupportOpen(true)}
            aria-label="Open OmniBill Live Remote Assistance"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            title="OmniBill Live Remote Assistance (Screen Share with HQ)"
          >
            <Headset className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
            <span className="hidden xl:inline">Live Support</span>
          </button>

          {/* Daylight / Midnight Mode Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              theme === 'light'
                ? 'Switch to Midnight Dark Mode (Alt+T)'
                : 'Switch to Daylight High-Contrast Mode (Alt+T)'
            }
            className={`p-1.5 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              theme === 'light'
                ? 'bg-amber-500/20 text-amber-600 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title={
              theme === 'light'
                ? 'Switch to Midnight Dark Mode (Alt+T)'
                : 'Switch to Daylight High-Contrast Mode (Alt+T)'
            }
          >
            {theme === 'light' ? (
              <Moon className="w-4 h-4 text-amber-500" aria-hidden="true" />
            ) : (
              <Sun className="w-4 h-4 text-yellow-400" aria-hidden="true" />
            )}
          </button>

          {/* POS Sound Toggle */}
          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? 'Mute POS audio beeps' : 'Enable POS audio beeps'}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              soundEnabled
                ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
            }`}
            title={soundEnabled ? 'Mute POS Audio Beeps' : 'Enable POS Audio Beeps'}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          {/* Keyboard Shortcuts Hint */}
          <button
            type="button"
            onClick={() => setShowNavHelp(!showNavHelp)}
            aria-label="Toggle navigation keyboard shortcuts helper bar"
            aria-expanded={showNavHelp}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="Global Navigation Shortcuts (Alt+H)"
          >
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Switch Store / Lock Counter */}
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Lock Counter and Switch Business Type"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-300 text-xs font-semibold transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            title="Lock Counter & Switch Business Type (Alt+L)"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xl:inline">Switch Store</span>
          </button>
        </div>
      </header>

      {/* Navigation Shortcuts Helper Bar (Expandable) */}
      {/* Navigation Shortcuts Helper Bar (Expandable) */}
      {showNavHelp && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-2 flex items-center justify-between text-xs text-slate-300 select-none animate-in fade-in duration-100 shrink-0">
          <div className="flex items-center space-x-4 flex-wrap">
            <span className="font-bold text-blue-400 flex items-center gap-1">
              <Command className="w-3.5 h-3.5" /> Hotkeys:
            </span>
            {session.businessType === 'RETAIL' && (
              <>
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                    F8
                  </kbd>{' '}
                  POS
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
              </>
            )}
            {session.businessType === 'SCHOOL' && (
              <span className="text-amber-300 font-medium">
                🎓 School ERP Mode (Class × Month Fee Engine • 2-Way Auto-Fill • Editable Final Bill • Defaulters & Reports)
              </span>
            )}
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                Alt+Z
              </kbd>{' '}
              Shift Settlement
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-slate-950 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">
                Alt+T
              </kbd>{' '}
              Daylight Theme
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
      <main className="flex-1 flex overflow-hidden min-h-0 relative">
        {session.businessType !== 'RETAIL' ? (
          <div className="h-full w-full flex-1 flex overflow-hidden min-h-0">
            <VerticalBillingApp
              initialVertical={session.businessType}
              lockedVertical={session.businessType}
              hideHeader={true}
            />
          </div>
        ) : (
          <>
            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'POS' ? '' : 'hidden'
              }`}
            >
              <LightningPOS />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'ITEM_MASTER' ? '' : 'hidden'
              }`}
            >
              <ItemMaster />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'GOODS_RECEIPT' ? '' : 'hidden'
              }`}
            >
              <GoodsReceipt />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'ENTITY_LEDGER' ? '' : 'hidden'
              }`}
            >
              <EntityLedger />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'REPORTS' ? '' : 'hidden'
              }`}
            >
              <ReportsDashboard />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'DISCOVERY' ? '' : 'hidden'
              }`}
            >
              <DiscoveryPage
                vertical={session.businessType.toLowerCase()}
                onNavigateSellGraph={() => setCurrentRoute('SELL_GRAPH')}
              />
            </div>

            <div
              className={`h-full w-full flex-1 flex overflow-hidden min-h-0 ${
                currentRoute === 'SELL_GRAPH' ? '' : 'hidden'
              }`}
            >
              <SellGraphPage
                vertical={session.businessType.toLowerCase()}
                onNavigateDiscovery={(productId) => {
                  if (productId) {
                    discoveryStore.setFilter({ text: productId });
                  }
                  setCurrentRoute('DISCOVERY');
                }}
              />
            </div>
          </>
        )}
      </main>

      {/* Cash Drawer Shift Settlement & Z-Report Modal */}
      <ShiftSettlementModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        operatorName={session.operatorName}
        counterId={session.counterId}
        storeName={session.storeName}
      />

      {/* Inventory & Risk Alerts Panel */}
      <AlertsPanel
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        vertical={session.businessType.toLowerCase()}
        onNavigateToItem={(_id, name) => {
          discoveryStore.setFilter({ text: name });
          setCurrentRoute('DISCOVERY');
        }}
      />

      {/* Live Support Remote Assistance Modal */}
      <LiveSupportModal
        isOpen={isLiveSupportOpen}
        onClose={() => setIsLiveSupportOpen(false)}
      />

      {/* In-App Subscription Renewal Modal */}
      <RenewalModal
        isOpen={isRenewalOpen}
        onClose={() => setIsRenewalOpen(false)}
      />

      {/* 1-Click Database Safety & Backup Hub Modal */}
      <DatabaseBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        activeVertical={session?.businessType || 'RETAIL'}
      />

      {/* Store Profile & GSTIN Settings Modal */}
      <StoreProfileModal
        isOpen={isStoreProfileOpen}
        onClose={() => setIsStoreProfileOpen(false)}
      />
    </div>
  );
};

export default App;
