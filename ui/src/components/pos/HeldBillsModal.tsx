// ui/src/components/pos/HeldBillsModal.tsx
// Modal to view, recall, and manage suspended/parked customer carts (F6 Hold / F7 Recall)

import React from 'react';
import { PauseCircle, PlayCircle, Trash2, Clock, User, Phone, X, ShoppingCart } from 'lucide-react';
import { Modal } from '../common/Modal';
import { CartLineItem, PriceMode } from '../../types/pos';
import { formatPaise } from '../../lib/tax';

export interface HeldBill {
  id: string;
  timestamp: string;
  customerName: string;
  customerPhone: string;
  priceMode: PriceMode;
  items: CartLineItem[];
  subtotalPaise: number;
}

interface HeldBillsModalProps {
  isOpen: boolean;
  onClose: () => void;
  heldBills: HeldBill[];
  onRecallBill: (bill: HeldBill) => void;
  onDiscardBill: (billId: string) => void;
}

export const HeldBillsModal: React.FC<HeldBillsModalProps> = ({
  isOpen,
  onClose,
  heldBills,
  onRecallBill,
  onDiscardBill,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Held / Parked Bills (${heldBills.length})`}
      width="max-w-2xl"
      icon={<PauseCircle className="w-5 h-5 text-amber-400" />}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Suspended customer carts waiting for resumption. Click <b>Recall</b> to restore any bill to the active counter.
        </p>

        {heldBills.length === 0 ? (
          <div className="bg-slate-950 p-8 rounded-xl border border-slate-800 text-center space-y-2">
            <ShoppingCart className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-sm font-bold text-slate-400">No Bills Currently on Hold</div>
            <p className="text-xs text-slate-500">
              Press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-slate-300">F6</kbd> or click Hold Bill during an active sale to suspend it.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {heldBills.map((bill) => (
              <div
                key={bill.id}
                className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 hover:border-slate-700 transition flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white text-xs">
                      {bill.customerName || 'Walk-in Customer'}
                    </span>
                    {bill.customerPhone && (
                      <span className="text-[11px] text-slate-400 font-mono">
                        ({bill.customerPhone})
                      </span>
                    )}
                    <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded font-mono text-[10px]">
                      {bill.priceMode}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 text-[11px] text-slate-400">
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{bill.timestamp}</span>
                    </span>
                    <span>•</span>
                    <span>{bill.items.length} Items</span>
                    <span>•</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      {formatPaise(bill.subtotalPaise)}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-500 truncate max-w-md">
                    {bill.items.map((i) => i.name).slice(0, 3).join(', ')}
                    {bill.items.length > 3 ? ` +${bill.items.length - 3} more` : ''}
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onRecallBill(bill)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer shadow-md shadow-emerald-600/20 focus-ring"
                    aria-label={`Recall parked bill for ${bill.customerName || 'customer'}, subtotal ${formatPaise(bill.subtotalPaise)}`}
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>Recall Bill</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDiscardBill(bill.id)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition cursor-pointer focus-ring"
                    title="Discard held bill"
                    aria-label="Discard held bill"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </Modal>
  );
};
