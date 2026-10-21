// ui/src/features/discovery/DiscoveryPage.tsx
// Core Product Discovery Hub workspace page

import React, { useEffect, useState, useCallback } from 'react';
import { useDiscoveryStore, discoveryStore } from './store';
import { DiscoveryGrid } from './DiscoveryGrid';
import { Preset, ProductDiscoveryItem } from './types';
import { formatBp, formatDay, formatDaysX10, formatPaise, formatQtyMilli } from './format';
import {
  Search,
  RotateCcw,
  SlidersHorizontal,
  Package,
  Layers,
  Sparkles,
  TrendingUp,
  Clock,
  AlertTriangle,
  X,
  Tag,
  ShieldAlert,
} from 'lucide-react';

interface DiscoveryPageProps {
  vertical?: string;
}

export const DiscoveryPage: React.FC<DiscoveryPageProps> = ({ vertical = 'retail' }) => {
  const store = useDiscoveryStore();
  const [selectedProduct, setSelectedProduct] = useState<ProductDiscoveryItem | null>(null);
  const [searchInput, setSearchInput] = useState(store.query.text || '');

  // Initialize store with active vertical
  useEffect(() => {
    discoveryStore.loadInitial(vertical);
  }, [vertical]);

  // Handle live search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (store.query.text || '')) {
        discoveryStore.setFilter({ text: searchInput.trim() || undefined });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput, store.query.text]);

  const handlePresetClick = (p: Preset) => {
    if (store.query.preset === p) {
      discoveryStore.applyPreset(undefined);
    } else {
      discoveryStore.applyPreset(p);
    }
  };

  const handleSelectProduct = useCallback((product: ProductDiscoveryItem) => {
    setSelectedProduct(product);
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 overflow-hidden">
      {/* Top Controls Toolbar */}
      <header className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        {/* Search Bar */}
        <div className="flex items-center space-x-2 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by product name, SKU, or scan barcode..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Quick Presets Filter Tags */}
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs py-0.5">
          <button
            onClick={() => handlePresetClick('fast')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              store.query.preset === 'fast'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <TrendingUp className="w-3 h-3 text-blue-300" /> Fast Movers
          </button>

          <button
            onClick={() => handlePresetClick('slow')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              store.query.preset === 'slow'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Clock className="w-3 h-3 text-amber-300" /> Slow Movers
          </button>

          <button
            onClick={() => handlePresetClick('dead60')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              store.query.preset === 'dead60'
                ? 'bg-rose-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <AlertTriangle className="w-3 h-3 text-rose-300" /> Dead Stock 60d
          </button>

          <button
            onClick={() => handlePresetClick('expiring60')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              store.query.preset === 'expiring60'
                ? 'bg-purple-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Sparkles className="w-3 h-3 text-purple-300" /> Expiring 60d
          </button>

          <button
            onClick={() => handlePresetClick('belowReorder')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition cursor-pointer flex items-center gap-1 ${
              store.query.preset === 'belowReorder'
                ? 'bg-orange-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Package className="w-3 h-3 text-orange-300" /> Below Reorder
          </button>
        </div>

        {/* Total Count and Reset Actions */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-xs text-slate-400 font-mono">
            {store.totalCapped > 10000 ? '10,000+ items' : `${store.totalCapped} items`}
          </span>

          <button
            onClick={() => {
              setSearchInput('');
              discoveryStore.reset();
            }}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
            title="Reset all filters"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </header>

      {/* Main Grid View */}
      <div className="flex-1 flex overflow-hidden relative">
        <DiscoveryGrid
          items={store.items}
          sort={store.query.sort || []}
          onToggleSort={(k, additive) => discoveryStore.toggleSort(k, additive)}
          onLoadMore={() => discoveryStore.loadMore()}
          isLoadingMore={store.status === 'loadingMore'}
          onSelectProduct={handleSelectProduct}
        />

        {/* Selected Product Detail Flyout Drawer */}
        {selectedProduct && (
          <div className="w-80 border-l border-slate-800 bg-slate-900 p-4 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200">
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">
                    Product Master
                  </span>
                  <h3 className="text-sm font-bold text-white mt-0.5">
                    {selectedProduct.name}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    SKU: {selectedProduct.sku}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedProduct(null)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {selectedProduct.barcode && (
                <div className="mt-3 p-2 bg-slate-950 rounded border border-slate-800 text-xs font-mono text-slate-300 flex items-center justify-between">
                  <span>Barcode</span>
                  <span className="text-blue-300 font-bold">{selectedProduct.barcode}</span>
                </div>
              )}

              {/* Financial Metrics */}
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Selling Price</span>
                  <span className="font-bold text-white font-mono">
                    {formatPaise(selectedProduct.sellPaise)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Average Unit Cost</span>
                  <span className="font-bold text-slate-300 font-mono">
                    {formatPaise(selectedProduct.avgCostPaise)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Gross Margin</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {formatBp(selectedProduct.marginBp)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Current Stock</span>
                  <span className="font-bold text-white font-mono">
                    {formatQtyMilli(selectedProduct.stockMilli)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Stock Valuation</span>
                  <span className="font-bold text-slate-300 font-mono">
                    {formatPaise(selectedProduct.stockValuePaise)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">30-Day Velocity</span>
                  <span className="font-bold text-blue-300 font-mono">
                    {formatQtyMilli(selectedProduct.qty30Milli)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Runout Forecast</span>
                  <span className="font-bold text-amber-300 font-mono">
                    {formatDaysX10(selectedProduct.runoutDaysX10)}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Earliest Expiry</span>
                  <span className="font-bold text-purple-300 font-mono">
                    {selectedProduct.earliestExpiryDay < 99999999
                      ? formatDay(selectedProduct.earliestExpiryDay)
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-xs py-1 border-b border-slate-800">
                  <span className="text-slate-400">Annualized GMROI</span>
                  <span className="font-bold text-cyan-300 font-mono">
                    {formatBp(selectedProduct.gmroiBp)}
                  </span>
                </div>
              </div>

              {selectedProduct.isCritical && (
                <div className="mt-4 p-2.5 bg-rose-950/60 border border-rose-800 rounded-lg flex items-center space-x-2 text-rose-300 text-xs">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>Marked as Critical Hospital Inventory. Protected from dead stock liquidation.</span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedProduct(null)}
                className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
