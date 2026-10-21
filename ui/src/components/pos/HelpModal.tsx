import React from 'react';
import { HelpCircle, Keyboard, Barcode, Calculator, Check } from 'lucide-react';
import { Modal } from '../common/Modal';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const SHORTCUTS = [
    { key: 'F1', desc: 'Open this Help & Keyboard Shortcuts Cheat Sheet' },
    { key: 'F2', desc: 'Change Business / Invoice Date' },
    { key: 'F3', desc: 'Open Product Catalog / Item Search Modal' },
    { key: 'F4', desc: 'Quick Payment Receipt Modal (Cash/UPI/Card/Split)' },
    { key: 'F5', desc: 'Fast Barcode & Stock Price Check (without altering cart)' },
    { key: 'F6', desc: 'Hold / Suspend Active Customer Cart' },
    { key: 'F7', desc: 'Recall Suspended / Parked Bills' },
    { key: 'F8', desc: 'Switch to Sales Invoicing Mode (POS)' },
    { key: 'F9', desc: 'Switch to Purchases Entry Mode' },
    { key: 'Alt+S', desc: 'Save & Print Instant Thermal Slip (58mm/80mm)' },
    { key: 'Alt+Z', desc: 'Cash Drawer Shift Settlement & Z-Report' },
    { key: 'Enter', desc: 'Submit Quick Entry Bar / Add Scanned Item / Next Field' },
    { key: 'Tab', desc: 'Cycle through cart edit fields' },
    { key: 'Escape', desc: 'Cancel / Close active modal / Clear cart' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="POS Keyboard Navigation & Cheat Sheet (F1)"
      width="max-w-2xl"
      icon={<HelpCircle className="w-5 h-5 text-blue-400" />}
    >
      <div className="space-y-5 text-xs">
        {/* Shortcuts Table */}
        <div className="space-y-2">
          <div className="flex items-center space-x-1.5 font-bold text-slate-200">
            <Keyboard className="w-4 h-4 text-blue-400" />
            <span>Keyboard Shortcuts</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {SHORTCUTS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800"
              >
                <span className="text-slate-300 font-medium">{s.desc}</span>
                <kbd className="px-2 py-0.5 bg-blue-950/80 border border-blue-600/40 text-blue-300 rounded font-mono font-bold text-[11px]">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Barcode Scanner Wedge Section */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex items-center space-x-1.5 font-bold text-slate-200">
            <Barcode className="w-4 h-4 text-emerald-400" />
            <span>Barcode Scanner Wedge Listener</span>
          </div>
          <p className="text-slate-400 leading-relaxed">
            The Lightning POS includes an ultra-fast hardware scanner keyboard-wedge listener.
            You can scan products at any moment — even when focus is not inside an input box.
            Scanners typing characters at high velocity (<code className="text-emerald-400 font-mono">&lt;60ms</code> interval)
            ending with Enter are captured automatically and added straight to the cart!
          </p>
        </div>

        {/* Numpad Syntax */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="flex items-center space-x-1.5 font-bold text-slate-200">
            <Calculator className="w-4 h-4 text-indigo-400" />
            <span>Numpad Quick-Entry Syntax</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="p-2 rounded bg-slate-950 border border-slate-800">
              <div className="font-mono text-indigo-300 font-bold">3*120</div>
              <div className="text-[11px] text-slate-400 mt-0.5">3 Quantity @ ₹120 each</div>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800">
              <div className="font-mono text-indigo-300 font-bold">8901262...</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Direct barcode scan/entry</div>
            </div>
            <div className="p-2 rounded bg-slate-950 border border-slate-800">
              <div className="font-mono text-indigo-300 font-bold">MILK-500</div>
              <div className="text-[11px] text-slate-400 mt-0.5">Product SKU lookup</div>
            </div>
          </div>
        </div>

        {/* Tax Engine Rules */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800 text-slate-400">
          <div className="font-bold text-slate-200">GST Calculation Engine (Mirroring Rust tax.rs)</div>
          <ul className="list-disc list-inside space-y-1 text-[11px]">
            <li>Checked 128-bit integer math in paise and milli-units (zero floating-point rounding errors).</li>
            <li>Round-half-up division: 50 paise rounds up to next rupee, 49 paise rounds down.</li>
            <li>Round-off strictly bounded within -49 to +50 paise.</li>
            <li>Intra-state automatic split into 50% CGST and 50% SGST. Inter-state calculates 100% IGST.</li>
          </ul>
        </div>

        {/* Done Button */}
        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Got it (Esc)</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
