// ui/src/components/pos/PriceCheckModal.tsx
// Fast barcode price verification tool (F5 Price Check) without altering current counter cart

import React, { useState, useEffect, useRef } from 'react';
import { Tag, Search, CheckCircle2, AlertCircle, ShoppingCart, Barcode, Package, IndianRupee } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ResourceItem } from '../../types/pos';
import { formatPaise } from '../../lib/tax';
import { posSound } from '../../lib/sound';

interface PriceCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: ResourceItem[];
  onAddToCart?: (product: ResourceItem) => void;
}

export const PriceCheckModal: React.FC<PriceCheckModalProps> = ({
  isOpen,
  onClose,
  products,
  onAddToCart,
}) => {
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ResourceItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedProduct(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleSearch = (searchVal: string) => {
    setQuery(searchVal);
    const trimmed = searchVal.trim().toLowerCase();
    if (!trimmed) {
      setSelectedProduct(null);
      return;
    }

    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === trimmed ||
        p.sku.toLowerCase() === trimmed ||
        p.name.toLowerCase().includes(trimmed)
    );

    if (found) {
      setSelectedProduct(found);
      posSound.playScan();
    } else {
      setSelectedProduct(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return;

      const found = products.find(
        (p) =>
          p.barcode.toLowerCase() === trimmed ||
          p.sku.toLowerCase() === trimmed ||
          p.name.toLowerCase().includes(trimmed)
      );

      if (found) {
        setSelectedProduct(found);
        posSound.playScan();
      } else {
        posSound.playWarning();
      }
    }
  };

  const handleAddAndClose = () => {
    if (selectedProduct && onAddToCart) {
      onAddToCart(selectedProduct);
      posSound.playItemAdd();
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Price & Stock Check (F5)"
      width="max-w-xl"
      icon={<Tag className="w-5 h-5 text-cyan-400" />}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Scan or search any barcode/SKU to verify retail pricing, GST bracket, and stock availability without modifying the active sale cart.
        </p>

        {/* Search input with autofocus */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scan barcode or type SKU / product name..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-4 py-3 pl-11 text-sm text-white placeholder-slate-500 font-mono tracking-wide focus:outline-none transition shadow-inner"
          />
          <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setSelectedProduct(null);
                inputRef.current?.focus();
              }}
              className="absolute right-3.5 top-3 text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        {/* Product Details Display */}
        {selectedProduct ? (
          <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-4 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-mono px-2 py-0.5 bg-cyan-950 border border-cyan-800 text-cyan-300 rounded font-semibold">
                  SKU: {selectedProduct.sku}
                </span>
                <h3 className="text-base font-bold text-white mt-1">
                  {selectedProduct.name}
                </h3>
                <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                  <Barcode className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono">{selectedProduct.barcode}</span>
                  <span>•</span>
                  <span>HSN: <b className="text-slate-300 font-mono">{selectedProduct.hsn}</b></span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Counter Price</span>
                <span className="text-2xl font-black text-cyan-400 font-mono">
                  {formatPaise(selectedProduct.base_price_paise)}
                </span>
                <span className="text-[10px] text-slate-500 block">per {selectedProduct.unit}</span>
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 font-medium">GST Rate</div>
                <div className="text-xs font-bold text-amber-400 font-mono mt-0.5">
                  {(selectedProduct.tax_rate_bps / 100).toFixed(1)}% GST
                </div>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 font-medium">Available Stock</div>
                <div className="text-xs font-bold text-emerald-400 font-mono mt-0.5">
                  {(selectedProduct.stock_milli / 1000).toLocaleString('en-IN')} {selectedProduct.unit}
                </div>
              </div>
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <div className="text-[10px] text-slate-400 font-medium">Est. Cost</div>
                <div className="text-xs font-bold text-slate-300 font-mono mt-0.5">
                  {formatPaise(selectedProduct.cost_price_paise)}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400 flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Price verified from master catalog</span>
              </span>
              {onAddToCart && (
                <button
                  type="button"
                  onClick={handleAddAndClose}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition cursor-pointer shadow-lg shadow-cyan-600/20 focus-ring"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>+ Add to Active Cart</span>
                </button>
              )}
            </div>
          </div>
        ) : query.trim() ? (
          <div className="bg-slate-950 p-6 rounded-xl border border-dashed border-slate-800 text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-amber-500/70 mx-auto" />
            <div className="text-xs font-bold text-slate-300">No Item Found</div>
            <p className="text-[11px] text-slate-500">
              No matching SKU or barcode found for "{query}". Verify the code or press F3 to search by name.
            </p>
          </div>
        ) : (
          <div className="bg-slate-950/60 p-6 rounded-xl border border-slate-800/60 text-center space-y-1">
            <Barcode className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-xs font-semibold text-slate-400">Ready for Scan</div>
            <p className="text-[11px] text-slate-600">
              Aim your handheld barcode scanner at the product tag or packaging.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </Modal>
  );
};
