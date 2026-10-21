import React, { useState } from 'react';
import { Modal } from '../components/Modal';
import { CopyButton } from '../components/CopyButton';
import { apiRequest } from '../utils/api';
import { formatCivilDate } from '../utils/format';
import { CreateTenantResponse } from '../types';

interface NewBusinessWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const NewBusinessWizardModal: React.FC<NewBusinessWizardModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [businessName, setBusinessName] = useState('');
  const [vertical, setVertical] = useState('retail');
  const [plan, setPlan] = useState('pro');
  const [maxCounters, setMaxCounters] = useState(3);
  const [offlineDays, setOfflineDays] = useState(3);
  const [notes, setNotes] = useState('');

  // Default expiry: today + 30 days
  const todayDay = Math.floor((Date.now() + 19800000) / 86400000);
  const [validUntilDay, setValidUntilDay] = useState(todayDay + 30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Credentials shown ONCE state
  // SECRET SHOWN ONCE: The newly generated tenant ID and Owner temporary password
  // are received from the server response and stored in memory only. Once this modal
  // is dismissed, the temporary password cannot be retrieved again from the server.
  const [createdData, setCreatedData] = useState<CreateTenantResponse | null>(null);

  const resetForm = () => {
    setBusinessName('');
    setVertical('retail');
    setPlan('pro');
    setMaxCounters(3);
    setOfflineDays(3);
    setNotes('');
    setValidUntilDay(todayDay + 30);
    setError('');
    setCreatedData(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); // Enter submits
    setError('');

    if (!businessName.trim()) {
      setError('Business name is required');
      return;
    }

    setLoading(true);

    try {
      const res = await apiRequest<CreateTenantResponse>('/v1/admin/tenants', {
        method: 'POST',
        body: JSON.stringify({
          business_name: businessName.trim(),
          vertical,
          plan,
          valid_until_day: validUntilDay,
          max_counters: plan === 'basic' ? 1 : maxCounters,
          offline_days: offlineDays,
          notes: notes.trim() || undefined,
        }),
      });

      setCreatedData(res);
      onCreated();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create tenant');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={createdData ? 'Business Handover Card' : 'New Business Provisioning Wizard'}
      maxWidth="max-w-xl"
    >
      {createdData ? (
        <div className="space-y-6">
          {/* Handover Card with dedicated print stylesheet class */}
          <div className="print-handover-card p-6 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-lg font-bold text-slate-100">{businessName}</h4>
                <p className="text-xs text-slate-400 capitalize">
                  {vertical} Vertical • {plan.toUpperCase()} Plan
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Valid Until</p>
                <p className="text-sm font-semibold text-emerald-400">
                  {formatCivilDate(validUntilDay)}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-800/40 rounded-lg text-amber-300 text-xs no-print">
              ⚠️ <strong>Warning:</strong> The temporary password below is displayed{' '}
              <strong>ONCE</strong>. Record or print this handover card now before closing.
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-slate-400">Tenant Code / Business ID</label>
                <div className="mt-1 flex items-center justify-between p-2.5 bg-slate-900 border border-slate-800 rounded-lg font-mono text-sm text-slate-200">
                  <span>{createdData.tenant_id}</span>
                  <div className="no-print">
                    <CopyButton text={createdData.tenant_id} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400">Owner Username</label>
                <div className="mt-1 flex items-center justify-between p-2.5 bg-slate-900 border border-slate-800 rounded-lg font-mono text-sm text-slate-200">
                  <span>{createdData.owner_username}</span>
                  <div className="no-print">
                    <CopyButton text={createdData.owner_username} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400">Temporary Password</label>
                {/* SECRET SHOWN ONCE: Displayed only here upon creation */}
                <div className="mt-1 flex items-center justify-between p-2.5 bg-slate-900 border border-slate-800 rounded-lg font-mono text-base font-bold text-emerald-400">
                  <span>{createdData.temp_password}</span>
                  <div className="no-print">
                    <CopyButton text={createdData.temp_password} />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2 text-xs text-slate-400 space-y-1">
              <p>• Device activation limit: {plan === 'basic' ? 1 : maxCounters} counter(s)</p>
              <p>• First login will require setting a permanent password</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 no-print">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>Print Handover Card</span>
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold rounded-lg transition"
            >
              Done & Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-950/60 border border-red-800/60 rounded-lg text-red-300 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Business Name</label>
            <input
              type="text"
              autoFocus
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition"
              placeholder="e.g. Apex Supermarket"
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Vertical</label>
              <select
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition"
                disabled={loading}
              >
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
                <option value="hospital">Hospital</option>
                <option value="school">School</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Plan</label>
              <select
                value={plan}
                onChange={(e) => {
                  const p = e.target.value;
                  setPlan(p);
                  if (p === 'basic') setMaxCounters(1);
                }}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition"
                disabled={loading}
              >
                <option value="pro">Pro</option>
                <option value="basic">Basic</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Max Counters {plan === 'basic' && '(Fixed to 1 on Basic)'}
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxCounters}
                disabled={plan === 'basic' || loading}
                onChange={(e) => setMaxCounters(parseInt(e.target.value, 10) || 1)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Offline Tolerance (Days)
              </label>
              <input
                type="number"
                min={1}
                max={14}
                value={offlineDays}
                disabled={loading}
                onChange={(e) => setOfflineDays(parseInt(e.target.value, 10) || 3)}
                className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">Initial Expiry</label>
              <span className="text-xs text-emerald-400 font-mono">
                {formatCivilDate(validUntilDay)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setValidUntilDay(todayDay + 30)}
                className={`flex-1 py-1.5 text-xs rounded border transition ${
                  validUntilDay === todayDay + 30
                    ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                1 Month
              </button>
              <button
                type="button"
                onClick={() => setValidUntilDay(todayDay + 90)}
                className={`flex-1 py-1.5 text-xs rounded border transition ${
                  validUntilDay === todayDay + 90
                    ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                3 Months
              </button>
              <button
                type="button"
                onClick={() => setValidUntilDay(todayDay + 365)}
                className={`flex-1 py-1.5 text-xs rounded border transition ${
                  validUntilDay === todayDay + 365
                    ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                1 Year
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Notes (Optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition"
              placeholder="e.g. Onboarded by field representative"
              disabled={loading}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-lg transition disabled:opacity-50"
            >
              {loading ? 'Provisioning...' : 'Provision Tenant'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
