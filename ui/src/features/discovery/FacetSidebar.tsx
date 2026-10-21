// ui/src/features/discovery/FacetSidebar.tsx
// Faceted filter sidebar with live facet counts and range sliders

import React from 'react';
import { DiscoveryQuery, Facets } from './types';
import { MultiSelect } from './MultiSelect';
import { RangeInput } from './RangeInput';
import { DateRange } from './DateRange';
import { Filter, RotateCcw } from 'lucide-react';

interface FacetSidebarProps {
  query: DiscoveryQuery;
  facets: Facets | null;
  onFilterChange: (partial: Partial<DiscoveryQuery>) => void;
  onReset: () => void;
  isOpen: boolean;
  onClose: () => void;
  today?: number;
}

export const FacetSidebar: React.FC<FacetSidebarProps> = ({
  query,
  facets,
  onFilterChange,
  onReset,
  isOpen,
  onClose,
  today = 20747,
}) => {
  if (!isOpen) return null;

  const brandOptions = (facets?.brands || []).map((b) => ({
    id: parseInteger(b.id),
    label: b.label,
    count: b.count,
  }));

  const supplierOptions = (facets?.suppliers || []).map((s) => ({
    id: parseInteger(s.id),
    label: s.label,
    count: s.count,
  }));

  const categoryOptions = (facets?.categories || []).map((c) => ({
    id: parseInteger(c.id),
    label: c.label,
    count: c.count,
  }));

  const taxOptions = (facets?.taxBp || []).map((t) => ({
    id: parseInteger(t.id),
    label: `${parseInteger(t.id) / 100}% GST`,
    count: t.count,
  }));

  const handleAbcToggle = (cls: number) => {
    const current = query.abc || [];
    const next = current.includes(cls) ? current.filter((c) => c !== cls) : [...current, cls];
    onFilterChange({ abc: next });
  };

  return (
    <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col h-full shrink-0 overflow-hidden">
      {/* Sidebar Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-white uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5 text-blue-400" />
          <span>Faceted Filters</span>
        </div>
        <button
          onClick={onReset}
          className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          title="Reset filters"
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Filter Sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ABC Class Filter */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">ABC Classification</span>
          <div className="flex items-center space-x-2">
            {[
              { cls: 1, label: 'Class A (80% Rev)', color: 'text-emerald-400' },
              { cls: 2, label: 'Class B (15% Rev)', color: 'text-blue-400' },
              { cls: 3, label: 'Class C (5% Rev)', color: 'text-slate-400' },
            ].map(({ cls, label, color }) => {
              const isChecked = (query.abc || []).includes(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => handleAbcToggle(cls)}
                  className={`px-2 py-1 rounded text-[11px] font-bold border transition cursor-pointer ${
                    isChecked
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {label[6]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Brands MultiSelect */}
        <MultiSelect
          label="Brands"
          options={brandOptions}
          selected={query.brandIds || []}
          onChange={(brandIds) => onFilterChange({ brandIds: brandIds as number[] })}
          placeholder="All Brands"
        />

        {/* Categories MultiSelect */}
        <MultiSelect
          label="Categories"
          options={categoryOptions}
          selected={query.categoryIds || []}
          onChange={(categoryIds) => onFilterChange({ categoryIds: categoryIds as number[] })}
          placeholder="All Categories"
        />

        {/* Suppliers MultiSelect */}
        <MultiSelect
          label="Suppliers"
          options={supplierOptions}
          selected={query.supplierIds || []}
          onChange={(supplierIds) => onFilterChange({ supplierIds: supplierIds as number[] })}
          placeholder="All Suppliers"
        />

        {/* Tax Rates MultiSelect */}
        <MultiSelect
          label="Tax Slab"
          options={taxOptions}
          selected={query.taxBp || []}
          onChange={(taxBp) => onFilterChange({ taxBp: taxBp as number[] })}
          placeholder="All GST Slabs"
        />

        <div className="border-t border-slate-800 pt-3 space-y-3">
          {/* Price Range */}
          <RangeInput
            label="Selling Price Range"
            type="money"
            value={query.sellPaise}
            onChange={(sellPaise) => onFilterChange({ sellPaise })}
            prefix="₹"
          />

          {/* Margin Range */}
          <RangeInput
            label="Gross Margin Range"
            type="margin"
            value={query.marginBp}
            onChange={(marginBp) => onFilterChange({ marginBp })}
            suffix="%"
          />

          {/* Stock Quantity Range */}
          <RangeInput
            label="Current Stock Units"
            type="integer"
            value={query.stockMilli}
            onChange={(stockMilli) => onFilterChange({ stockMilli })}
          />
        </div>

        <div className="border-t border-slate-800 pt-3 space-y-3">
          {/* Expiry Date Range */}
          <DateRange
            label="Earliest Expiry Date"
            value={query.expiryDay}
            onChange={(expiryDay) => onFilterChange({ expiryDay })}
            today={today}
          />

          {/* Last Sold Date Range */}
          <DateRange
            label="Last Sold Date"
            value={query.lastSoldDay}
            onChange={(lastSoldDay) => onFilterChange({ lastSoldDay })}
            today={today}
          />

          {/* Last Received Date Range */}
          <DateRange
            label="Last Received Date"
            value={query.receivedDay}
            onChange={(receivedDay) => onFilterChange({ receivedDay })}
            today={today}
          />
        </div>
      </div>
    </aside>
  );
};

function parseInteger(s: string): number {
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      val = val * 10 + (code - 48);
    }
  }
  return val;
}
