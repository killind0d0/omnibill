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
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const loadTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<TenantSummary[]>('/v1/admin/tenants');
      setTenants(data);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch tenants');
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
    const cleanKey = t.business_name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const d = new Date(t.valid_until_day * 86400 * 1000);
    const isoDate = d.toISOString().split('T')[0];
    const payload = {
      version: 1,
      license_key: cleanKey,
      tenant_id: t.id,
      business_name: t.business_name,
      gstin: '27AABCR1234D1Z5',
      vertical: t.vertical,
      plan: t.plan,
      max_counters: t.max_counters,
      valid_until: isoDate,
      valid_until_day: t.valid_until_day,
      status: t.status,
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

  const handlePushToGithub = async (e: React.MouseEvent, t: TenantSummary) => {
    e.stopPropagation();
    const cleanKey = t.business_name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const d = new Date(t.valid_until_day * 86400 * 1000);
    const isoDate = d.toISOString().split('T')[0];
    const payload = {
      version: 1,
      license_key: cleanKey,
      tenant_id: t.id,
      business_name: t.business_name,
      gstin: '27AABCR1234D1Z5',
      vertical: t.vertical,
      plan: t.plan,
      max_counters: t.max_counters,
      valid_until: isoDate,
      valid_until_day: t.valid_until_day,
      status: t.status,
      support_contact: '+91 98765 43210 • dev@omnibill.com',
      issued_ms: Date.now(),
    };

    setSyncingId(t.id);
    setSyncFeedback(null);
    try {
      const res = await GithubSyncService.pushLicense(cleanKey, payload);
      if (res.ok) {
        setSyncFeedback(`✅ Published licenses/${cleanKey}.json to GitHub!`);
      } else {
        setSyncFeedback(`❌ ${res.message}`);
      }
    } finally {
      setSyncingId(null);
      setTimeout(() => setSyncFeedback(null), 6000);
    }
  };

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      t.business_name.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase()) ||
      t.vertical.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return t.computed_status === 'active';
    if (statusFilter === 'expiring') return t.computed_status === 'expiring';
    if (statusFilter === 'expired') return t.computed_status === 'expired';
    if (statusFilter === 'suspended') return t.computed_status === 'suspended';
    if (statusFilter === 'not_activated') return t.computed_status === 'not_activated';
    if (statusFilter === 'no_checkin') return t.computed_status === 'no_checkin_3d';

    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white">Tenants & Devices</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Active businesses, licensed verticals, counter quotas, and compliance status
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsWizardOpen(true)}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-lg shadow-lg shadow-emerald-500/10 flex items-center gap-2 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Provision Business</span>
        </button>
      </div>

      {syncFeedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold ${
            syncFeedback.startsWith('✅')
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
          }`}
        >
          {syncFeedback}
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
            placeholder="Search by business name, tenant ID, or vertical..."
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-emerald-500 transition"
        >
          <option value="all">All Statuses ({tenants.length})</option>
          <option value="active">Active</option>
          <option value="expiring">Expiring (≤ 7 days)</option>
          <option value="expired">Expired</option>
          <option value="suspended">Suspended</option>
          <option value="not_activated">Not activated</option>
          <option value="no_checkin">No check-in (3+ days)</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 font-medium">Business / Tenant</th>
                <th className="px-5 py-3.5 font-medium">Vertical</th>
                <th className="px-5 py-3.5 font-medium">Plan</th>
                <th className="px-5 py-3.5 font-medium">Valid Until</th>
                <th className="px-5 py-3.5 font-medium">Status</th>
                <th className="px-5 py-3.5 font-medium">Counters</th>
                <th className="px-5 py-3.5 font-medium">Last Check-in</th>
                <th className="px-5 py-3.5 font-medium text-right">License JSON</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                    Loading tenants database...
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-slate-500">
                    No tenants match your search criteria.
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => onSelectTenant(t.id)}
                    className="hover:bg-slate-800/40 cursor-pointer transition"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-100">{t.business_name}</div>
                      <div className="font-mono text-xs text-slate-500 mt-0.5">{t.id}</div>
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
                      {/* counters_paired + 1 / max_counters */}
                      {t.active_devices} / {t.max_counters}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-400 font-mono">
                      {formatTimestamp(t.last_checkin_ms)}
                    </td>
                    <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => handlePushToGithub(e, t)}
                          disabled={syncingId === t.id}
                          className="px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg border border-indigo-500/40 text-xs font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title={`Commit & push ${t.business_name} license directly to GitHub`}
                        >
                          <span>{syncingId === t.id ? 'Pushing...' : '🚀 GitHub'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDownloadLicenseJson(e, t)}
                          className="px-2.5 py-1 bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white rounded-lg border border-blue-500/40 text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                          title={`Download ${t.business_name} license.json for GitHub or offline activation`}
                        >
                          <span>📥 JSON</span>
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
