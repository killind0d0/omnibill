// ui/src/components/pos/PredictiveSearchDropdown.tsx
// High-velocity real-time predictive product suggestions for fast counter billing

import React, { useEffect, useMemo, useState } from 'react';
import { Package, Sparkles, Tag, ArrowRight, CornerDownLeft, AlertCircle } from 'lucide-react';
import { ResourceItem } from '../../types/pos';
import { formatPaise, parseQtyToMilli } from '../../lib/tax';

export interface SearchableItem {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  hsn?: string;
  hsn_sac?: string;
  unit: string;
  tax_rate_bps: number;
  base_price_paise: number;
  cost_price_paise?: number;
  stock_milli?: number;
  mrp_paise?: number;
  [key: string]: any;
}

interface PredictiveSearchDropdownProps<T extends SearchableItem> {
  query: string;
  products: T[];
  isOpen: boolean;
  onSelect: (product: T, quantityMilli: number) => void;
  onClose: () => void;
  anchorPosition?: 'top' | 'bottom';
}

export function PredictiveSearchDropdown<T extends SearchableItem>({
  query,
  products,
  isOpen,
  onSelect,
  onClose,
  anchorPosition = 'bottom',
}: PredictiveSearchDropdownProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Parse quantity multiplier e.g. "3*milk" or "2*parle" or just "milk"
  const { quantityMilli, searchStr } = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.includes('*')) {
      const parts = trimmed.split('*');
      const qtyStr = parts[0];
      const parsedQty = parseQtyToMilli(qtyStr);
      const s = parts.slice(1).join('*').trim();
      return {
        quantityMilli: parsedQty > 0 ? parsedQty : 1000,
        searchStr: s,
      };
    }
    return {
      quantityMilli: 1000,
      searchStr: trimmed,
    };
  }, [query]);

  // Match and score products by relevance
  const matchedProducts = useMemo(() => {
    const q = searchStr.toLowerCase().trim();
    if (!q) {
      // If query is empty or just "3*", return top 6 catalog items
      return products.slice(0, 6);
    }

    return products
      .filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        const skuMatch = p.sku ? p.sku.toLowerCase().includes(q) : false;
        const barcodeMatch = p.barcode ? p.barcode.toLowerCase().includes(q) : false;
        const hsnVal = p.hsn || p.hsn_sac;
        const hsnMatch = hsnVal ? hsnVal.toLowerCase().includes(q) : false;
        return nameMatch || skuMatch || barcodeMatch || hsnMatch;
      })
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aStartsWith = aName.startsWith(q);
        const bStartsWith = bName.startsWith(q);

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        const aSkuStarts =
          (a.sku && a.sku.toLowerCase().startsWith(q)) ||
          (a.barcode && a.barcode.toLowerCase().startsWith(q));
        const bSkuStarts =
          (b.sku && b.sku.toLowerCase().startsWith(q)) ||
          (b.barcode && b.barcode.toLowerCase().startsWith(q));

        if (aSkuStarts && !bSkuStarts) return -1;
        if (!aSkuStarts && bSkuStarts) return 1;

        return aName.localeCompare(bName);
      })
      .slice(0, 7);
  }, [searchStr, products]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [matchedProducts.length, searchStr]);

  // Keyboard navigation listener (ArrowUp, ArrowDown, Enter, Esc, Tab)
  useEffect(() => {
    if (!isOpen || matchedProducts.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % matchedProducts.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + matchedProducts.length) % matchedProducts.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (matchedProducts.length > 0 && selectedIndex < matchedProducts.length) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(matchedProducts[selectedIndex], quantityMilli);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, matchedProducts, selectedIndex, quantityMilli, onSelect, onClose]);

  if (!isOpen || matchedProducts.length === 0) {
    return null;
  }

  // Highlight matched substrings helper
  const highlightMatch = (text: string, queryStr: string) => {
    if (!queryStr) return <span>{text}</span>;
    const lowerText = text.toLowerCase();
    const lowerQ = queryStr.toLowerCase();
    const index = lowerText.indexOf(lowerQ);
    if (index === -1) return <span>{text}</span>;

    const before = text.substring(0, index);
    const match = text.substring(index, index + queryStr.length);
    const after = text.substring(index + queryStr.length);

    return (
      <span>
        {before}
        <span className="bg-yellow-400/30 text-yellow-200 font-extrabold underline rounded-px px-0.5">
          {match}
        </span>
        {after}
      </span>
    );
  };

  const qtyMultiplier = quantityMilli / 1000;

  return (
    <div
      className={`absolute left-0 right-0 z-50 bg-slate-900/98 backdrop-blur-md border border-blue-500/50 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
        anchorPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-1.5'
      }`}
      style={{ maxHeight: '340px' }}
    >
      {/* Header bar indicating search match count & quantity status */}
      <div className="px-3 py-1.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div className="flex items-center space-x-1.5">
          <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
          <span className="font-semibold text-slate-200">
            {matchedProducts.length} Product{matchedProducts.length > 1 ? 's' : ''} Found
          </span>
          {searchStr && (
            <span className="text-slate-500 font-mono">matching "{searchStr}"</span>
          )}
        </div>

        {qtyMultiplier !== 1 && (
          <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono font-bold text-[10px]">
            <span>Adding {qtyMultiplier}x Units</span>
          </div>
        )}

        <div className="flex items-center space-x-1 text-[10px] text-slate-400 hidden sm:flex">
          <kbd className="px-1 py-0.2 bg-slate-800 border border-slate-700 rounded text-slate-300">↑↓</kbd>
          <span>Navigate</span>
          <kbd className="px-1 py-0.2 bg-slate-800 border border-slate-700 rounded text-slate-300 ml-1.5">↵ Enter</kbd>
          <span>Select</span>
          <kbd className="px-1 py-0.2 bg-slate-800 border border-slate-700 rounded text-slate-300 ml-1.5">Esc</kbd>
          <span>Close</span>
        </div>
      </div>

      {/* Suggested Products List */}
      <div className="overflow-y-auto divide-y divide-slate-800/60 max-h-[280px]">
        {matchedProducts.map((product, idx) => {
          const isSelected = idx === selectedIndex;
          const unitPricePaise = product.base_price_paise;
          const lineTotalPaise = Math.round((unitPricePaise * quantityMilli) / 1000);
          const hasStockInfo = product.stock_milli !== undefined;
          const inStock = hasStockInfo ? product.stock_milli! / 1000 : null;
          const isLowStock = inStock !== null && inStock > 0 && inStock < 10;
          const isOutOfStock = inStock !== null && inStock <= 0;

          return (
            <div
              key={product.id}
              onClick={() => onSelect(product, quantityMilli)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`px-3 py-2.5 flex items-center justify-between cursor-pointer transition-all ${
                isSelected
                  ? 'bg-blue-600/25 border-l-4 border-blue-500 text-white pl-2.5'
                  : 'hover:bg-slate-800/50 text-slate-200'
              }`}
            >
              {/* Product Info */}
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-xs text-slate-100 truncate">
                    {highlightMatch(product.name, searchStr)}
                  </span>

                  {/* Stock pill */}
                  {hasStockInfo && isOutOfStock ? (
                    <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 font-medium">
                      Out of Stock
                    </span>
                  ) : hasStockInfo && isLowStock ? (
                    <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                      Low: {inStock} {product.unit}
                    </span>
                  ) : hasStockInfo && inStock !== null ? (
                    <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                      {inStock} {product.unit}
                    </span>
                  ) : null}

                  {/* GST rate */}
                  <span className="shrink-0 px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                    {product.tax_rate_bps / 100}% GST
                  </span>
                </div>

                <div className="flex items-center space-x-3 mt-1 text-[11px] text-slate-400 font-mono">
                  <span>SKU: {highlightMatch(product.sku, searchStr)}</span>
                  {product.barcode && <span>Barcode: {highlightMatch(product.barcode, searchStr)}</span>}
                  {(product.hsn || product.hsn_sac) && <span>HSN: {product.hsn || product.hsn_sac}</span>}
                </div>
              </div>

              {/* Price & Action */}
              <div className="flex items-center space-x-3 shrink-0 text-right">
                <div>
                  <div className="text-sm font-bold text-white font-mono">
                    {formatPaise(lineTotalPaise)}
                  </div>
                  {qtyMultiplier !== 1 && (
                    <div className="text-[10px] text-slate-400 font-mono">
                      {qtyMultiplier} x {formatPaise(unitPricePaise)}
                    </div>
                  )}
                </div>

                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                    isSelected
                      ? 'bg-blue-500 text-white shadow-md shadow-blue-500/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <CornerDownLeft className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
