// ui/src/features/discovery/QuickTags.tsx
// Vertical-aware quick tag chips for instant preset filtering

import React from 'react';
import { Preset } from './types';

export interface PresetTagConfig {
  preset: Preset;
  label: string;
  colorClass: string;
}

export const presetsByVertical: Record<string, PresetTagConfig[]> = {
  retail: [
    { preset: 'fast', label: 'Fast Movers', colorClass: 'bg-blue-600 text-white' },
    { preset: 'slow', label: 'Slow Movers', colorClass: 'bg-amber-600 text-white' },
    { preset: 'dead30', label: 'Dead 30d', colorClass: 'bg-rose-700 text-white' },
    { preset: 'dead60', label: 'Dead 60d', colorClass: 'bg-rose-600 text-white' },
    { preset: 'expiring30', label: 'Expiring 30d', colorClass: 'bg-purple-600 text-white' },
    { preset: 'expiring60', label: 'Expiring 60d', colorClass: 'bg-purple-500 text-white' },
    { preset: 'belowReorder', label: 'Below Reorder', colorClass: 'bg-orange-600 text-white' },
    { preset: 'out', label: 'Out of Stock', colorClass: 'bg-red-700 text-white' },
  ],
  hospital: [
    { preset: 'fast', label: 'Fast Velocity', colorClass: 'bg-blue-600 text-white' },
    { preset: 'expiring30', label: 'Critical Expiry 30d', colorClass: 'bg-purple-600 text-white' },
    { preset: 'expiring60', label: 'Expiring 60d', colorClass: 'bg-purple-500 text-white' },
    { preset: 'expiring90', label: 'Expiring 90d', colorClass: 'bg-purple-400 text-white' },
    { preset: 'belowReorder', label: 'Stockout Danger', colorClass: 'bg-orange-600 text-white' },
    { preset: 'out', label: 'Depleted Drugs', colorClass: 'bg-red-700 text-white' },
    { preset: 'dead60', label: 'Dead Stock 60d', colorClass: 'bg-rose-600 text-white' },
  ],
  wholesale: [
    { preset: 'slow', label: 'Slow Movers', colorClass: 'bg-amber-600 text-white' },
    { preset: 'overstock', label: 'Overstock Bulks', colorClass: 'bg-yellow-600 text-white' },
    { preset: 'fast', label: 'High Velocity', colorClass: 'bg-blue-600 text-white' },
    { preset: 'dead60', label: 'Dormant Cartons 60d', colorClass: 'bg-rose-600 text-white' },
    { preset: 'belowReorder', label: 'Reorder Needed', colorClass: 'bg-orange-600 text-white' },
    { preset: 'out', label: 'Zero Balance', colorClass: 'bg-red-700 text-white' },
  ],
};

interface QuickTagsProps {
  vertical?: string;
  activePreset?: Preset;
  onSelectPreset: (preset?: Preset) => void;
}

export const QuickTags: React.FC<QuickTagsProps> = ({
  vertical = 'retail',
  activePreset,
  onSelectPreset,
}) => {
  const configs = presetsByVertical[vertical.toLowerCase()] || presetsByVertical.retail;

  return (
    <div className="flex items-center space-x-1.5 overflow-x-auto py-1 text-xs">
      {configs.map((cfg) => {
        const isActive = activePreset === cfg.preset;
        return (
          <button
            key={cfg.preset}
            type="button"
            onClick={() => onSelectPreset(isActive ? undefined : cfg.preset)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition cursor-pointer ${
              isActive
                ? cfg.colorClass
                : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
};
