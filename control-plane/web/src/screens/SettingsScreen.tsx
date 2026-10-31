import React, { useState, useEffect } from 'react';
import { apiRequest } from '../utils/api';
import { GithubSyncService, GithubConfig } from '../utils/githubService';

export const SettingsScreen: React.FC = () => {
  const [supportText, setSupportText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // GitHub Automation Settings
  const [githubConfig, setGithubConfig] = useState<GithubConfig>(() => GithubSyncService.getConfig());
  const [showToken, setShowToken] = useState(false);
  const [githubTestStatus, setGithubTestStatus] = useState<{
    tested: boolean;
    ok: boolean;
    message: string;
    canCreateRepo?: boolean;
    repoUrl?: string;
  } | null>(null);
  const [testingGithub, setTestingGithub] = useState(false);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [githubSavedMsg, setGithubSavedMsg] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<{ text?: string }>('/v1/admin/settings/support-text').catch(() => null);
      if (res && res.text) {
        setSupportText(res.text);
      }
    } catch {
      // Ignored if GET is not present yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supportText.length > 120) {
      setMessage({ text: 'Support text cannot exceed 120 characters.', isError: true });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await apiRequest('/v1/admin/settings/support-text', {
        method: 'POST',
        body: JSON.stringify({ text: supportText }),
      });
      setMessage({ text: 'Support message updated and broadcast to future licenses.', isError: false });
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed to update support message', isError: true });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGithub = (e: React.FormEvent) => {
    e.preventDefault();
    GithubSyncService.saveConfig(githubConfig);
    setGithubSavedMsg('GitHub settings saved successfully!');
    setTimeout(() => setGithubSavedMsg(null), 3000);
  };

  const handleTestGithub = async () => {
    setTestingGithub(true);
    setGithubTestStatus(null);
    try {
      const res = await GithubSyncService.testConnection(githubConfig.token, githubConfig.repo);
      setGithubTestStatus({
        tested: true,
        ok: res.ok,
        message: res.message,
        canCreateRepo: res.canCreateRepo,
        repoUrl: res.repoUrl,
      });
    } finally {
      setTestingGithub(false);
    }
  };

  const handleAutoCreateRepo = async () => {
    setCreatingRepo(true);
    try {
      const repoName = githubConfig.repo.includes('/')
        ? githubConfig.repo.split('/')[1]
        : githubConfig.repo;
      const res = await GithubSyncService.createRepository(githubConfig.token, repoName);
      if (res.ok) {
        setGithubTestStatus({
          tested: true,
          ok: true,
          message: `Repository "${githubConfig.repo}" created on GitHub! Ready to auto-publish licenses.`,
          repoUrl: res.repoUrl,
        });
      } else {
        setGithubTestStatus({
          tested: true,
          ok: false,
          message: res.message,
        });
      }
    } finally {
      setCreatingRepo(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">System Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage zero-server GitHub license registry automation and global support configurations.
        </p>
      </div>

      {/* GitHub Serverless Registry Automation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl font-bold text-sm">
                GH
              </span>
              <h2 className="text-lg font-bold text-white">GitHub Serverless License Registry</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              OmniBill automatically commits and pushes client licenses to GitHub when you provision a new business.
              Clients will activate online immediately with zero manual file uploading!
            </p>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Zero-Server Mode
          </span>
        </div>

        <form onSubmit={handleSaveGithub} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Target Repository
              </label>
              <input
                type="text"
                required
                value={githubConfig.repo}
                onChange={(e) => setGithubConfig({ ...githubConfig, repo: e.target.value.trim() })}
                placeholder="killind0d0/omnibill-licenses"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Format: <code className="text-slate-400">username/repository</code>
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Personal Access Token (PAT)
                </label>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=OmniBill-License-Registry"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
                >
                  Create Token on GitHub ↗
                </a>
              </div>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={githubConfig.token}
                  onChange={(e) => setGithubConfig({ ...githubConfig, token: e.target.value.trim() })}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_..."
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-indigo-500 pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2.5 top-2.5 text-[11px] text-slate-400 hover:text-slate-200"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Requires standard <code className="text-slate-400">repo</code> (or Contents write) permission.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="autoSync"
              checked={githubConfig.autoSync}
              onChange={(e) => setGithubConfig({ ...githubConfig, autoSync: e.target.checked })}
              className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="autoSync" className="text-xs text-slate-300 font-medium cursor-pointer">
              Automatically create and commit license JSON to GitHub upon creating or renewing a business
            </label>
          </div>

          {githubTestStatus && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-col gap-2 ${
                githubTestStatus.ok
                  ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{githubTestStatus.message}</span>
                {githubTestStatus.repoUrl && (
                  <a
                    href={githubTestStatus.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold text-white"
                  >
                    Open Repo ↗
                  </a>
                )}
              </div>

              {githubTestStatus.canCreateRepo && (
                <div>
                  <button
                    type="button"
                    onClick={handleAutoCreateRepo}
                    disabled={creatingRepo}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition"
                  >
                    {creatingRepo ? 'Initializing Repository...' : '⚡ Initialize Repository on GitHub Now'}
                  </button>
                </div>
              )}
            </div>
          )}

          {githubSavedMsg && (
            <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs">
              {githubSavedMsg}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition cursor-pointer"
            >
              Save GitHub Settings
            </button>
            <button
              type="button"
              onClick={handleTestGithub}
              disabled={testingGithub || !githubConfig.token}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition cursor-pointer"
            >
              {testingGithub ? 'Testing Connection...' : 'Test Connection / Verify Token'}
            </button>
          </div>
        </form>
      </div>

      {/* Vendor Support Contact Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-white">Vendor Support Contact Banner</h2>
          <p className="text-xs text-slate-400 mt-1">
            Displayed on client POS terminals when subscriptions are expiring, expired, or locked offline.
            Must be 120 characters or fewer.
          </p>
        </div>

        <form onSubmit={handleSaveSupport} className="space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Support Text
              </label>
              <span
                className={`text-xs font-mono ${
                  supportText.length > 120
                    ? 'text-rose-400 font-bold'
                    : supportText.length > 100
                    ? 'text-amber-400'
                    : 'text-slate-500'
                }`}
              >
                {supportText.length} / 120 characters
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={120}
              value={supportText}
              onChange={(e) => setSupportText(e.target.value)}
              placeholder="e.g., For license renewals or support, call +91 98765 43210 or email dev@omnibill.com"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>

          {/* Preview box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Client POS Preview
            </div>
            <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 p-2.5 rounded-lg font-mono">
              {supportText.trim() || 'No support text configured. Default fallback (+91 98765 43210 • dev@omnibill.com) will be used.'}
            </div>
          </div>

          {message && (
            <div
              className={`text-xs p-3 rounded-xl border ${
                message.isError
                  ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving || supportText.length > 120}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Update Support Text'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
