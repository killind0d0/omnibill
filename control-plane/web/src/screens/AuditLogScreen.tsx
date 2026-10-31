import React, { useState, useEffect } from 'react';
import { AuditEntry } from '../types';
import { apiRequest } from '../utils/api';
import { formatTimestamp } from '../utils/format';
import { CopyButton } from '../components/CopyButton';
import { GithubSyncService } from '../utils/githubService';

export const AuditLogScreen: React.FC = () => {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCloudMode, setIsCloudMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Verification state
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    verified: boolean;
    message?: string;
    first_bad_id?: number | string;
  } | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');

  const loadLogs = async () => {
    try {
      setLoading(true);
      setError(null);
      // 1. Try local daemon endpoint
      const data = await apiRequest<AuditEntry[]>('/v1/admin/audit');
      setLogs(data);
      setIsCloudMode(false);
    } catch {
      // 2. Fall back to GitHub Git commit history
      try {
        const ghLogs = await GithubSyncService.getAuditLog();
        setLogs(ghLogs);
        setIsCloudMode(true);
      } catch (ghErr: any) {
        setError(ghErr.message || 'Failed to fetch audit log');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    setVerifyResult(null);

    if (isCloudMode) {
      try {
        const res = await GithubSyncService.verifyAuditChain();
        setVerifyResult({
          verified: res.verified,
          message: res.message,
        });
      } catch (err: any) {
        setVerifyResult({
          verified: false,
          message: `Git chain verification failed: ${err.message}`,
        });
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    try {
      const res = await apiRequest<{ verified: boolean; first_bad_id?: number }>(
        '/v1/admin/audit/verify'
      );
      if (res.verified) {
        setVerifyResult({
          verified: true,
          message: 'All sequential SHA-256 block hashes are intact and tamper-free.',
        });
      } else {
        setVerifyResult({
          verified: false,
          first_bad_id: res.first_bad_id,
          message: `Hash mismatch at event entry #${res.first_bad_id}. Database records may have been tampered with.`,
        });
      }
    } catch (err: any) {
      setVerifyResult({
        verified: false,
        message: `Audit verification request failed: ${err.message || 'Network error'}`,
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const filteredLogs = logs.filter((l) => {
    const act = (l.action || l.event_type || '').toLowerCase();
    const ten = (l.tenant_id || '').toLowerCase();
    const matchesAction = !actionFilter || act.includes(actionFilter.toLowerCase());
    const matchesTenant = !tenantFilter || ten.includes(tenantFilter.toLowerCase());
    return matchesAction && matchesTenant;
  });

  const ghRepo = GithubSyncService.getConfig().repo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-white tracking-tight">Audit Log</h1>
            <span
              className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${
                isCloudMode
                  ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700/60'
                  : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
              }`}
            >
              {isCloudMode ? '☁️ GitHub Git Audit Trail' : '🟢 Local SQLite SHA-256 Chain'}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            {isCloudMode ? (
              <span>
                Immutable, cryptographically linked Git commit history for{' '}
                <a
                  href={`https://github.com/${ghRepo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-indigo-400 hover:underline"
                >
                  {ghRepo}
                </a>
                .
              </span>
            ) : (
              'Immutable, SHA-256 hash-chained record of all administrative actions and mutations.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleVerifyChain}
            disabled={isVerifying}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-600/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            {isVerifying ? 'Verifying Chain...' : 'Verify Chain Integrity'}
          </button>
          <button
            onClick={loadLogs}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Chain verification banner */}
      {verifyResult && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            verifyResult.verified
              ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/60 border-rose-800 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-3">
            {verifyResult.verified ? (
              <svg className="w-6 h-6 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-rose-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            <div>
              <div className="font-semibold text-sm">
                {verifyResult.verified
                  ? 'Cryptographic Chain Integrity Verified'
                  : 'Chain Integrity Verification Result'}
              </div>
              <div className="text-xs opacity-90 mt-0.5 leading-relaxed">
                {verifyResult.message || (verifyResult.verified
                  ? 'All sequential block hashes are intact, tamper-evident, and cryptographically verified.'
                  : `Hash mismatch at event entry #${verifyResult.first_bad_id}. Database records may have been tampered with.`)}
              </div>
            </div>
          </div>
          <button
            onClick={() => setVerifyResult(null)}
            className="text-xs font-semibold uppercase tracking-wider opacity-70 hover:opacity-100 ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Filter by action (e.g. tenant.provision, tenant.update)..."
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Filter by tenant or key..."
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-mono text-xs"
          />
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 font-mono text-xs">Loading audit records...</div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400 text-sm">{error}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No matching audit events found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3.5">Commit / ID</th>
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-5 py-3.5">Action</th>
                  <th className="px-5 py-3.5">Admin</th>
                  <th className="px-5 py-3.5">Target</th>
                  <th className="px-5 py-3.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs">
                {filteredLogs.map((log) => (
                  <tr key={String(log.id)} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3 font-mono text-indigo-400 font-semibold">
                      {log.commit_url ? (
                        <a
                          href={log.commit_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:underline flex items-center gap-1"
                          title="View commit on GitHub"
                        >
                          <span>#{String(log.id)}</span>
                          <span className="text-[10px] text-slate-500">↗</span>
                        </a>
                      ) : (
                        `#${String(log.id)}`
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-400 font-sans">
                      {log.ts_ms ? formatTimestamp(log.ts_ms) : log.created_ms ? formatTimestamp(log.created_ms) : '—'}
                    </td>
                    <td className="px-5 py-3 font-mono font-medium text-emerald-400">
                      {log.action || log.event_type}
                    </td>
                    <td className="px-5 py-3 text-slate-300">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[11px]">
                        {log.admin_username || (log.admin_id ? `Admin #${log.admin_id}` : 'System')}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-300">
                      {log.tenant_id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[150px] font-semibold text-indigo-300">{log.tenant_id}</span>
                          <CopyButton text={log.tenant_id} label="Copy" />
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-200">
                      {log.detail || log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
