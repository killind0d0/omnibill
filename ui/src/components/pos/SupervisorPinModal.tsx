// ui/src/components/pos/SupervisorPinModal.tsx
// Commercial Supervisor / Store Manager PIN Challenge Dialog

import React, { useState, useEffect, useRef } from 'react';
import { ShieldAlert, KeyRound, CheckCircle2, Lock, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { posSound } from '../../lib/sound';
import { ErpStorageService } from '../../lib/erpStorage';

interface SupervisorPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionTitle: string;
  actionDescription: string;
  onAuthorized: () => void;
}

const VALID_PINS = ['9999', '0000', '1234'];

export const SupervisorPinModal: React.FC<SupervisorPinModalProps> = ({
  isOpen,
  onClose,
  actionTitle,
  actionDescription,
  onAuthorized,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (VALID_PINS.includes(pin.trim())) {
      posSound.playSuccess();
      try {
        ErpStorageService.addDayBookEntry({
          voucher_number: `OVR-${Date.now().toString().slice(-6)}`,
          type: 'JOURNAL',
          date: new Date().toISOString().split('T')[0],
          time: new Date().toTimeString().split(' ')[0],
          party_name: 'Supervisor Override Auth',
          narration: `Manager PIN Override authorized for: ${actionTitle} (${actionDescription})`,
          payment_mode: 'CREDIT',
          inflow_paise: 0,
          outflow_paise: 0,
          tax_paise: 0,
          net_amount_paise: 0,
        });
      } catch {}
      onAuthorized();
      onClose();
    } else {
      posSound.playWarning();
      setError('Invalid Supervisor PIN. Enter Store Manager (9999) or Owner PIN (0000).');
      setPin('');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Supervisor Override Authorization"
      icon={<ShieldAlert className="w-5 h-5 text-amber-400" />}
      width="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs select-none">
        <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-3.5 space-y-1.5">
          <div className="font-bold text-amber-300 text-sm flex items-center gap-1.5">
            <Lock className="w-4 h-4" />
            <span>{actionTitle}</span>
          </div>
          <p className="text-slate-300 text-xs">{actionDescription}</p>
        </div>

        <div className="space-y-2">
          <label className="block text-slate-300 font-semibold">
            Enter 4-Digit Manager / Supervisor PIN
          </label>
          <input
            ref={inputRef}
            type="password"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError(null);
            }}
            placeholder="••••"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-center text-xl tracking-widest font-mono text-white focus:outline-none focus:border-amber-500"
          />
          {error && <p className="text-rose-400 font-medium text-[11px]">{error}</p>}
          <p className="text-[10px] text-slate-500 text-center font-mono">
            Default Manager PIN: 9999 • Owner PIN: 0000
          </p>
        </div>

        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold transition shadow-lg shadow-amber-600/20 cursor-pointer"
          >
            Authorize Override
          </button>
        </div>
      </form>
    </Modal>
  );
};
