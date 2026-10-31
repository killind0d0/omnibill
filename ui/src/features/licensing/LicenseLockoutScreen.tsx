// ui/src/features/licensing/LicenseLockoutScreen.tsx
// Commercial-Grade License Lockout & Activation Screen for OmniBill

import React, { useState } from 'react';
import {
  ShieldAlert,
  KeyRound,
  RefreshCw,
  Phone,
  Mail,
  Copy,
  Check,
  FileCode,
  AlertTriangle,
  Lock,
  ArrowRight,
} from 'lucide-react';
import {
  GithubLicenceService,
  LicenseVerificationResult,
  OnlineLicensePayload,
} from './githubLicenceService';
import { posSound } from '../../lib/sound';

interface LicenseLockoutScreenProps {
  initialResult: LicenseVerificationResult;
  onUnlocked: (license: OnlineLicensePayload) => void;
}

export const LicenseLockoutScreen: React.FC<LicenseLockoutScreenProps> = ({
  initialResult,
  onUnlocked,
}) => {
  const [result, setResult] = useState<LicenseVerificationResult>(initialResult);
  const [inputKey, setInputKey] = useState<string>(
    initialResult.license?.license_key || ''
  );
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const isExpired = result.reason === 'expired';
  const isSuspended = result.reason === 'suspended';
  const isUnlicensed = result.reason === 'unlicensed' || result.reason === 'not_found';

  const supportContact =
    result.supportContact ||
    result.license?.support_contact ||
    '+91 98765 43210 • dev@omnibill.com';

  const handleVerify = async (keyToTest?: string) => {
    const k = (keyToTest || inputKey).trim().toUpperCase();
    if (!k) {
      setStatusMessage('Please enter a valid license key.');
      return;
    }

    setLoading(true);
    setStatusMessage('Checking license registry on GitHub...');

    try {
      const res = await GithubLicenceService.verifyLicense(k);
      setResult(res);

      if (res.valid && res.license) {
        posSound.playSuccess();
        setStatusMessage('License successfully verified! Unlocking counter...');
        setTimeout(() => {
          onUnlocked(res.license!);
        }, 600);
      } else {
        posSound.playWarning();
        setStatusMessage(res.message || 'Verification failed. License not active.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Error checking license status.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySupport = () => {
    navigator.clipboard.writeText(supportContact);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [showConfig, setShowConfig] = useState(false);
  const [registryUrl, setRegistryUrl] = useState(() => GithubLicenceService.getRegistryBaseUrl());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        
        const fileResult = GithubLicenceService.validateAndApplyPayload(parsed);
        setResult(fileResult);

        if (fileResult.valid && fileResult.license) {
          setInputKey(fileResult.license.license_key);
          posSound.playSuccess();
          setStatusMessage(`Valid license activated for "${fileResult.license.business_name}"! Unlocking counter...`);
          setTimeout(() => {
            onUnlocked(fileResult.license!);
          }, 600);
        } else {
          posSound.playWarning();
          setStatusMessage(fileResult.message || 'Verification failed. License expired or invalid.');
        }
      } catch {
        posSound.playWarning();
        setStatusMessage('Could not parse license file. File must be valid JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handleSaveRegistryUrl = () => {
    GithubLicenceService.setRegistryBaseUrl(registryUrl);
    setShowConfig(false);
    setStatusMessage('Updated GitHub Registry endpoint.');
  };

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 md:p-8 select-none">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 relative overflow-hidden backdrop-blur-md">
        {/* Glow accent */}
        <div
          className={`absolute -top-24 -right-24 w-48 h-48 rounded-full blur-3xl opacity-20 pointer-events-none ${
            isExpired || isSuspended ? 'bg-rose-500' : 'bg-blue-500'
          }`}
        />

        {/* Header Icon & Title */}
        <div className="text-center space-y-3">
          <div
            className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border shadow-xl ${
              isExpired || isSuspended
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
            }`}
          >
            {isExpired || isSuspended ? (
              <ShieldAlert className="w-8 h-8" />
            ) : (
              <KeyRound className="w-8 h-8" />
            )}
          </div>

          <div>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${
                isExpired || isSuspended
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
              }`}
            >
              {isExpired
                ? 'Subscription Expired'
                : isSuspended
                ? 'Account Suspended'
                : 'License Required'}
            </span>
            <h1 className="text-2xl font-black tracking-tight text-white mt-2">
              {result.license?.business_name || 'OmniBill ERP Counter'}
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              {isExpired
                ? `Your counter subscription expired on ${
                    result.license?.valid_until || 'the scheduled date'
                  }. Billing operations are paused until renewed.`
                : isSuspended
                ? 'This counter terminal has been paused by the administrator. Contact developer to resume.'
                : 'Please activate this terminal with your developer license key to begin billing.'}
            </p>
          </div>
        </div>

        {/* Developer Contact Card */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <span className="text-xs font-semibold text-slate-400">
              Developer Support & License Renewal:
            </span>
            <button
              onClick={handleCopySupport}
              type="button"
              className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Contact</span>
                </>
              )}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-200 font-mono font-bold">
              <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{supportContact}</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Send payment confirmation via WhatsApp or Call to immediately reactivate this counter.
          </p>
        </div>

        {/* License Key Input & Auto-Check */}
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-300">
            License Key Code
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value.toUpperCase())}
              placeholder="e.g. RAMESH-KIRANA or OB-2027-PRO"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white font-mono uppercase focus:outline-none focus:border-blue-500 transition"
              disabled={loading}
            />
            <button
              onClick={() => handleVerify()}
              disabled={loading || !inputKey.trim()}
              type="button"
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-600/20 flex items-center gap-2 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Verifying...' : 'Check Online'}</span>
            </button>
          </div>

          {statusMessage && (
            <p
              className={`text-xs p-3 rounded-xl border ${
                result.valid
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                  : 'bg-rose-950/40 text-rose-300 border-rose-500/30'
              }`}
            >
              {statusMessage}
            </p>
          )}
        </div>

        {/* Alternative: Offline Key File Drop */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <FileCode className="w-4 h-4 text-slate-500" />
            <span>Have an offline key file?</span>
          </div>
          <label className="text-blue-400 hover:text-blue-300 cursor-pointer font-semibold underline">
            Import license.json
            <input
              type="file"
              accept=".key,.lic,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Developer Advanced Configuration Toggle */}
        <div className="pt-2 border-t border-slate-800/40 text-[11px] text-slate-500 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="hover:text-slate-400 underline transition cursor-pointer"
          >
            {showConfig ? 'Hide GitHub Registry Config' : 'Configure GitHub Repository'}
          </button>

          <a
            href="./admin/"
            className="text-indigo-400 hover:text-indigo-300 font-medium transition"
          >
            ⚙️ Super Admin Portal →
          </a>
        </div>

        {showConfig && (
          <div className="mt-2.5 p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <label className="block text-slate-400 font-mono text-[10px]">
              Raw GitHub Base URL:
            </label>
            <input
              type="text"
              value={registryUrl}
              onChange={(e) => setRegistryUrl(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveRegistryUrl}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
              >
                Save URL
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
