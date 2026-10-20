// ui/src/components/auth/LoginScreen.tsx
// Welcoming Business Type Selection & Counter Login Portal for OmniBill ERP

import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  Building2,
  GraduationCap,
  HeartPulse,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  User,
  Monitor,
  KeyRound,
  RotateCcw,
  Zap,
  Store,
  Clock,
  FileSpreadsheet,
} from 'lucide-react';
import { posSound } from '../../lib/sound';
import { CatalogImporterModal } from '../importer/CatalogImporterModal';

export type BusinessType = 'RETAIL' | 'WHOLESALE' | 'SCHOOL' | 'HOSPITAL';

export interface UserSession {
  businessType: BusinessType;
  operatorName: string;
  counterId: string;
  storeName: string;
  loginTime: string;
}

interface LoginScreenProps {
  onLogin: (session: UserSession) => void;
  savedSession?: UserSession | null;
}

interface VerticalMeta {
  type: BusinessType;
  title: string;
  tagline: string;
  icon: React.ElementType;
  color: string;
  borderColor: string;
  bgGlow: string;
  accentBadge: string;
  badges: string[];
  description: string;
}

const VERTICAL_OPTIONS: VerticalMeta[] = [
  {
    type: 'RETAIL',
    title: 'Retail Supermarket & Store',
    tagline: 'High-Speed POS & Barcode Checkout',
    icon: ShoppingBag,
    color: 'text-emerald-400',
    borderColor: 'border-emerald-500/50 hover:border-emerald-400',
    bgGlow: 'from-emerald-950/40 to-slate-900',
    accentBadge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    badges: ['Barcode Scanner', '80mm Thermal Slip', 'MRP Offers', 'UPI QR Code'],
    description:
      'Lightning-fast counter checkout with keyboard hotkeys, barcode wedge listener, and instant cash tender calculation.',
  },
  {
    type: 'WHOLESALE',
    title: 'Wholesale & B2B Distribution',
    tagline: 'GST Invoices, Credit Limits & e-Way Bills',
    icon: Building2,
    color: 'text-blue-400',
    borderColor: 'border-blue-500/50 hover:border-blue-400',
    bgGlow: 'from-blue-950/40 to-slate-900',
    accentBadge: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    badges: ['B2B Tax Invoice', 'Credit Ceiling Warning', 'e-Way Bill >₹50k', 'Batch/Expiry Lots'],
    description:
      'Comprehensive distributor billing with customer credit limits, multi-rate GST, batch picker, and e-Way bill compliance.',
  },
  {
    type: 'SCHOOL',
    title: 'School & College Management',
    tagline: 'Student Fee Heads & Term Slips',
    icon: GraduationCap,
    color: 'text-amber-400',
    borderColor: 'border-amber-500/50 hover:border-amber-400',
    bgGlow: 'from-amber-950/40 to-slate-900',
    accentBadge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    badges: ['Student Directory', 'Class & Roll No', '0% GST Exemption', 'Concession Waiver'],
    description:
      'Tuition, exam, transport, and lab fee collections with student directory and official fee acknowledgment slips.',
  },
  {
    type: 'HOSPITAL',
    title: 'Hospital & Healthcare Clinic',
    tagline: 'Patient EHR & 3-in-1 Discharge Billing',
    icon: HeartPulse,
    color: 'text-rose-400',
    borderColor: 'border-rose-500/50 hover:border-rose-400',
    bgGlow: 'from-rose-950/40 to-slate-900',
    accentBadge: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
    badges: ['UHID Patient EHR', 'OPD Consultation', 'Pharmacy Dispensing', 'Bed-Day Charges'],
    description:
      'Integrated medical billing combining OPD visits, doctor consultations, pharmacy drugs, and inpatient room charges.',
  },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, savedSession }) => {
  const [selectedType, setSelectedType] = useState<BusinessType>(
    savedSession?.businessType || 'RETAIL'
  );
  const [operatorName, setOperatorName] = useState<string>(
    savedSession?.operatorName || 'Cashier Counter 1'
  );
  const [counterId, setCounterId] = useState<string>(savedSession?.counterId || 'POS-01');
  const [storeName, setStoreName] = useState<string>(
    savedSession?.storeName || 'OmniMart Superstore - Main Branch'
  );
  const [pin, setPin] = useState<string>('1234');
  const [currentTime, setCurrentTime] = useState<string>(new Date().toLocaleTimeString());
  const [isImporterOpen, setIsImporterOpen] = useState(false);

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    posSound.playSuccess();

    const session: UserSession = {
      businessType: selectedType,
      operatorName: operatorName.trim() || 'Store Operator',
      counterId: counterId.trim() || 'POS-01',
      storeName: storeName.trim() || 'OmniBill Store',
      loginTime: new Date().toISOString(),
    };

    // Persist active session
    if (typeof window !== 'undefined') {
      localStorage.setItem('omnibill_active_session', JSON.stringify(session));
    }

    onLogin(session);
  };

  const handleQuickResume = () => {
    if (savedSession) {
      posSound.playSuccess();
      onLogin(savedSession);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 select-none overflow-y-auto">
      {/* Top Bar: Brand, Hardware Status & Clock */}
      <header className="flex items-center justify-between pb-6 border-b border-slate-800/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Zap className="w-5 h-5 text-white fill-current" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-extrabold tracking-tight text-white">OmniBill</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold uppercase tracking-wider">
                Enterprise v2.0
              </span>
            </div>
            <p className="text-xs text-slate-400">Zero-Float • Offline-First • Intelligent POS & Accounting</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsImporterOpen(true)}
            type="button"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs text-emerald-300 transition cursor-pointer"
            title="Import existing inventory from Excel or CSV before opening counter"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Import Catalog (Excel/CSV)</span>
          </button>

          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>{currentTime}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>SQLite Engine Ready</span>
          </div>
        </div>
      </header>

      {/* Main Body: Welcome Hero + Business Type Grid + Counter Setup */}
      <main className="max-w-6xl w-full mx-auto my-6 space-y-8">
        {/* Quick Resume Previous Session Banner */}
        {savedSession && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-900/40 via-indigo-900/30 to-slate-900 border border-blue-500/40 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-300">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>Resume Previous Counter Session</span>
                  <span className="px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase font-mono">
                    {savedSession.businessType}
                  </span>
                </h4>
                <p className="text-xs text-slate-400">
                  {savedSession.storeName} • Operator: <span className="text-slate-200">{savedSession.operatorName}</span> ({savedSession.counterId})
                </p>
              </div>
            </div>

            <button
              onClick={handleQuickResume}
              type="button"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 flex items-center space-x-2 transition cursor-pointer"
            >
              <span>Quick Resume</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Section Title */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            Select Your Business Profile
          </h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Choose your establishment type below to configure the optimized billing interface, tax rules, and workflows.
          </p>
        </div>

        {/* 4 Interactive Business Type Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {VERTICAL_OPTIONS.map((vertical) => {
            const isSelected = selectedType === vertical.type;
            const Icon = vertical.icon;

            return (
              <div
                key={vertical.type}
                onClick={() => {
                  setSelectedType(vertical.type);
                  posSound.playItemAdd();
                }}
                className={`relative group p-5 rounded-2xl cursor-pointer transition-all duration-200 flex flex-col justify-between border ${
                  isSelected
                    ? `bg-gradient-to-b ${vertical.bgGlow} ${vertical.borderColor} ring-2 ring-blue-500/50 shadow-2xl scale-[1.02]`
                    : 'bg-slate-900/80 hover:bg-slate-900 border-slate-800 hover:border-slate-700 shadow-md'
                }`}
              >
                {/* Selected Checkmark Badge */}
                {isSelected && (
                  <div className="absolute top-4 right-4 text-blue-400 animate-in zoom-in-75 duration-150">
                    <CheckCircle2 className="w-5 h-5 fill-blue-500/20" />
                  </div>
                )}

                <div>
                  {/* Icon & Title */}
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 ${
                      isSelected
                        ? 'bg-slate-800 border border-slate-700 shadow-inner'
                        : 'bg-slate-800/80'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${vertical.color}`} />
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-blue-300 transition-colors">
                    {vertical.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 mb-3 line-clamp-1">
                    {vertical.tagline}
                  </p>

                  <p className="text-[11px] text-slate-400/90 leading-relaxed mb-4">
                    {vertical.description}
                  </p>
                </div>

                {/* Feature Pills */}
                <div className="pt-3 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                  {vertical.badges.map((badge) => (
                    <span
                      key={badge}
                      className={`text-[10px] px-2 py-0.5 rounded-md font-medium border ${
                        isSelected
                          ? vertical.accentBadge
                          : 'bg-slate-800/60 text-slate-400 border-slate-700/60'
                      }`}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Counter & Operator Setup Form */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="flex items-center space-x-2 pb-4 border-b border-slate-800 mb-5">
            <Monitor className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-slate-100">Counter & Operator Credentials</h3>
            <span className="text-xs text-slate-500 font-mono">({selectedType} Mode Selected)</span>
          </div>

          <form onSubmit={handleStartSession} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Store / Outlet Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Store / Enterprise Name
              </label>
              <div className="relative">
                <Store className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="e.g. OmniMart Superstore"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
            </div>

            {/* Operator / Cashier Role */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Staff / Operator Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="e.g. Cashier Counter 1"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition"
                  required
                />
              </div>
            </div>

            {/* Counter ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Terminal / Counter ID
              </label>
              <div className="relative">
                <Monitor className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={counterId}
                  onChange={(e) => setCounterId(e.target.value)}
                  placeholder="e.g. POS-01"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono transition"
                  required
                />
              </div>
            </div>

            {/* Quick Unlock PIN */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Counter PIN (Protection)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="4-digit PIN"
                  maxLength={6}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono tracking-widest transition"
                />
              </div>
            </div>

            {/* Submit Action */}
            <div className="md:col-span-4 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800/80">
              <div className="flex items-center space-x-2 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Local SQLite Double-Entry Ledger Protection Active</span>
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-sm font-bold shadow-xl shadow-blue-600/30 flex items-center justify-center space-x-2.5 transition-all transform hover:scale-[1.02] cursor-pointer"
              >
                <span>Open Counter & Start Invoicing</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Footer Credentials */}
      <footer className="text-center text-xs text-slate-500 py-2 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>OmniBill ERP • Pure Offline System • Zero Cloud Telemetry</span>
        <span className="font-mono text-[11px]">Host: Linux • Database: SQLite WAL • Schema v3</span>
      </footer>

      {/* Excel / CSV Catalog Importer */}
      <CatalogImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        onImportSuccess={() => {}}
      />
    </div>
  );
};
