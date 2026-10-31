import React, { useState, useEffect } from 'react';
import { apiRequest } from '../utils/api';
import { TenantSummary } from '../types';
import { formatCivilDate, formatTimestamp } from '../utils/format';
import { StatusChip } from '../components/StatusChip';
import { NewBusinessWizardModal } from './NewBusinessWizardModal';
import { GithubSyncService } from '../utils/githubService';

interface TenantsListScreenProps {
  onSelectTenant: (tenantId: string) => void;
}

export const TenantsListScreen: React.FC<TenantsListScreenProps> = ({
  onSelectTenant,
}) => {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const loadTenants = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Try local daemon endpoint
      const data = await apiRequest<TenantSummary[]>('/v1/admin/tenants');
      setTenants(data);
      setIsCloudMode(false);
    } catch {
      // 2. Fall back to GitHub Serverless Registry
      try {
        const ghTenants = await GithubSyncService.listTenants();
        setTenants(ghTenants);
        setIsCloudMode(true);
      } catch (ghErr: any) {
        setError(ghErr.message || 'Failed to fetch businesses from GitHub registry.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const handleDownloadLicenseJson = (e: React.MouseEvent, t: TenantSummary) => {
    e.stopPropagation();
    const cleanKey =
      t.license_key ||
      t.business_name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    const d = new Date(t.valid_until_day * 86400 * 1000);
    const isoDate = d.toISOString().split('T')[0];
    const payload = t.raw_payload || {
      version: 1,
      license_key: cleanKey,
      tenant_id: t.id,
      business_name: t.business_name,
      gstin: t.gstin || '27AABCR1234D1Z5',
      vertical: t.vertical,
      plan: t.plan,
      max_counters: t.max_counters,
      valid_until: isoDate,
      valid_until_day: t.valid_until_day,
      status: t.status,
      support_contact: t.support_contact || '+91 98765 43210 • dev@omnibill.com',
      issued_ms: t.created_ms || Date.now(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleQuickExtend = async (e: React.MouseEvent, t: TenantSummary, days: number) => {
    e.stopPropagation();
    const cleanKey = t.license_key || t.id;
    setActionInProgress(`extend-${t.id}`);
    try {
      const res = await GithubSyncService.extendLicenseValidity(cleanKey, days);
      if (res.ok) {
        setFeedback({
          ok: true,
          message: `Extended ${t.business_name} (+${days} days) until ${res.newDateStr}`,
        });
        await loadTenants();
      } else {
        setFeedback({ ok: false, message: res.message });
      }
    } finally {
      setActionInProgress(null);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const handleToggleSuspend = async (e: React.MouseEvent, t: TenantSummary) => {
    e.stopPropagation();
    const cleanKey = t.license_key || t.id;
    const isCurrentlySuspended = t.status === 'suspended';
    const newStatus = isCurrentlySuspended ? 'active' : 'suspended';

    setActionInProgress(`status-${t.id}`);
    try {
      const res = await GithubSyncService.updateLicenseStatus(cleanKey, newStatus);
      if (res.ok) {
        setFeedback({
          ok: true,
          message: isCurrentlySuspended
            ? `Reactivated ${t.business_name} license.`
            : `Suspended ${t.business_name} license (Counter will lock out).`,
        });
        await loadTenants();
      } else {
        setFeedback({ ok: false, message: res.message });
      }
    } finally {
      setActionInProgress(null);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const handleDelete = async (e: React.MouseEvent, t: TenantSummary) => {
    e.stopPropagation();
    const cleanKey = t.license_key || t.id;
    const confirmed = window.confirm(
      `Are you sure you want to permanently revoke and remove ${t.business_name} (${cleanKey}) from GitHub?`
    );
    if (!confirmed) return;

    setActionInProgress(`del-${t.id}`);
    try {
      const res = await GithubSyncService.deleteLicense(cleanKey);
      if (res.ok) {
        setFeedback({ ok: true, message: res.message });
        await loadTenants();
      } else {
        setFeedback({ ok: false, message: res.message });
      }
    } finally {
      setActionInProgress(null);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      t.business_name.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      (t.license_key && t.license_key.toLowerCase().includes(search.toLowerCase())) ||
      t.vertical.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return t.computed_status === 'active';
    if (statusFilter === 'expiring') return t.computed_status === 'expiring';
    if (statusFilter === 'expired') return t.computed_status === 'expired';
    if (statusFilter === 'suspended') return t.computed_status === 'suspended';
    if (statusFilter === 'not_activated') return t.computed_status === 'not_activated';

    return true;
  });

  const ghRepo = GithubSyncService.getConfig().repo;

  return (
    <div className="space-y-6">
      {/* Top Banner / Cloud Mode Indicator */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-white">Businesses & Licenses</h2>
            <span
              className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                isCloudMode
                  ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
              }`}
            >
              {isCloudMode ? '☁️ Serverless Cloud Mode' : '🟢 Local Control Plane'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Registry:{' '}
            <a
              href={`https://github.com/${ghRepo}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-indigo-400 hover:underline"
            >
              {ghRepo}
            </a>{' '}
            • Free 24/7 global access from any phone or PC
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadTenants}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh businesses list from GitHub"
          >
            <span className={loading ? 'animate-spin' : ''}>🔄</span>
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-lg shadow-lg shadow-emerald-500/10 flex items-center gap-2 transition cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ Provision Business</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            feedback.ok
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white text-xs font-mono"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-950/60 border border-red-800/60 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="w-4 h-4 absolute left-3 top-3 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business name, key, or vertical..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition cursor-pointer"
        >
          <option value="all">All Businesses ({tenants.length})</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring Soon (≤ 7 days)</option>
          <option value="expired">Expired</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 font-medium">Business / Key</th>
                <th className="px-5 py-3.5 font-medium">Vertical</th>
                <th className="px-5 py-3.5 font-medium">Plan</th>
                <th className="px-5 py-3.5 font-medium">Valid Until</th>
                <th className="px-5 py-3.5 font-medium">Status</th>
                <th className="px-5 py-3.5 font-medium">Counters</th>
                <th className="px-5 py-3.5 font-medium text-right">Quick Management</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-500 font-mono text-xs">
                    Loading businesses from GitHub registry...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-500">
                    <div className="text-base font-semibold text-slate-400 mb-1">0 Businesses Found</div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto mb-4">
                      Click &quot;+ Provision Business&quot; to register a shop and immediately publish its license to GitHub!
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsWizardOpen(true)}
                      className="px-3.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border border-emerald-500/40 text-xs font-semibold rounded-lg transition"
                    >
                      + Provision First Business
                    </button>
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTenant(t.id)}
                    className="hover:bg-slate-800/40 cursor-pointer transition group"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-100 group-hover:text-indigo-300 transition">
                        {t.business_name}
                      </div>
                      <div className="font-mono text-xs text-indigo-400 font-bold mt-0.5">
                        Key: {t.license_key || t.id}
                      </div>
                    </td>
                    <td className="px-5 py-4 capitalize text-slate-300">
                      {t.vertical}
                    </td>
                    <td className="px-5 py-4">
                      <span className="capitalize px-2 py-0.5 text-xs font-medium rounded bg-slate-800 border border-slate-700 text-slate-300">
                        {t.plan}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-mono text-slate-200">
                      {formatCivilDate(t.valid_until_day)}
                    </td>
                    <td className="px-5 py-4">
                      <StatusChip
                        status={t.status}
                        valid_until_day={t.valid_until_day}
                        active_devices={t.active_devices}
                        last_checkin_ms={t.last_checkin_ms}
                      />
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-slate-300">
                      {t.max_counters} counter{t.max_counters > 1 ? 's' : ''}
                    </td>
                    <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Quick Extend Validity */}
                        <button
                          type="button"
                          onClick={(e) => handleQuickExtend(e, t, 365)}
                          disabled={actionInProgress === `extend-${t.id}`}
                          className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 rounded border border-emerald-800 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50"
                          title="Extend license validity by 1 Year"
                        >
                          +1 Year
                        </button>

                        {/* Suspend or Reactivate */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleSuspend(e, t)}
                          disabled={actionInProgress === `status-${t.id}`}
                          className={`px-2 py-1 rounded border text-[11px] font-semibold transition cursor-pointer disabled:opacity-50 ${
                            t.status === 'suspended'
                              ? 'bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 border-indigo-800'
                              : 'bg-amber-950/60 hover:bg-amber-900 text-amber-300 border-amber-800'
                          }`}
                          title={t.status === 'suspended' ? 'Reactivate business' : 'Suspend business'}
                        >
                          {t.status === 'suspended' ? 'Resume' : 'Pause'}
                        </button>

                        {/* Download JSON */}
                        <button
                          type="button"
                          onClick={(e) => handleDownloadLicenseJson(e, t)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-[11px] font-medium transition cursor-pointer"
                          title="Download license JSON file"
                        >
                          📥 JSON
                        </button>

                        {/* Revoke / Delete */}
                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, t)}
                          disabled={actionInProgress === `del-${t.id}`}
                          className="px-2 py-1 bg-rose-950/50 hover:bg-rose-900 text-rose-300 rounded border border-rose-800/60 text-[11px] font-semibold transition cursor-pointer disabled:opacity-50"
                          title="Revoke and delete license from GitHub"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewBusinessWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onCreated={loadTenants}
      />
    </div>
  );
};
