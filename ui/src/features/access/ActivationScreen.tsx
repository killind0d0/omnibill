import React, { useState } from 'react';
import { apiActivateLicence } from './clientApi';
import { ActivateResult } from './types';

interface ActivationScreenProps {
  onActivated: () => void;
  onOpenKeyRecovery: () => void;
}

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  onActivated,
  onOpenKeyRecovery,
}) => {
  const [tenantCode, setTenantCode] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('owner');
  const [tempPassword, setTempPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActivateResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiActivateLicence(tenantCode, ownerUsername, tempPassword);
      if (!res.success) {
        throw new Error(res.error || 'Activation failed');
      }
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Activation failed. Please check credentials and control plane connectivity.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-emerald-500/30 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Business Activated!</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your device is cryptographically licensed and ready for offline billing.
              </p>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-left space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Business Name:</span>
                <span className="font-semibold text-white">{result.business_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Industry Vertical:</span>
                <span className="font-semibold text-indigo-400 uppercase">{result.vertical}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">License Plan:</span>
                <span className="font-semibold text-emerald-400 uppercase">{result.plan}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Device ID:</span>
                <span className="font-mono text-slate-300 truncate max-w-[180px]">{result.device_id}</span>
              </div>
            </div>

            <p className="text-xs text-amber-300/80 bg-amber-950/30 border border-amber-800/40 p-3 rounded-lg">
              Sign in using the temporary owner password. You will be prompted to choose a permanent master password.
            </p>

            <button
              onClick={onActivated}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-600/20 transition-all text-sm"
            >
              Proceed to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20 text-lg">
            OB
          </div>
          <span className="font-bold text-2xl text-white tracking-tight">OmniBill ERP</span>
        </div>

        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-slate-800">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white tracking-tight">Activate Terminal</h2>
            <p className="text-xs text-slate-400 mt-1">
              Enter the activation credentials from your merchant onboarding handover card.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Business Tenant Code / ID
              </label>
              <input
                type="text"
                required
                placeholder="e.g. 7f2b1d30-..."
                value={tenantCode}
                onChange={(e) => setTenantCode(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Primary Owner Username
              </label>
              <input
                type="text"
                required
                value={ownerUsername}
                onChange={(e) => setOwnerUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Initial Temporary Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {error && (
              <div className="text-xs text-rose-300 bg-rose-950/60 p-3 rounded-lg border border-rose-800">
                {error}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-600/20 transition-all text-sm disabled:opacity-50"
              >
                {loading ? 'Activating with Control Plane...' : 'Activate Business License'}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800 text-center">
            <button
              onClick={onOpenKeyRecovery}
              className="text-xs text-slate-400 hover:text-indigo-300 transition-colors"
            >
              Restoring from backup? <span className="underline font-semibold">Import Database Key</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
