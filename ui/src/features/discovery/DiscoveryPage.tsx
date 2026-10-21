// ui/src/features/discovery/DiscoveryPage.tsx
// Complete Discovery Hub workspace integrating FilterBar, FacetSidebar, Grid, Scanner, and Hotkeys

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDiscoveryStore, discoveryStore } from './store';
import { DiscoveryGrid } from './DiscoveryGrid';
import { FilterBar } from './FilterBar';
import { FacetSidebar } from './FacetSidebar';
import { useScannerDetect } from './useScannerDetect';
import { useDiscoveryHotkeys } from './hotkeys';
import { Preset, ProductDiscoveryItem } from './types';
import { formatBp, formatDay, formatDaysX10, formatPaise, formatQtyMilli } from './format';
import { exportDiscoveryProducts, fetchDaySummaryText } from './api';
import { ShieldAlert, X } from 'lucide-react';

interface DiscoveryPageProps {
  vertical?: string;
  onNavigateSellGraph?: () => void;
}

export const DiscoveryPage: React.FC<DiscoveryPageProps> = ({
  vertical = 'retail',
  onNavigateSellGraph,
}) => {
  const store = useDiscoveryStore();
  const [selectedProduct, setSelectedProduct] = useState<ProductDiscoveryItem | null>(null);
  const [searchInput, setSearchInput] = useState(store.query.text || '');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initialize store with active vertical
  useEffect(() => {
    discoveryStore.loadInitial(vertical);
  }, [vertical]);

  // Debounced search input handler (80ms per task prompt)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (store.query.text || '')) {
        discoveryStore.setFilter({ text: searchInput.trim() || undefined });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [searchInput, store.query.text]);

  // Barcode Hardware Scanner Detection (immediate, without debounce)
  useScannerDetect({
    onScan: (barcode) => {
      setSearchInput(barcode);
      discoveryStore.setFilter({ text: barcode });
    },
  });

  // Cycle states for hotkeys Alt+2 and Alt+3
  const [expiringCycle, setExpiringCycle] = useState<0 | 1 | 2>(0);
  const [deadCycle, setDeadCycle] = useState<0 | 1 | 2>(0);

  const handleCycleExpiring = () => {
    const cycleMap: Array<Preset> = ['expiring30', 'expiring60', 'expiring90'];
    const nextIdx = (expiringCycle + 1) % 3 as 0 | 1 | 2;
    setExpiringCycle(nextIdx);
    discoveryStore.applyPreset(cycleMap[expiringCycle]);
  };

  const handleCycleDeadStock = () => {
    const cycleMap: Array<Preset> = ['dead30', 'dead60', 'dead90'];
    const nextIdx = (deadCycle + 1) % 3 as 0 | 1 | 2;
    setDeadCycle(nextIdx);
    discoveryStore.applyPreset(cycleMap[deadCycle]);
  };

  const handleClearFilterStep = () => {
    const q = store.query;
    if (searchInput) {
      setSearchInput('');
      discoveryStore.setFilter({ text: undefined });
    } else if (q.preset) {
      discoveryStore.applyPreset(undefined);
    } else if (q.brandIds && q.brandIds.length > 0) {
      discoveryStore.setFilter({ brandIds: [] });
    } else if (q.supplierIds && q.supplierIds.length > 0) {
      discoveryStore.setFilter({ supplierIds: [] });
    } else if (q.sellPaise || q.marginBp || q.stockMilli || q.expiryDay) {
      discoveryStore.setFilter({
        sellPaise: undefined,
        marginBp: undefined,
        stockMilli: undefined,
        expiryDay: undefined,
      });
    } else {
      discoveryStore.reset();
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExportCsv = async () => {
    showToast('Exporting Discovery CSV...');
    try {
      const res = await exportDiscoveryProducts(store.query, vertical);
      showToast(`Exported CSV successfully to ${res.path}`);
    } catch (e) {
      showToast(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCopyDaySummary = async () => {
    showToast('Generating WhatsApp summary...');
    try {
      const summary = await fetchDaySummaryText(vertical);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(summary);
      }
      showToast('Day summary copied to clipboard! Ready to paste into WhatsApp.');
    } catch (e) {
      showToast(`Summary failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Keyboard Shortcuts Hook
  useDiscoveryHotkeys({
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onApplyFastMovers: () => {
      discoveryStore.setFilter({
        preset: 'fast',
        sort: [{ key: 'velocity', dir: 'desc' }],
      });
    },
    onCycleExpiring: handleCycleExpiring,
    onCycleDeadStock: handleCycleDeadStock,
    onApplyBelowReorder: () => discoveryStore.applyPreset('belowReorder'),
    onNavigateSellGraph: () => {
      if (onNavigateSellGraph) {
        onNavigateSellGraph();
      } else {
        showToast('Navigating to Sell Graph view...');
      }
    },
    onToggleBrandFilter: () => setIsSidebarOpen(true),
    onToggleSupplierFilter: () => setIsSidebarOpen(true),
    onToggleDateFilter: () => setIsSidebarOpen(true),
    onClearFilterStep: handleClearFilterStep,
    onTriggerExport: handleExportCsv,
  });

  const handleSelectProduct = useCallback((product: ProductDiscoveryItem) => {
    setSelectedProduct(product);
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 overflow-hidden relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs px-4 py-2 rounded-lg shadow-xl font-medium flex items-center gap-2 animate-in fade-in duration-150">
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-blue-200 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Filter Bar Toolbar */}
      <FilterBar
        query={store.query}
        facets={store.facets}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        onClearSearch={() => {
          setSearchInput('');
          discoveryStore.setFilter({ text: undefined });
        }}
        onSelectPreset={(p) => discoveryStore.applyPreset(p)}
        onRemoveFilter={(partial) => discoveryStore.setFilter(partial)}
        onClearAll={() => {
          setSearchInput('');
          discoveryStore.reset();
        }}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onExportClick={handleExportCsv}
        vertical={vertical}
        totalItems={store.totalCapped}
        searchInputRef={searchInputRef}
      />

      {/* Main Layout Area: Facet Sidebar + Grid */}
      <div className="flex-1 flex overflow-hidden relative">
        <FacetSidebar
          query={store.query}
          facets={store.facets}
          onFilterChange={(partial) => discoveryStore.setFilter(partial)}
          onReset={() => discoveryStore.reset()}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

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
