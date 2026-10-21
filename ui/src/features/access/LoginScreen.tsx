import React, { useState } from 'react';
import { apiLogin } from './clientApi';
import { AuthenticatedUser } from './types';

interface LoginScreenProps {
  onLoginSuccess: (token: string, user: AuthenticatedUser) => void;
  onOpenOwnerReset: () => void;
  onOpenActivation?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onOpenOwnerReset,
  onOpenActivation,
}) => {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiLogin(username, password);
      onLoginSuccess(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

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
            <h2 className="text-xl font-bold text-white tracking-tight">Terminal Sign In</h2>
            <p className="text-xs text-slate-400 mt-1">
              Authenticate using your POS operator or owner credentials.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Username
              </label>
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Password
                </label>
                <button
                  type="button"
                  onClick={onOpenOwnerReset}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Forgot owner password?
                </button>
              </div>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
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
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
            </div>
          </form>

          {onOpenActivation && (
            <div className="mt-6 pt-6 border-t border-slate-800 text-center">
              <button
                onClick={onOpenActivation}
                className="text-xs text-slate-400 hover:text-indigo-300 transition-colors"
              >
                Need to activate a new terminal? <span className="underline font-semibold">Activate Business</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
