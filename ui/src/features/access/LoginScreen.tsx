// ui/src/features/access/LoginScreen.tsx
// Commercial Single-Store Login Portal for OmniBill ERP

import React, { useState } from 'react';
import {
  Lock,
  User,
  ShieldCheck,
  Zap,
  ArrowRight,
  Store,
  Clock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiLogin } from './clientApi';
import { AuthenticatedUser } from './types';
import { posStorage } from '../../lib/api';
import { DatabaseBackupModal } from '../../components/common/DatabaseBackupModal';
import {
  GithubLicenceService,
  LicenseVerificationResult,
} from '../licensing/githubLicenceService';
import { LicenseLockoutScreen } from '../licensing/LicenseLockoutScreen';

interface LoginScreenProps {
  onLoginSuccess: (token: string, user: AuthenticatedUser) => void;
  onOpenOwnerReset: () => void;
  onOpenActivation?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onOpenOwnerReset,
  onOpenActivation,
}) => {
  const profile = posStorage.getBusinessProfile();
  const [username, setUsername] = useState('cashier1');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<'OWNER' | 'MANAGER' | 'CASHIER'>('CASHIER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [licenseResult, setLicenseResult] = useState<LicenseVerificationResult | null>(null);

  // Check license on startup
  React.useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await GithubLicenceService.verifyLicense();
        if (isMounted) setLicenseResult(res);
      } catch {
        if (isMounted) setLicenseResult({ valid: true, isOffline: true });
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  if (licenseResult && !licenseResult.valid) {
    return (
      <LicenseLockoutScreen
        initialResult={licenseResult}
        onUnlocked={(lic) => {
          setLicenseResult({ valid: true, isOffline: false, license: lic });
        }}
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const activeVertical = (localStorage.getItem('omnibill_active_vertical') || 'RETAIL').toLowerCase();
      const res = await apiLogin(username.trim(), password, activeVertical);

      // Populate synchronized counter session
      const cashierName =
        selectedRole === 'CASHIER'
          ? 'Counter Cashier 1'
          : selectedRole === 'MANAGER'
          ? 'Store Manager'
          : 'Store Owner';

      const counterSession = {
        operatorRole: selectedRole,
        operatorName: cashierName,
        counterId: selectedRole === 'CASHIER' ? 'POS-01 (Express)' : 'MAIN-01',
        loginTime: new Date().toISOString(),
      };

      if (typeof window !== 'undefined') {
        localStorage.setItem('omnibill_counter_session', JSON.stringify(counterSession));
      }

      onLoginSuccess(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const licensePayload = licenseResult?.license || GithubLicenceService.getStoredLicense();
  const validUntilText = licensePayload?.valid_until || 'Active Subscription';
  const planText = (licensePayload?.plan || 'Pro').toUpperCase();
  const businessName = licensePayload?.business_name || profile.trade_name || 'OmniBill Retail Store';
  const displayGstin = licensePayload?.gstin || profile.gstin || '27AABCR1234D1Z5';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 select-none">
      <div className="sm:mx-auto sm:w-full sm:max-w-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-500/20 text-xl mx-auto">
            OB
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              {businessName}
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              GSTIN: {displayGstin} • {profile.city || 'Counter MAIN-01'}
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{planText} Plan • Verified (Until {validUntilText})</span>
          </div>
        </div>

        {/* Login Form Card */}
        <div className="bg-slate-900 py-6 px-6 shadow-2xl rounded-3xl border border-slate-800 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Staff Role Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Staff Profile
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { role: 'OWNER', label: 'Owner / Admin', desc: 'Full System' },
                  { role: 'MANAGER', label: 'Manager', desc: 'Masters & Logs' },
                  { role: 'CASHIER', label: 'Cashier', desc: 'POS Counter' },
                ].map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => {
                      setSelectedRole(item.role as any);
                      if (item.role === 'CASHIER') {
                        setUsername('cashier1');
                        setPassword('Cashier@OmniBill2026!');
                      } else if (item.role === 'MANAGER') {
                        setUsername('manager');
                        setPassword('Manager@OmniBill2026!');
                      } else {
                        setUsername('admin');
                        setPassword('');
                      }
                      setError(null);
                    }}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      selectedRole === item.role
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30 font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 text-xs'
                    }`}
                  >
                    <div className="text-xs font-bold leading-tight">{item.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Username Input */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Username / Role
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin, manager, or cashier1"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 font-mono transition"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Password / Counter PIN
                </label>
                <button
                  type="button"
                  onClick={onOpenOwnerReset}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-500 pointer-events-none" />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 font-mono tracking-wider transition"
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-rose-300 bg-rose-950/60 p-2.5 rounded-xl border border-rose-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <span>{loading ? 'Authenticating...' : 'Sign In to Counter'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Footer actions */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
            <button
              type="button"
              onClick={() => setIsBackupModalOpen(true)}
              className="hover:text-slate-300 transition"
            >
              Backup Hub
            </button>
            <a
              href="./admin/"
              className="hover:text-indigo-400 text-indigo-400/80 transition"
              title="Open Super Admin Management Portal"
            >
              ⚙️ Super Admin Portal
            </a>
            {onOpenActivation && (
              <button
                type="button"
                onClick={onOpenActivation}
                className="hover:text-emerald-400 transition"
              >
                License Key
              </button>
            )}
          </div>
        </div>
      </div>

      <DatabaseBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />
    </div>
  );
};
