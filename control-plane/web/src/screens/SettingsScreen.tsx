import React, { useState, useEffect } from 'react';
import { apiRequest } from '../utils/api';

export const SettingsScreen: React.FC = () => {
  const [supportText, setSupportText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);
      // Try to fetch settings if endpoint exists or default to empty
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

  const handleSave = async (e: React.FormEvent) => {
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

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">System Settings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Configure global messages embedded into signed client licenses during check-in.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Vendor Support Contact Banner</h2>
          <p className="text-xs text-slate-400 mt-1">
            Displayed on client POS terminals when subscriptions are expiring, expired, or locked offline.
            Must be 120 characters or fewer.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
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
              placeholder="e.g., For license renewals or support, call +91-9876543210 or email support@omnibill.in"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500 font-sans"
            />
          </div>

          {/* Preview box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Client POS Preview
            </div>
            <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 p-2.5 rounded font-mono">
              {supportText.trim() || 'No support text configured. Default fallback will be used.'}
            </div>
          </div>

          {message && (
            <div
              className={`text-xs p-3 rounded-lg border ${
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
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Update Support Text'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
