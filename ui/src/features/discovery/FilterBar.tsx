// ui/src/features/discovery/FilterBar.tsx
// Discovery Filter Toolbar with search, scanner support, quick tags, and sidebar toggling

import React from 'react';
import { DiscoveryQuery, Facets, Preset } from './types';
import { QuickTags } from './QuickTags';
import { ActivePills } from './ActivePills';
import {
  Download,
  Filter,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

interface FilterBarProps {
  query: DiscoveryQuery;
  facets: Facets | null;
  searchInput: string;
  onSearchChange: (val: string) => void;
  onClearSearch: () => void;
  onSelectPreset: (preset?: Preset) => void;
  onRemoveFilter: (partial: Partial<DiscoveryQuery>) => void;
  onClearAll: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onExportClick: () => void;
  vertical?: string;
  totalItems: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  query,
  facets,
  searchInput,
  onSearchChange,
  onClearSearch,
  onSelectPreset,
  onRemoveFilter,
  onClearAll,
  isSidebarOpen,
  onToggleSidebar,
  onExportClick,
  vertical = 'retail',
  totalItems,
  searchInputRef,
}) => {
  // Count active filters
  let activeFilterCount = 0;
  if (query.brandIds && query.brandIds.length > 0) activeFilterCount += query.brandIds.length;
  if (query.supplierIds && query.supplierIds.length > 0) activeFilterCount += query.supplierIds.length;
  if (query.categoryIds && query.categoryIds.length > 0) activeFilterCount += query.categoryIds.length;
  if (query.taxBp && query.taxBp.length > 0) activeFilterCount += query.taxBp.length;
  if (query.sellPaise) activeFilterCount++;
  if (query.marginBp) activeFilterCount++;
  if (query.stockMilli) activeFilterCount++;
  if (query.expiryDay) activeFilterCount++;
  if (query.lastSoldDay) activeFilterCount++;
  if (query.receivedDay) activeFilterCount++;
  if (query.abc && query.abc.length > 0) activeFilterCount += query.abc.length;

  return (
    <div className="flex flex-col border-b border-slate-800 bg-slate-900 shrink-0">
      {/* Top Controls Row */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Toggle Sidebar & Search Input */}
        <div className="flex items-center space-x-2 flex-1 max-w-lg">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer shrink-0 ${
              isSidebarOpen || activeFilterCount > 0
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300 hover:bg-blue-600/30'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            title="Toggle filter sidebar (Alt+F)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search product name, SKU, or scan barcode (/)..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={onClearSearch}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-2 text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Quick Tags Presets */}
        <div className="hidden lg:flex flex-1 overflow-x-auto justify-center">
          <QuickTags
            vertical={vertical}
            activePreset={query.preset}
            onSelectPreset={onSelectPreset}
          />
        </div>

        {/* Actions: Export, Count, Reset */}
        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-xs text-slate-400 font-mono mr-1">
            {totalItems > 10000 ? '10,000+ items' : `${totalItems} items`}
          </span>

          <button
            type="button"
            onClick={onExportClick}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition cursor-pointer"
            title="Export view (Ctrl+E)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Export</span>
          </button>

          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs transition cursor-pointer"
            title="Clear all filters (Esc)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Tags for smaller screens */}
      <div className="lg:hidden px-4 pb-2">
        <QuickTags
          vertical={vertical}
          activePreset={query.preset}
          onSelectPreset={onSelectPreset}
        />
      </div>

      {/* Active Filter Pills Row */}
      <ActivePills
        query={query}
        facets={facets}
        onRemoveFilter={onRemoveFilter}
        onClearAll={onClearAll}
      />
    </div>
  );
};
