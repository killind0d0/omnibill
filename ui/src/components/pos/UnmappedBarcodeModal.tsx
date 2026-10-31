// ui/src/components/pos/UnmappedBarcodeModal.tsx
// Modal displayed when an uncatalogued barcode is scanned/entered

import React, { useState } from 'react';
import { Barcode, AlertTriangle, Plus, X, Search, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ResourceItem } from '../../types/pos';
import { ErpStorageService } from '../../lib/erpStorage';
import { posSound } from '../../lib/sound';

interface UnmappedBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  barcode: string;
  onProductCreatedOrMapped: (product: ResourceItem) => void;
}

export const UnmappedBarcodeModal: React.FC<UnmappedBarcodeModalProps> = ({
  isOpen,
  onClose,
  barcode,
  onProductCreatedOrMapped,
}) => {
  const [mode, setMode] = useState<'CHOICE' | 'NEW_SKU'>('CHOICE');
  const [name, setName] = useState('');
  const [priceInr, setPriceInr] = useState('');
  const [mrpInr, setMrpInr] = useState('');
  const [taxRateBps, setTaxRateBps] = useState(500);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Please enter an Item Description.');
      return;
    }

    const price = parseFloat(priceInr || '0');
    if (price <= 0) {
      alert('Selling Price must be greater than 0.');
      return;
    }
    if (price > 50000) {
      alert('Price exceeds ₹50,000 threshold. Please verify entry.');
      return;
    }

    const pricePaise = Math.round(price * 100);
    const mrpPaise = mrpInr ? Math.round(parseFloat(mrpInr) * 100) : Math.round(pricePaise * 1.15);
    const costPaise = Math.round(pricePaise * 0.8);

    const created = ErpStorageService.addItem({
      sku: `SKU-${barcode.slice(-6)}`,
      barcode,
      name: name.trim(),
      hsn_sac: '9999',
      tax_rate_bps: taxRateBps,
      base_price_paise: pricePaise,
      cost_price_paise: costPaise,
      unit: 'PCS',
      category: 'General Grocery',
      is_stock_tracked: true,
      reorder_level_milli: 10000,
      initial_stock_milli: 50000, // 50 opening units
      mrp_paise: mrpPaise,
    });

    posSound.playSuccess();
    onProductCreatedOrMapped({
      id: created.id,
      sku: created.sku,
      barcode: created.barcode || barcode,
      name: created.name,
      hsn: created.hsn_sac,
      unit: 'pcs',
      tax_rate_bps: created.tax_rate_bps,
      base_price_paise: created.base_price_paise,
      cost_price_paise: created.cost_price_paise,
      stock_milli: 50000,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Uncatalogued Barcode Detected"
      icon={<Barcode className="w-5 h-5 text-amber-400" />}
      width="max-w-md"
    >
      <div className="space-y-4 text-xs select-none">
        <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center space-x-2 text-amber-300 font-bold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Barcode Not Found in Catalog</span>
          </div>
          <p className="text-slate-300 font-mono text-xs">
            Barcode: <strong className="text-white text-sm bg-slate-900 px-2 py-0.5 rounded border border-slate-700">{barcode}</strong>
          </p>
          <p className="text-slate-400 text-[11px] pt-1">
            This 13-digit EAN/numeric barcode is not yet mapped to any product in your inventory master.
          </p>
        </div>

        {mode === 'CHOICE' ? (
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => setMode('NEW_SKU')}
              className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold flex items-center justify-center space-x-2 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Quick-Add as New Product SKU</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition cursor-pointer"
            >
              Cancel / Ignore Scan
            </button>
          </div>
        ) : (
          <form onSubmit={handleQuickAdd} className="space-y-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Item Description / Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cadbury Dairy Milk 50g"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">
                  Selling Price (₹) <span className="text-rose-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={priceInr}
                  onChange={(e) => setPriceInr(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={mrpInr}
                  onChange={(e) => setMrpInr(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setMode('CHOICE')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
              >
                Save & Add to Cart
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
