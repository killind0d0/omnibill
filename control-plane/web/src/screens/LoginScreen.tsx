import React, { useState } from 'react';
import { apiRequest } from '../utils/api';
import { AdminMe } from '../types';
import { GithubSyncService } from '../utils/githubService';

interface LoginScreenProps {
  onLoginSuccess: (admin: AdminMe) => void;
  errorMessage?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  errorMessage,
}) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [githubToken, setGithubToken] = useState(() => GithubSyncService.getConfig().token || '');
  const [showTokenInput, setShowTokenInput] = useState(true);
  const [error, setError] = useState(errorMessage || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);

    try {
      // 1. Try local daemon endpoint first
      let localLoginSuccess = false;
      try {
        const payload = {
          username: username.trim(),
          password,
        };
        const res = await apiRequest<{
          success: boolean;
          admin_id: number;
          username: string;
        }>('/v1/admin/login', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.success) {
          localLoginSuccess = true;
          onLoginSuccess({
            admin_id: res.admin_id,
            username: res.username,
          });
          return;
        }
      } catch {
        // Not running locally or serverless host
      }

      // 2. Serverless Cloud Mode Validation
      // Super Admin password check
      const trimmedUser = username.trim().toLowerCase();
      const isValidAdminPass = password === 'Admin@OmniBill2026!';

      if (!isValidAdminPass && !localLoginSuccess) {
        setError('Invalid Super Admin credentials');
        return;
      }

      // If token provided, save it
      if (githubToken.trim()) {
        const currentCfg = GithubSyncService.getConfig();
        GithubSyncService.saveConfig({
          ...currentCfg,
          token: githubToken.trim(),
        });
      }

      // Save Cloud Admin session into localStorage
      const cloudSession: AdminMe = {
        admin_id: 1,
        username: trimmedUser,
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem('omnibill_admin_cloud_session', JSON.stringify(cloudSession));
      }

      onLoginSuccess(cloudSession);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const hasStoredToken = Boolean(GithubSyncService.getConfig().token);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-4 font-mono font-bold text-2xl shadow-lg shadow-indigo-500/10">
            OB
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            <span>OmniBill Control Plane</span>
          </h1>
          <p className="text-xs text-indigo-300 font-mono mt-1">
            Global Super Admin Portal • Serverless Cloud
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-950/60 border border-red-800/60 text-red-300 text-sm flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Admin Username
            </label>
            <input
              type="text"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition"
              placeholder="e.g. admin"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Super Admin Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition"
              placeholder="••••••••••••"
              disabled={loading}
            />
          </div>

          {/* GitHub Cloud Integration option */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowTokenInput(!showTokenInput)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 focus:outline-none"
            >
              <span>{showTokenInput ? '▼' : '▶'}</span>
              <span>
                {hasStoredToken
                  ? 'GitHub Token Connected (Click to change)'
                  : 'Connect GitHub PAT for Remote Management'}
              </span>
            </button>

            {showTokenInput && (
              <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
                <label className="block text-[11px] font-medium text-slate-400">
                  GitHub Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-indigo-500 transition"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  disabled={loading}
                />
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Allows creating and managing licenses in <span className="font-mono text-slate-400">killind0d0/omnibill-licenses</span> directly from your phone or browser.
                </p>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-lg shadow-lg shadow-indigo-600/20 focus:outline-none transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Verifying Session...' : 'Sign In as Super Admin'}
            </button>
          </div>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-800/80 text-center">
          <a
            href="../"
            className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center justify-center gap-1.5"
          >
            <span>← Switch to Customer POS Counter</span>
          </a>
        </div>
      </div>
    </div>
  );
};
