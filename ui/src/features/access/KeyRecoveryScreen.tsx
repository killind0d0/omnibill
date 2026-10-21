import React, { useState } from 'react';
import { apiImportDatabaseKey } from './clientApi';

interface KeyRecoveryScreenProps {
  onBack: () => void;
  onKeyImported: () => void;
}

export const KeyRecoveryScreen: React.FC<KeyRecoveryScreenProps> = ({
  onBack,
  onKeyImported,
}) => {
  const [hexKey, setHexKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanKey = hexKey.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      setError('Key must be exactly 64 hexadecimal characters (256-bit AES key).');
      return;
    }

    setLoading(true);

    try {
      await apiImportDatabaseKey(cleanKey);
      onKeyImported();
    } catch (err: any) {
      setError(err.message || 'Failed to import encryption key.');
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
            <h2 className="text-xl font-bold text-white tracking-tight">Database Key Recovery</h2>
            <p className="text-xs text-slate-400 mt-1">
              Enter the 64-character hexadecimal database encryption key (DEK) from your secure air-gapped escrow export.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Master 256-bit Hex Key (64 chars)
              </label>
              <textarea
                rows={3}
                required
                autoFocus
                placeholder="64 hex digits (e.g. e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855)"
                value={hexKey}
                onChange={(e) => setHexKey(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 font-mono tracking-wider resize-none"
              />
              <div className="text-[11px] text-slate-500 mt-1 text-right">
                {hexKey.trim().length} / 64 hex characters
              </div>
            </div>

            {error && (
              <div className="text-xs text-rose-300 bg-rose-950/60 p-3 rounded-lg border border-rose-800">
                {error}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading || hexKey.trim().length !== 64}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold shadow-lg shadow-indigo-600/20 transition-all text-sm disabled:opacity-50"
              >
                {loading ? 'Verifying Key...' : 'Import & Unlock Database'}
              </button>
            </div>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onBack}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                ← Back
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
