// ui/src/components/pos/ConfirmClearModal.tsx
// In-app modal to confirm clearing/voiding active cart

import React from 'react';
import { AlertCircle, Trash2, X } from 'lucide-react';
import { Modal } from '../common/Modal';

interface ConfirmClearModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmClear: () => void;
  itemCount: number;
}

export const ConfirmClearModal: React.FC<ConfirmClearModalProps> = ({
  isOpen,
  onClose,
  onConfirmClear,
  itemCount,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Clear Active Cart"
      icon={<Trash2 className="w-5 h-5 text-rose-400" />}
      width="max-w-sm"
    >
      <div className="space-y-4 text-xs select-none">
        <div className="bg-rose-950/30 border border-rose-600/40 rounded-xl p-3.5 space-y-2 text-center">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
          <h4 className="font-bold text-white text-sm">Void Current Basket?</h4>
          <p className="text-slate-300 text-xs">
            Are you sure you want to cancel and remove all <strong>{itemCount} item(s)</strong> currently in the cart?
          </p>
        </div>

        <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
          >
            Keep Cart
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirmClear();
              onClose();
            }}
            className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition shadow-lg shadow-rose-600/30 cursor-pointer"
          >
            Clear All Items
          </button>
        </div>
      </div>
    </Modal>
  );
};
