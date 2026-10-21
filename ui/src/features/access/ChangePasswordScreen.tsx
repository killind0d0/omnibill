import React, { useState } from 'react';
import { apiChangePassword } from './clientApi';

interface ChangePasswordScreenProps {
  token: string;
  username: string;
  onPasswordChanged: () => void;
}

export const ChangePasswordScreen: React.FC<ChangePasswordScreenProps> = ({
  token,
  username,
  onPasswordChanged,
}) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await apiChangePassword(token, oldPassword, newPassword);
      onPasswordChanged();
    } catch (err: any) {
      setError(err.message || 'Failed to update password. Verify your current password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center font-bold text-white shadow-lg shadow-amber-500/20 text-lg">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <span className="font-bold text-2xl text-white tracking-tight">Security Setup</span>
        </div>

        <div className="bg-slate-900 py-8 px-6 shadow-2xl rounded-2xl sm:px-10 border border-slate-800">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white tracking-tight">Set Permanent Password</h2>
            <p className="text-xs text-slate-400 mt-1">
              User <span className="font-mono text-indigo-400 font-semibold">{username}</span> is required to choose a permanent master password before accessing the system.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Current (Temporary) Password
              </label>
              <input
                type="password"
                required
                autoFocus
                placeholder="••••••••••••"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                New Permanent Password (min 8 chars)
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? 'Updating Password...' : 'Save Password & Enter App'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
