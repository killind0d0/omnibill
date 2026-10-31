import React, { useState } from 'react';
import { apiRequest } from '../utils/api';
import { AdminMe } from '../types';

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
  const [error, setError] = useState(errorMessage || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); // Enter submits
    setError('');

    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setLoading(true);

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
        onLoginSuccess({
          admin_id: res.admin_id,
          username: res.username,
        });
      }
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4 font-mono font-bold text-xl">
            OB
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Control Plane
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Sign in with Super Admin credentials
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
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
              placeholder="e.g. admin"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
              placeholder="••••••••••••"
              disabled={loading}
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-lg shadow-lg shadow-emerald-500/20 focus:outline-none transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
