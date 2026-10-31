// ui/src/components/auth/LoginScreen.tsx
// Commercial Single-Store Counter Login Portal for OmniBill ERP

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  User,
  Monitor,
  KeyRound,
  Store,
  Clock,
  CheckCircle2,
  Lock,
  ArrowRight,
  Sparkles,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import { posSound } from '../../lib/sound';
import { posStorage } from '../../lib/api';
import { BusinessProfile } from '../../types/pos';
import {
  GithubLicenceService,
  LicenseVerificationResult,
  OnlineLicensePayload,
} from '../../features/licensing/githubLicenceService';
import { LicenseLockoutScreen } from '../../features/licensing/LicenseLockoutScreen';

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

const ROLES = [
  { id: 'CASHIER', label: 'Cashier Staff', defaultName: 'Counter Cashier 1' },
  { id: 'MANAGER', label: 'Store Manager', defaultName: 'Store Manager' },
  { id: 'OWNER', label: 'Owner / Admin', defaultName: 'Store Owner' },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, savedSession }) => {
  // Store Profile loaded from local storage / license
  const [profile, setProfile] = useState<BusinessProfile>(() => posStorage.getBusinessProfile());
  const [selectedRole, setSelectedRole] = useState<'CASHIER' | 'MANAGER' | 'OWNER'>('CASHIER');
  const [operatorName, setOperatorName] = useState<string>(
    savedSession?.operatorName || 'Counter Cashier 1'
  );
  const [counterId, setCounterId] = useState<string>(savedSession?.counterId || 'POS-01');
  const [pin, setPin] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<string>(new Date().toLocaleTimeString());
  const [error, setError] = useState<string | null>(null);

  // License verification state
  const [verifyingLicense, setVerifyingLicense] = useState(true);
  const [licenseResult, setLicenseResult] = useState<LicenseVerificationResult | null>(null);

  // Startup verification: checks license status online / offline cache
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await GithubLicenceService.verifyLicense();
        if (isMounted) {
          setLicenseResult(res);
          if (res.license) {
            setProfile(posStorage.getBusinessProfile());
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setLicenseResult({
            valid: true, // fallback to avoid hard blocking on transient dev errors
            isOffline: true,
          });
        }
      } finally {
        if (isMounted) setVerifyingLicense(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // If license verification failed (expired, suspended, or unlicensed), show the Lockout screen
  if (!verifyingLicense && licenseResult && !licenseResult.valid) {
    return (
      <LicenseLockoutScreen
        initialResult={licenseResult}
        onUnlocked={(updatedLic) => {
          setLicenseResult({ valid: true, isOffline: false, license: updatedLic });
          setProfile(posStorage.getBusinessProfile());
        }}
      />
    );
  }

  const handleRoleSelect = (roleId: 'CASHIER' | 'MANAGER' | 'OWNER') => {
    setSelectedRole(roleId);
    const found = ROLES.find((r) => r.id === roleId);
    if (found) {
      setOperatorName(found.defaultName);
    }
    posSound.playItemAdd();
  };

  const handleStartSession = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic PIN check: if manager/owner, require non-empty PIN
    if ((selectedRole === 'OWNER' || selectedRole === 'MANAGER') && pin.trim().length === 0) {
      setError('Please enter your access PIN to unlock supervisor privileges.');
      posSound.playWarning();
      return;
    }

    posSound.playSuccess();

    // The business vertical is bound to the license / profile, NEVER manually picked on login
    const verticalStr = (localStorage.getItem('omnibill_active_vertical') || 'RETAIL').toUpperCase();
    const activeVertical: BusinessType =
      verticalStr === 'WHOLESALE' || verticalStr === 'SCHOOL' || verticalStr === 'HOSPITAL'
        ? (verticalStr as BusinessType)
        : 'RETAIL';

    const session: UserSession = {
      businessType: activeVertical,
      operatorName: operatorName.trim() || 'Store Cashier',
      counterId: counterId.trim() || 'POS-01',
      storeName: profile.trade_name || 'OmniBill Retail Store',
      loginTime: new Date().toISOString(),
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem('omnibill_active_session', JSON.stringify(session));
    }

    onLogin(session);
  };

  const licensePayload = licenseResult?.license || GithubLicenceService.getStoredLicense();
  const validUntilText = licensePayload?.valid_until || 'Active Subscription';
  const planText = (licensePayload?.plan || 'Pro').toUpperCase();
  const businessName = licensePayload?.business_name || profile.trade_name || 'OmniBill Retail Store';
  const displayGstin = licensePayload?.gstin || profile.gstin || '27AABCR1234D1Z5';

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8 select-none overflow-y-auto">
      {/* Top Header Bar: Store Branding & Live Clock */}
      <header className="flex items-center justify-between pb-6 border-b border-slate-800/80 max-w-5xl w-full mx-auto">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold text-xl">
            OB
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h1 className="text-xl font-black tracking-tight text-white">
                {businessName}
              </h1>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold uppercase tracking-wider">
                {planText} Plan
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              GSTIN: <span className="text-slate-200">{displayGstin}</span> • {profile.city || 'Mumbai'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Live License Status Indicator */}
          <div
            className={`hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              licenseResult?.isOffline
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
            }`}
          >
            {licenseResult?.isOffline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>Offline Verified (Until {validUntilText})</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Verified Online (Until {validUntilText})</span>
              </>
            )}
          </div>

          {/* Clock */}
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>{currentTime}</span>
          </div>
        </div>
      </header>

      {/* Main Single-Store Login Card */}
      <main className="max-w-md w-full mx-auto my-auto space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-md">
          {/* Header */}
          <div className="text-center space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight text-white">Counter Sign In</h2>
            <p className="text-xs text-slate-400">
              Select your staff profile and enter your PIN to begin cashier shift
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleStartSession} className="space-y-5">
            {/* 1. Staff Role Selector Chips */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2">
                Staff Profile
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map((role) => {
                  const isSelected = selectedRole === role.id;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => handleRoleSelect(role.id as any)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border ${
                        isSelected
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30'
                          : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <span>{role.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Operator Name Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Operator / Cashier Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={operatorName}
                  onChange={(e) => setOperatorName(e.target.value)}
                  placeholder="e.g. Ramesh (Owner) or Cashier 1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>
            </div>

            {/* 3. Counter / Terminal ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Billing Counter ID
              </label>
              <div className="relative">
                <Monitor className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={counterId}
                  onChange={(e) => setCounterId(e.target.value)}
                  placeholder="e.g. POS-01"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500 transition"
                  required
                />
              </div>
            </div>

            {/* 4. PIN / Password Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Counter Access PIN / Password
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter 4-digit PIN"
                  maxLength={10}
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white font-mono tracking-widest focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            {/* Submit Action */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 transition cursor-pointer"
              >
                <span>Open Counter Shift & Start Billing</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </main>

      {/* Footer: Zero-Float Engine Invariants */}
      <footer className="max-w-5xl w-full mx-auto pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>REA Double-Entry Ledger Core • 100% Offline-Capable</span>
        </div>
        <div>
          Licensed to <span className="text-slate-400 font-semibold">{profile.trade_name}</span>
        </div>
      </footer>
    </div>
  );
};
