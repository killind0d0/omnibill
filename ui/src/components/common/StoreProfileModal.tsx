// ui/src/components/common/StoreProfileModal.tsx
// Store Profile & Company Setup Configuration Modal

import React, { useState, useEffect } from 'react';
import { Store, ShieldCheck, Building2, Phone, Mail, MapPin, QrCode, Save, X, Sparkles } from 'lucide-react';
import { Modal } from './Modal';
import { BusinessProfile } from '../../types/pos';
import { posStorage } from '../../lib/api';
import { ErpStorageService } from '../../lib/erpStorage';
import { posSound } from '../../lib/sound';

interface StoreProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated?: (profile: BusinessProfile) => void;
}

const STORE_PRESETS: Array<{ name: string; profile: BusinessProfile }> = [
  {
    name: 'Ramesh Kirana Store (Mumbai)',
    profile: {
      id: 'biz_ramesh',
      trade_name: 'Ramesh Kirana Store',
      legal_name: 'Ramesh Kirana Enterprises',
      gstin: '27AABCR1234D1Z5',
      state_code: '27',
      phone: '+91 98200 12345',
      email: 'ramesh@kirana.local',
      address_line1: 'Shop #4, Dharavi Main Road, Near Railway Bridge',
      city: 'Mumbai',
      postal_code: '400017',
      upi_vpa: 'rameshkirana@okhdfcbank',
    },
  },
  {
    name: 'Priya Supermarket (Bandra)',
    profile: {
      id: 'biz_priya',
      trade_name: 'Priya Supermarket',
      legal_name: 'Priya Supermarket Private Limited',
      gstin: '27AABCP5678E1Z2',
      state_code: '27',
      phone: '+91 98200 67890',
      email: 'counter@priyasupermarket.com',
      address_line1: 'Plot 42, Hill Road, Bandra West',
      city: 'Mumbai',
      postal_code: '400050',
      upi_vpa: 'priyasupermarket@icici',
    },
  },
  {
    name: 'Imran Hardware & Stationers (Lamington Rd)',
    profile: {
      id: 'biz_imran',
      trade_name: 'Imran Hardware & Stationers',
      legal_name: 'Imran Tools & Stationers LLP',
      gstin: '27AABCI9012F1Z9',
      state_code: '27',
      phone: '+91 98200 99887',
      email: 'orders@imranhardware.in',
      address_line1: '108 Commercial Chambers, Lamington Road, Grant Road',
      city: 'Mumbai',
      postal_code: '400007',
      upi_vpa: 'imranhardware@axisbank',
    },
  },
];

export const StoreProfileModal: React.FC<StoreProfileModalProps> = ({
  isOpen,
  onClose,
  onProfileUpdated,
}) => {
  const [profile, setProfile] = useState<BusinessProfile>(() => posStorage.getBusinessProfile());
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setProfile(posStorage.getBusinessProfile());
      setIsSaved(false);
    }
  }, [isOpen]);

  const handleApplyPreset = (preset: BusinessProfile) => {
    setProfile({ ...preset });
    posSound.playItemAdd();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile.trade_name.trim() || !profile.gstin.trim()) {
      alert('Trade Name and GSTIN are required under Indian GST statutory rules.');
      return;
    }

    posStorage.setBusinessProfile(profile);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('omnibill_profile_sync', { detail: profile }));
      // Also update session store name if present
      try {
        const sessRaw = localStorage.getItem('omnibill_active_session');
        if (sessRaw) {
          const sess = JSON.parse(sessRaw);
          sess.storeName = profile.trade_name;
          localStorage.setItem('omnibill_active_session', JSON.stringify(sess));
        }
      } catch {}
    }

    posSound.playSuccess();
    setIsSaved(true);
    if (onProfileUpdated) {
      onProfileUpdated(profile);
    }
    setTimeout(() => {
      onClose();
    }, 400);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Store Profile & Company Setup"
      icon={<Store className="w-5 h-5 text-blue-400" />}
      width="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs select-none">
        {/* Preset Quick Fill */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>1-Click Merchant Presets</span>
            </span>
            <span className="text-[10px] text-slate-500">Quick-load real store identity</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {STORE_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleApplyPreset(p.profile)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-left text-slate-300 transition-colors"
              >
                <div className="font-semibold text-white truncate">{p.name.split(' (')[0]}</div>
                <div className="text-[10px] font-mono text-emerald-400 truncate">{p.profile.gstin}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              Store Trade Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={profile.trade_name}
              onChange={(e) => setProfile({ ...profile, trade_name: e.target.value })}
              placeholder="e.g. Ramesh Kirana Store"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              Legal Registered Entity Name
            </label>
            <input
              type="text"
              value={profile.legal_name}
              onChange={(e) => setProfile({ ...profile, legal_name: e.target.value })}
              placeholder="e.g. Ramesh Kirana Enterprises"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              Store GSTIN <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={15}
              value={profile.gstin}
              onChange={(e) => setProfile({ ...profile, gstin: e.target.value.toUpperCase() })}
              placeholder="27AABCR1234D1Z5"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              State Code (e.g. 27 for Maharashtra)
            </label>
            <input
              type="text"
              maxLength={2}
              value={profile.state_code}
              onChange={(e) => setProfile({ ...profile, state_code: e.target.value })}
              placeholder="27"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">Store Phone / Mobile</label>
            <input
              type="text"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+91 98200 12345"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">UPI VPA for Invoices</label>
            <input
              type="text"
              value={profile.upi_vpa}
              onChange={(e) => setProfile({ ...profile, upi_vpa: e.target.value })}
              placeholder="store@icici"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-slate-400 font-semibold mb-1">Business Address</label>
            <input
              type="text"
              value={profile.address_line1}
              onChange={(e) => setProfile({ ...profile, address_line1: e.target.value })}
              placeholder="Shop #4, Dharavi Main Road"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">City</label>
            <input
              type="text"
              value={profile.city}
              onChange={(e) => setProfile({ ...profile, city: e.target.value })}
              placeholder="Mumbai"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-semibold mb-1">PIN / Postal Code</label>
            <input
              type="text"
              maxLength={6}
              value={profile.postal_code}
              onChange={(e) => setProfile({ ...profile, postal_code: e.target.value })}
              placeholder="400017"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Rule 46 CGST Compliance: Printed on all 80mm receipts & tax vouchers.</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center space-x-1.5 shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Store Profile</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
