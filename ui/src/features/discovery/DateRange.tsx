// ui/src/features/discovery/DateRange.tsx
// Integer date range selector with standard business presets

import React, { useState } from 'react';
import { civilFromDays, formatDay } from './format';
import { Range } from './types';
import { Calendar } from 'lucide-react';

interface DateRangeProps {
  label: string;
  value?: Range;
  onChange: (range?: Range) => void;
  today?: number;
}

export const DateRange: React.FC<DateRangeProps> = ({
  label,
  value,
  onChange,
  today = 20747,
}) => {
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    if (preset === '7') {
      onChange({ min: today - 7, max: today });
    } else if (preset === '30') {
      onChange({ min: today - 30, max: today });
    } else if (preset === '90') {
      onChange({ min: today - 90, max: today });
    } else if (preset === 'month') {
      const { day: d } = civilFromDays(today);
      const startOfMonth = today - d + 1;
      onChange({ min: startOfMonth, max: today });
    } else if (preset === 'clear') {
      setActivePreset(null);
      onChange(undefined);
    }
  };

  return (
    <div className="flex flex-col space-y-1.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-400 font-medium flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5 text-slate-500" /> {label}
        </span>
        {value && (
          <button
            onClick={() => applyPreset('clear')}
            className="text-[10px] text-slate-500 hover:text-rose-400"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center space-x-1 flex-wrap gap-y-1">
        <button
          type="button"
          onClick={() => applyPreset('7')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
            activePreset === '7'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          Last 7d
        </button>
        <button
          type="button"
          onClick={() => applyPreset('30')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
            activePreset === '30'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          Last 30d
        </button>
        <button
          type="button"
          onClick={() => applyPreset('90')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
            activePreset === '90'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          Last 90d
        </button>
        <button
          type="button"
          onClick={() => applyPreset('month')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer ${
            activePreset === 'month'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
        >
          This Month
        </button>
      </div>

      {value && (
        <div className="text-[11px] text-slate-300 font-mono bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
          {value.min !== undefined ? formatDay(value.min) : '—'} to{' '}
          {value.max !== undefined ? formatDay(value.max) : '—'}
        </div>
      )}
    </div>
  );
};
