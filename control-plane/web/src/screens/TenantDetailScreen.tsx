import React, { useState, useEffect } from 'react';
import { TenantSummary, AuditEntry, UsageEntry } from '../types';
import { apiRequest } from '../utils/api';
import {
  formatCivilDate,
  formatTimestamp,
  formatRupees,
  calculateMarkPaidNewExpiry,
  currentIstDay,
} from '../utils/format';
import { StatusChip } from '../components/StatusChip';
import { CopyButton } from '../components/CopyButton';
import { Modal } from '../components/Modal';
import { GithubSyncService } from '../utils/githubService';

interface TenantDetailScreenProps {
  tenantId: string;
  onBack: () => void;
  onStartLiveSupport?: (tenant: TenantSummary) => void;
}

export const TenantDetailScreen: React.FC<TenantDetailScreenProps> = ({
  tenantId,
  onBack,
  onStartLiveSupport,
}) => {
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit configuration state
  const [plan, setPlan] = useState<'basic' | 'pro'>('pro');
  const [maxCounters, setMaxCounters] = useState<number>(3);
  const [offlineDays, setOfflineDays] = useState<number>(3);
  const [notes, setNotes] = useState<string>('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<string | null>(null);

  // Mark Paid modal state
  const [showMarkPaidModal, setShowMarkPaidModal] = useState(false);
  const [markPaidMonths, setMarkPaidMonths] = useState<number>(12);
  const [markPaidAmount, setMarkPaidAmount] = useState<string>('4999.00');
  const [markPaidNote, setMarkPaidNote] = useState<string>('');
  const [markPaidResume, setMarkPaidResume] = useState<boolean>(true);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  // Suspend modal state
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendConfirmText, setSuspendConfirmText] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);

  // Owner Reset modal / secret state
  const [resetTempPassword, setResetTempPassword] = useState<string | null>(null);
  const [isResettingOwner, setIsResettingOwner] = useState(false);

  // Export permit modal state
  const [showPermitModal, setShowPermitModal] = useState(false);
  const [permitHours, setPermitHours] = useState<number>(24);
  const [isIssuingPermit, setIsIssuingPermit] = useState(false);

  // Escrow modal state
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowTotp, setEscrowTotp] = useState('');
  const [escrowBlobB64, setEscrowBlobB64] = useState<string | null>(null);
  const [isFetchingEscrow, setIsFetchingEscrow] = useState(false);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  // Reset devices confirm
  const [showResetDevicesModal, setShowResetDevicesModal] = useState(false);
  const [isResettingDevices, setIsResettingDevices] = useState(false);

  // Audit logs & usage data
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [usageReports, setUsageReports] = useState<UsageEntry[]>([]);

  const loadTenant = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiRequest<TenantSummary>(`/v1/admin/tenants/${tenantId}`);
      setTenant(data);
      setPlan(data.plan === 'basic' ? 'basic' : 'pro');
      setMaxCounters(data.max_counters);
      setOfflineDays(data.offline_days);
      setNotes(data.notes || '');

      // Load audit logs and usage in background
      apiRequest<AuditEntry[]>('/v1/admin/audit')
        .then((logs) => {
          setAuditLogs(logs.filter((l) => l.tenant_id === tenantId));
        })
        .catch(() => {});

      apiRequest<UsageEntry[]>('/v1/admin/usage')
        .then((usage) => {
          setUsageReports(usage.filter((u) => u.tenant_id === tenantId));
        })
        .catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenant();
  }, [tenantId]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigMessage(null);
    try {
      await apiRequest(`/v1/admin/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          plan,
          max_counters: plan === 'basic' ? 1 : maxCounters,
          offline_days: offlineDays,
          notes,
        }),
      });
      setConfigMessage('Configuration updated successfully');
      loadTenant();
    } catch (err: any) {
      setConfigMessage(`Error: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsMarkingPaid(true);
    setMarkPaidError(null);
    try {
      await apiRequest(`/v1/admin/tenants/${tenantId}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify({
          months: markPaidMonths,
          amount_rupees: markPaidAmount,
          note: markPaidNote || undefined,
          resume: markPaidResume,
        }),
      });
      setShowMarkPaidModal(false);
      loadTenant();
    } catch (err: any) {
      setMarkPaidError(err.message || 'Failed to record payment');
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const handleToggleSuspend = async () => {
    if (!tenant) return;
    if (tenant.status === 'suspended') {
      // Resume
      try {
        await apiRequest(`/v1/admin/tenants/${tenantId}/resume`, { method: 'POST' });
        loadTenant();
      } catch (err: any) {
        alert(`Resume error: ${err.message}`);
      }
    } else {
      setShowSuspendModal(true);
    }
  };

  const handleConfirmSuspend = async () => {
    if (!tenant || suspendConfirmText !== tenant.business_name) return;
    setIsSuspending(true);
    try {
      await apiRequest(`/v1/admin/tenants/${tenantId}/suspend`, { method: 'POST' });
      setShowSuspendModal(false);
      setSuspendConfirmText('');
      loadTenant();
    } catch (err: any) {
      alert(`Suspend error: ${err.message}`);
    } finally {
      setIsSuspending(false);
    }
  };

  const handleResetOwnerPassword = async () => {
    if (!confirm('Generate a new temporary owner password for this business? The current owner password will be reset upon client sync.')) {
      return;
    }
    setIsResettingOwner(true);
    try {
      const resp = await apiRequest<{ temp_password: string; reset_token: string }>(
        `/v1/admin/tenants/${tenantId}/reset-owner`,
        { method: 'POST' }
      );
      setResetTempPassword(resp.temp_password || resp.reset_token);
      loadTenant();
    } catch (err: any) {
      alert(`Owner reset error: ${err.message}`);
    } finally {
      setIsResettingOwner(false);
    }
  };

  const handleIssuePermit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsIssuingPermit(true);
    try {
      await apiRequest(`/v1/admin/tenants/${tenantId}/export-permit`, {
        method: 'POST',
        body: JSON.stringify({ hours: permitHours }),
      });
      setShowPermitModal(false);
      loadTenant();
    } catch (err: any) {
      alert(`Export permit error: ${err.message}`);
    } finally {
      setIsIssuingPermit(false);
    }
  };

  const handleFetchEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsFetchingEscrow(true);
    setEscrowError(null);
    try {
      const resp = await apiRequest<{ blob_b64: string }>(
        `/v1/admin/tenants/${tenantId}/escrow`,
        {
          method: 'POST',
          body: JSON.stringify({ totp: escrowTotp }),
        }
      );
      setEscrowBlobB64(resp.blob_b64);
    } catch (err: any) {
      setEscrowError(err.message || 'Failed to download escrow blob. Check 2FA code.');
    } finally {
      setIsFetchingEscrow(false);
    }
  };

  const handleResetDevices = async () => {
    setIsResettingDevices(true);
    try {
      await apiRequest(`/v1/admin/tenants/${tenantId}/reset-devices`, { method: 'POST' });
      setShowResetDevicesModal(false);
      loadTenant();
    } catch (err: any) {
      alert(`Reset devices error: ${err.message}`);
    } finally {
      setIsResettingDevices(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Loading business record...
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
          ← Back to Businesses
        </button>
        <div className="bg-rose-950/50 border border-rose-800 p-4 rounded-lg text-rose-300">
          {error || 'Business not found'}
        </div>
      </div>
    );
  }

  const markPaidPreviewDay = calculateMarkPaidNewExpiry(tenant.valid_until_day, markPaidMonths);
  const nowMs = Date.now();
  const permitActive = tenant.export_permit_until_ms > nowMs;

  const handleDownloadLicenseJson = () => {
    if (!tenant) return;
    const cleanKey = tenant.business_name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const d = new Date(tenant.valid_until_day * 86400 * 1000);
    const isoDate = d.toISOString().split('T')[0];
    const payload = {
      version: 1,
      license_key: cleanKey,
      tenant_id: tenant.id,
      business_name: tenant.business_name,
      gstin: '27AABCR1234D1Z5',
      vertical: tenant.vertical,
      plan: tenant.plan,
      max_counters: tenant.max_counters,
      valid_until: isoDate,
      valid_until_day: tenant.valid_until_day,
      status: tenant.status,
      support_contact: '+91 98765 43210 • dev@omnibill.com',
      issued_ms: Date.now(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [isPushingGithub, setIsPushingGithub] = useState(false);
  const [githubPushMsg, setGithubPushMsg] = useState<{ ok: boolean; text: string; url?: string } | null>(null);

  const handlePushToGithub = async () => {
    if (!tenant) return;
    const cleanKey = tenant.business_name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const d = new Date(tenant.valid_until_day * 86400 * 1000);
    const isoDate = d.toISOString().split('T')[0];
    const payload = {
      version: 1,
      license_key: cleanKey,
      tenant_id: tenant.id,
      business_name: tenant.business_name,
      gstin: '27AABCR1234D1Z5',
      vertical: tenant.vertical,
      plan: tenant.plan,
      max_counters: tenant.max_counters,
      valid_until: isoDate,
      valid_until_day: tenant.valid_until_day,
      status: tenant.status,
      support_contact: '+91 98765 43210 • dev@omnibill.com',
      issued_ms: Date.now(),
    };

    setIsPushingGithub(true);
    setGithubPushMsg(null);
    try {
      const res = await GithubSyncService.pushLicense(cleanKey, payload);
      if (res.ok) {
        setGithubPushMsg({
          ok: true,
          text: `Successfully published to GitHub: licenses/${cleanKey}.json`,
          url: res.fileUrl,
        });
      } else {
        setGithubPushMsg({
          ok: false,
          text: res.message,
        });
      }
    } finally {
      setIsPushingGithub(false);
      setTimeout(() => setGithubPushMsg(null), 8000);
    }
  };

  return (
    <div className="space-y-8">
      {githubPushMsg && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            githubPushMsg.ok
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          <span>{githubPushMsg.text}</span>
          {githubPushMsg.url && (
            <a href={githubPushMsg.url} target="_blank" rel="noreferrer" className="underline font-bold text-white">
              View on GitHub ↗
            </a>
          )}
        </div>
      )}

      {/* Top Breadcrumb & Title */}
      <div>
        <button
          onClick={onBack}
          className="text-sm font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors mb-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Businesses
        </button>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">{tenant.business_name}</h1>
              <StatusChip
                status={tenant.status}
                valid_until_day={tenant.valid_until_day}
                active_devices={tenant.active_devices}
                last_checkin_ms={tenant.last_checkin_ms}
              />
              <span className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {tenant.plan}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-slate-400">
              <span className="font-mono text-xs text-slate-500">{tenant.id}</span>
              <CopyButton text={tenant.id} label="Copy ID" />
              <span className="text-slate-600">•</span>
              <span className="capitalize">{tenant.vertical} vertical</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {onStartLiveSupport && (
              <button
                onClick={() => onStartLiveSupport(tenant)}
                className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <svg className="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 18v-6a9 9 0 0118 0v6M3 18a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v3zm18 0a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h2v3z" />
                </svg>
                <span>Start Live Support</span>
              </button>
            )}
            <button
              onClick={() => {
                setMarkPaidError(null);
                setShowMarkPaidModal(true);
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Mark Paid
            </button>
            <button
              onClick={handleDownloadLicenseJson}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-600/30 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Download client license.json for GitHub or offline import"
            >
              <span>📥 Download License JSON</span>
            </button>
            <button
              onClick={handlePushToGithub}
              disabled={isPushingGithub}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-bold shadow-md shadow-indigo-600/30 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Publish or update this license directly to GitHub repository"
            >
              <span>{isPushingGithub ? 'Pushing to GitHub...' : '🚀 Push to GitHub'}</span>
            </button>
            <button
              onClick={handleToggleSuspend}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                tenant.status === 'suspended'
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'
                  : 'bg-rose-950/60 text-rose-300 border-rose-800 hover:bg-rose-900/60'
              }`}
            >
              {tenant.status === 'suspended' ? 'Resume Business' : 'Suspend'}
            </button>
            <button
              onClick={() => setShowResetDevicesModal(true)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              Reset Devices
            </button>
            <button
              onClick={handleResetOwnerPassword}
              disabled={isResettingOwner}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              {isResettingOwner ? 'Resetting...' : 'Reset Owner Password'}
            </button>
            <button
              onClick={() => setShowPermitModal(true)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors"
            >
              Export Permit
            </button>
            <button
              onClick={() => {
                setEscrowBlobB64(null);
                setEscrowError(null);
                setEscrowTotp('');
                setShowEscrowModal(true);
              }}
              className="px-3 py-2 bg-indigo-950/50 hover:bg-indigo-900/50 text-indigo-300 border border-indigo-800 rounded-lg text-sm font-medium transition-colors"
            >
              Escrow Key
            </button>
          </div>
        </div>
      </div>

      {/* Secret Banner: Reset Owner Password Shown ONCE */}
      {resetTempPassword && (
        <div className="bg-amber-950/40 border border-amber-600/70 p-5 rounded-xl space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                New Owner Temporary Password (Shown Once)
              </div>
              <p className="text-xs text-amber-200/80 mt-1">
                Provide this temporary password to the business owner. It expires in 24 hours and will force a password change upon first login.
              </p>
            </div>
            <button
              onClick={() => setResetTempPassword(null)}
              className="text-xs text-amber-400 hover:text-amber-200 uppercase tracking-wider font-semibold"
            >
              Dismiss
            </button>
          </div>
          <div className="flex items-center gap-3 bg-slate-950/90 p-3 rounded-lg border border-amber-700/50 font-mono text-base text-amber-300 font-bold tracking-wider">
            <span>{resetTempPassword}</span>
            <CopyButton text={resetTempPassword} label="Copy Password" />
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Subscription Expiry</div>
          <div className="mt-2 text-xl font-bold text-white">
            {formatCivilDate(tenant.valid_until_day)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Civil Day #{tenant.valid_until_day}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Counters Quota</div>
          <div className="mt-2 text-xl font-bold text-white">
            {tenant.active_devices} <span className="text-sm font-normal text-slate-400">/ {tenant.max_counters} allowed</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {tenant.plan === 'basic' ? 'Basic plan allows 1 device' : 'Pro tier multi-counter'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Last Check-in</div>
          <div className="mt-2 text-xl font-bold text-white">
            {tenant.last_checkin_ms > 0 ? formatTimestamp(tenant.last_checkin_ms) : 'Never'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Max offline allowance: {tenant.offline_days} days
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">Export Permit</div>
          <div className="mt-2 text-xl font-bold text-white">
            {permitActive ? 'Active' : 'None'}
          </div>
          <div className="text-xs text-slate-500 mt-1 truncate">
            {permitActive ? `Until ${formatTimestamp(tenant.export_permit_until_ms)}` : 'Export disabled on POS'}
          </div>
        </div>
      </div>

      {/* Main Configuration & Details Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-bold text-white mb-4">Edit Business Configuration</h2>
        <form onSubmit={handleSaveConfig} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Plan Tier
              </label>
              <select
                value={plan}
                onChange={(e) => {
                  const p = e.target.value as 'basic' | 'pro';
                  setPlan(p);
                  if (p === 'basic') {
                    setMaxCounters(1);
                  }
                }}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="basic">Basic (Single Device)</option>
                <option value="pro">Pro (Multi-Counter)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Max Allowed Counters (1-50)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxCounters}
                disabled={plan === 'basic'}
                onChange={(e) => setMaxCounters(parseInt(e.target.value || '1', 10))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {plan === 'basic' && (
                <p className="text-xs text-slate-500 mt-1">Basic plan is locked to 1 counter.</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Offline Tolerance (Days 1-14)
              </label>
              <input
                type="number"
                min={1}
                max={14}
                value={offlineDays}
                onChange={(e) => setOfflineDays(parseInt(e.target.value || '3', 10))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
              />
              <p className="text-xs text-slate-500 mt-1">Days POS can issue bills without cloud check-in.</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Internal Admin Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record payment agreements, hardware notes, or support history..."
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="submit"
              disabled={isSavingConfig}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {isSavingConfig ? 'Saving...' : 'Save Configuration'}
            </button>
            {configMessage && (
              <span className={`text-sm ${configMessage.startsWith('Error') ? 'text-rose-400' : 'text-emerald-400'}`}>
                {configMessage}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Usage Telemetry & Bills Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-bold text-white mb-2">Telemetry & Daily Bill Volume</h2>
        <p className="text-xs text-slate-400 mb-6">
          Daily billing volume reports transmitted securely during client check-in (zero customer data retained).
        </p>

        {usageReports.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm border border-slate-800/80 rounded-lg bg-slate-950/40">
            No check-in usage reports logged yet for this business.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Plain SVG Bar Chart */}
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                Recent Daily Bills (Last {Math.min(14, usageReports.length)} Reports)
              </div>
              <div className="h-44 w-full flex items-end gap-2 pt-6 pb-2 px-2 overflow-x-auto">
                {(() => {
                  const sorted = [...usageReports].reverse().slice(-14);
                  const maxBills = Math.max(...sorted.map((u) => u.bills_24h), 1);
                  return sorted.map((u, idx) => {
                    const heightPercent = Math.max(8, Math.round((u.bills_24h / maxBills) * 100));
                    return (
                      <div key={idx} className="flex-1 min-w-[36px] flex flex-col items-center gap-1.5 h-full justify-end group">
                        <div className="text-[10px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          {u.bills_24h}
                        </div>
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className="w-full bg-indigo-600 hover:bg-indigo-500 rounded-t transition-all"
                        />
                        <div className="text-[9px] font-mono text-slate-500 truncate w-full text-center">
                          {u.day ? formatCivilDate(u.day).slice(0, 6) : `#${idx + 1}`}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Usage Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs uppercase bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Civil Day</th>
                    <th className="px-4 py-3">Device ID</th>
                    <th className="px-4 py-3 text-right">Bills 24h</th>
                    <th className="px-4 py-3 text-right">Active Users</th>
                    <th className="px-4 py-3 text-right">Counters Paired</th>
                    <th className="px-4 py-3 text-right">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono text-xs">
                  {usageReports.slice(0, 10).map((r, i) => (
                    <tr key={i} className="hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-sans font-medium text-slate-200">
                        {r.day ? formatCivilDate(r.day) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 truncate max-w-[140px]">{r.device_id}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-white">{r.bills_24h}</td>
                      <td className="px-4 py-2.5 text-right">{r.active_users}</td>
                      <td className="px-4 py-2.5 text-right">{r.counters_paired}</td>
                      <td className="px-4 py-2.5 text-right font-sans text-slate-400">
                        {r.received_ms ? formatTimestamp(r.received_ms) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Tenant Audit Log Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <h2 className="text-lg font-bold text-white mb-2">Audit History for this Business</h2>
        <p className="text-xs text-slate-400 mb-4">
          Append-only cryptographic audit events matching this tenant ID.
        </p>

        {auditLogs.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm border border-slate-800/80 rounded-lg bg-slate-950/40">
            No audit records found for this business.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-950 text-slate-400">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-400">
                      {log.ts_ms ? formatTimestamp(log.ts_ms) : log.created_ms ? formatTimestamp(log.created_ms) : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium text-indigo-400">
                      {log.action || log.event_type}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">
                      {log.admin_id ? `Admin #${log.admin_id}` : 'System'}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">
                      {log.detail || log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Mark Paid */}
      <Modal
        isOpen={showMarkPaidModal}
        onClose={() => setShowMarkPaidModal(false)}
        title="Record Payment & Extend Validity"
      >
        <form onSubmit={handleMarkPaid} className="space-y-4">
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Current Expiration:</span>
              <span className="font-medium text-slate-200">{formatCivilDate(tenant.valid_until_day)}</span>
            </div>
            <div className="flex justify-between text-xs text-indigo-300 font-semibold">
              <span>New Expiration (Preview):</span>
              <span>{formatCivilDate(markPaidPreviewDay)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Months to Extend (1 to 36)
            </label>
            <input
              type="number"
              min={1}
              max={36}
              required
              value={markPaidMonths}
              onChange={(e) => setMarkPaidMonths(parseInt(e.target.value || '1', 10))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Amount in Rupees (₹)
            </label>
            <input
              type="text"
              required
              placeholder="4999.00"
              value={markPaidAmount}
              onChange={(e) => setMarkPaidAmount(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Parsed strictly as integer paise. No floating-point math.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Payment Reference / Note
            </label>
            <input
              type="text"
              placeholder="UPI Ref # or Invoice ID"
              value={markPaidNote}
              onChange={(e) => setMarkPaidNote(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {tenant.status === 'suspended' && (
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="resumeCheck"
                checked={markPaidResume}
                onChange={(e) => setMarkPaidResume(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="resumeCheck" className="text-xs text-slate-300">
                Automatically resume business from suspended status
              </label>
            </div>
          )}

          {markPaidError && (
            <div className="text-xs text-rose-400 bg-rose-950/60 p-2.5 rounded border border-rose-800">
              {markPaidError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowMarkPaidModal(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isMarkingPaid}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isMarkingPaid ? 'Processing...' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Suspend Business Confirmation */}
      <Modal
        isOpen={showSuspendModal}
        onClose={() => {
          setShowSuspendModal(false);
          setSuspendConfirmText('');
        }}
        title="Suspend Business Access"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Suspending will reject POS license checks and block new bill creation after current offline tolerance expires.
          </p>
          <div className="bg-rose-950/40 border border-rose-800/80 p-3.5 rounded-lg text-xs text-rose-300">
            Type <span className="font-bold underline text-white">{tenant.business_name}</span> below to confirm suspension:
          </div>
          <input
            type="text"
            value={suspendConfirmText}
            onChange={(e) => setSuspendConfirmText(e.target.value)}
            placeholder={tenant.business_name}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-rose-500"
          />
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setShowSuspendModal(false);
                setSuspendConfirmText('');
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={suspendConfirmText !== tenant.business_name || isSuspending}
              onClick={handleConfirmSuspend}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSuspending ? 'Suspending...' : 'Confirm Suspension'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Reset Devices Confirmation */}
      <Modal
        isOpen={showResetDevicesModal}
        onClose={() => setShowResetDevicesModal(false)}
        title="Reset All Devices for this Business"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Revoking all devices forces all POS terminals registered to this business to re-activate. Existing un-synced data will require re-pairing.
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowResetDevicesModal(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isResettingDevices}
              onClick={handleResetDevices}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isResettingDevices ? 'Resetting...' : 'Revoke All Devices'}
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Issue Export Permit */}
      <Modal
        isOpen={showPermitModal}
        onClose={() => setShowPermitModal(false)}
        title="Issue Temporary Export Permit"
      >
        <form onSubmit={handleIssuePermit} className="space-y-4">
          <p className="text-sm text-slate-300">
            Permit allows the business owner to export SQLite / accounting data dumps from the client app for a temporary time window.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Validity Window (Hours 1 to 72)
            </label>
            <input
              type="number"
              min={1}
              max={72}
              required
              value={permitHours}
              onChange={(e) => setPermitHours(parseInt(e.target.value || '24', 10))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowPermitModal(false)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isIssuingPermit}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isIssuingPermit ? 'Issuing...' : 'Issue Permit'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: Download Escrow Key */}
      <Modal
        isOpen={showEscrowModal}
        onClose={() => setShowEscrowModal(false)}
        title="Emergency Escrow Key Extraction"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Downloading escrow data requires fresh admin TOTP authentication. Decrypt only offline on an air-gapped machine using the vendor master secret.
          </p>

          {!escrowBlobB64 ? (
            <form onSubmit={handleFetchEscrow} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Admin 6-Digit TOTP Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  placeholder="000000"
                  value={escrowTotp}
                  onChange={(e) => setEscrowTotp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono text-center tracking-widest text-lg focus:outline-none focus:border-indigo-500"
                />
              </div>

              {escrowError && (
                <div className="text-xs text-rose-400 bg-rose-950/60 p-2.5 rounded border border-rose-800">
                  {escrowError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEscrowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={escrowTotp.length !== 6 || isFetchingEscrow}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium disabled:opacity-40"
                >
                  {isFetchingEscrow ? 'Authenticating...' : 'Authorize & Download'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="bg-amber-950/50 border border-amber-800 p-3 rounded-lg text-xs text-amber-300">
                Decrypt offline only using the master key. Never paste into an untrusted environment.
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <textarea
                  readOnly
                  rows={4}
                  value={escrowBlobB64}
                  className="w-full bg-transparent text-slate-300 font-mono text-xs focus:outline-none resize-none"
                />
              </div>
              <div className="flex justify-between items-center pt-2">
                <CopyButton text={escrowBlobB64} label="Copy Base64 Blob" />
                <button
                  onClick={() => setShowEscrowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
