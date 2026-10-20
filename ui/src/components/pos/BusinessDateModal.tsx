import React, { useState, useEffect } from 'react';
import { Calendar, Check } from 'lucide-react';
import { Modal } from '../common/Modal';

interface BusinessDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDate: string;
  onSaveDate: (newDate: string) => void;
}

export const BusinessDateModal: React.FC<BusinessDateModalProps> = ({
  isOpen,
  onClose,
  currentDate,
  onSaveDate,
}) => {
  const [date, setDate] = useState<string>(currentDate);

  useEffect(() => {
    setDate(currentDate);
  }, [currentDate, isOpen]);

  const handleSave = () => {
    if (date.trim()) {
      onSaveDate(date.trim());
      onClose();
    }
  };

  const getTodayStr = () => new Date().toISOString().split('T')[0];
  const getYesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Change Business Date (F2)"
      width="max-w-md"
      icon={<Calendar className="w-5 h-5 text-blue-400" />}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Set the active transaction date for invoicing, ledger posting, and stock movements.
        </p>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Active Posting Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              }
            }}
            className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-3 py-2 text-white font-mono text-sm"
          />
        </div>

        {/* Quick Date Presets */}
        <div className="flex items-center space-x-2 select-none">
          <button
            type="button"
            onClick={() => setDate(getTodayStr())}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors"
          >
            Today ({getTodayStr()})
          </button>
          <button
            type="button"
            onClick={() => setDate(getYesterdayStr())}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors"
          >
            Yesterday
          </button>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors"
          >
            <Check className="w-4 h-4" />
            <span>Apply Date (Enter)</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
