// ui/src/features/discovery/ActivePills.tsx
// Active filter pill badges with one-click dismiss and 'Clear all'

import React from 'react';
import { DiscoveryQuery, Facets } from './types';
import { formatBp, formatDay, formatPaise, formatQtyMilli } from './format';
import { X } from 'lucide-react';

interface ActivePillsProps {
  query: DiscoveryQuery;
  facets: Facets | null;
  onRemoveFilter: (partial: Partial<DiscoveryQuery>) => void;
  onClearAll: () => void;
}

export const ActivePills: React.FC<ActivePillsProps> = ({
  query,
  facets,
  onRemoveFilter,
  onClearAll,
}) => {
  const pills: Array<{ id: string; label: string; onRemove: () => void }> = [];

  // Text search pill
  if (query.text) {
    pills.push({
      id: 'text',
      label: `"${query.text}"`,
      onRemove: () => onRemoveFilter({ text: undefined }),
    });
  }

  // Preset pill
  if (query.preset) {
    pills.push({
      id: 'preset',
      label: `Preset: ${query.preset}`,
      onRemove: () => onRemoveFilter({ preset: undefined }),
    });
  }

  // Brands
  if (query.brandIds && query.brandIds.length > 0) {
    for (const bId of query.brandIds) {
      const match = facets?.brands.find((b) => b.id === bId.toString());
      pills.push({
        id: `brand-${bId}`,
        label: `Brand: ${match?.label || bId}`,
        onRemove: () =>
          onRemoveFilter({
            brandIds: query.brandIds?.filter((id) => id !== bId),
          }),
      });
    }
  }

  // Suppliers
  if (query.supplierIds && query.supplierIds.length > 0) {
    for (const sId of query.supplierIds) {
      const match = facets?.suppliers.find((s) => s.id === sId.toString());
      pills.push({
        id: `supp-${sId}`,
        label: `Supplier: ${match?.label || sId}`,
        onRemove: () =>
          onRemoveFilter({
            supplierIds: query.supplierIds?.filter((id) => id !== sId),
          }),
      });
    }
  }

  // Price range
  if (query.sellPaise) {
    const minText = query.sellPaise.min !== undefined ? formatPaise(query.sellPaise.min) : '₹0';
    const maxText = query.sellPaise.max !== undefined ? formatPaise(query.sellPaise.max) : '∞';
    pills.push({
      id: 'sellPaise',
      label: `Price: ${minText} - ${maxText}`,
      onRemove: () => onRemoveFilter({ sellPaise: undefined }),
    });
  }

  // Margin range
  if (query.marginBp) {
    const minText = query.marginBp.min !== undefined ? formatBp(query.marginBp.min) : '-∞';
    const maxText = query.marginBp.max !== undefined ? formatBp(query.marginBp.max) : '+∞';
    pills.push({
      id: 'marginBp',
      label: `Margin: ${minText} - ${maxText}`,
      onRemove: () => onRemoveFilter({ marginBp: undefined }),
    });
  }

  // Expiry range
  if (query.expiryDay) {
    const minText = query.expiryDay.min !== undefined ? formatDay(query.expiryDay.min) : '—';
    const maxText = query.expiryDay.max !== undefined ? formatDay(query.expiryDay.max) : '—';
    pills.push({
      id: 'expiryDay',
      label: `Expiry: ${minText} to ${maxText}`,
      onRemove: () => onRemoveFilter({ expiryDay: undefined }),
    });
  }

  // Stock range
  if (query.stockMilli) {
    const minText = query.stockMilli.min !== undefined ? formatQtyMilli(query.stockMilli.min) : '0';
    const maxText = query.stockMilli.max !== undefined ? formatQtyMilli(query.stockMilli.max) : '∞';
    pills.push({
      id: 'stockMilli',
      label: `Stock: ${minText} - ${maxText}`,
      onRemove: () => onRemoveFilter({ stockMilli: undefined }),
    });
  }

  if (pills.length === 0) return null;

  return (
    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1 px-4 py-1.5 bg-slate-900/60 border-b border-slate-800 text-xs">
      <span className="text-slate-500 text-[11px] font-medium mr-1">Active:</span>
      {pills.map((pill) => (
        <span
          key={pill.id}
          className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-200 text-[11px]"
        >
          <span>{pill.label}</span>
          <button
            onClick={pill.onRemove}
            className="text-slate-400 hover:text-white p-0.5"
            title="Remove filter"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="text-[11px] text-rose-400 hover:text-rose-300 font-medium ml-2 underline cursor-pointer"
      >
        Clear all
      </button>
    </div>
  );
};
