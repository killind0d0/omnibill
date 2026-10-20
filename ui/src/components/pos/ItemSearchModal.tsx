import React, { useState, useEffect, useRef } from 'react';
import { Search, Tag, Plus } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ResourceItem } from '../../types/pos';
import { formatPaise } from '../../lib/tax';

interface ItemSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: ResourceItem[];
  onSelectItem: (item: ResourceItem) => void;
}

export const ItemSearchModal: React.FC<ItemSearchModalProps> = ({
  isOpen,
  onClose,
  products,
  onSelectItem,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = products.filter((p) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.barcode.toLowerCase().includes(q) ||
      p.hsn.toLowerCase().includes(q)
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filtered.length ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelectItem(filtered[selectedIndex]);
        onClose();
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Product Catalog & Barcode Search (F3)"
      width="max-w-2xl"
      icon={<Search className="w-5 h-5 text-blue-400" />}
    >
      <div className="space-y-3" onKeyDown={handleKeyDown}>
        {/* Search Input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search by name, SKU, barcode, HSN..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500"
          />
        </div>

        {/* Results List */}
        <div className="border border-slate-800 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No products found matching &ldquo;{query}&rdquo;
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
                <tr>
                  <th className="py-2 px-3">Item</th>
                  <th className="py-2 px-3">HSN</th>
                  <th className="py-2 px-3">Tax</th>
                  <th className="py-2 px-3 text-right">Price</th>
                  <th className="py-2 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        onSelectItem(item);
                        onClose();
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-600/20' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-100">{item.name}</div>
                        <div className="flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
                          <span>SKU: {item.sku}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <Tag className="w-2.5 h-2.5" />
                            {item.barcode}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-400">{item.hsn}</td>
                      <td className="py-2 px-3 font-mono text-slate-300">
                        {(item.tax_rate_bps / 100).toFixed(0)}%
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-100">
                        {formatPaise(item.base_price_paise)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-semibold inline-flex items-center space-x-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 select-none">
          <div>Use Up/Down arrows to navigate, Enter to add</div>
          <div>{filtered.length} products</div>
        </div>
      </div>
    </Modal>
  );
};
