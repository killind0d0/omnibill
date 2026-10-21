// ui/src/features/discovery/RangeInput.tsx
// Pure integer range inputs with string-to-integer parsing (zero floats, zero Number())

import React, { useState, useEffect } from 'react';
import { parsePercentToBp, parseRupeesToPaise } from './parse';
import { Range } from './types';

interface RangeInputProps {
  label: string;
  type: 'money' | 'margin' | 'integer';
  value?: Range;
  onChange: (range?: Range) => void;
  prefix?: string;
  suffix?: string;
}

export const RangeInput: React.FC<RangeInputProps> = ({
  label,
  type,
  value,
  onChange,
  prefix,
  suffix,
}) => {
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Sync internal text with incoming integer range
  useEffect(() => {
    if (value?.min !== undefined) {
      if (type === 'money') {
        const whole = Math.trunc(value.min / 100);
        const frac = Math.abs(value.min % 100);
        setMinText(frac === 0 ? whole.toString() : `${whole}.${frac < 10 ? '0' + frac : frac}`);
      } else if (type === 'margin') {
        const whole = Math.trunc(value.min / 100);
        const frac = Math.abs(value.min % 100);
        setMinText(frac === 0 ? whole.toString() : `${whole}.${frac < 10 ? '0' + frac : frac}`);
      } else {
        setMinText(value.min.toString());
      }
    } else {
      setMinText('');
    }

    if (value?.max !== undefined) {
      if (type === 'money') {
        const whole = Math.trunc(value.max / 100);
        const frac = Math.abs(value.max % 100);
        setMaxText(frac === 0 ? whole.toString() : `${whole}.${frac < 10 ? '0' + frac : frac}`);
      } else if (type === 'margin') {
        const whole = Math.trunc(value.max / 100);
        const frac = Math.abs(value.max % 100);
        setMaxText(frac === 0 ? whole.toString() : `${whole}.${frac < 10 ? '0' + frac : frac}`);
      } else {
        setMaxText(value.max.toString());
      }
    } else {
      setMaxText('');
    }
  }, [value, type]);

  const handleApply = (newMinStr: string, newMaxStr: string) => {
    setError(null);
    try {
      let minInt: number | undefined;
      let maxInt: number | undefined;

      if (type === 'money') {
        minInt = parseRupeesToPaise(newMinStr);
        maxInt = parseRupeesToPaise(newMaxStr);
      } else if (type === 'margin') {
        minInt = parsePercentToBp(newMinStr);
        maxInt = parsePercentToBp(newMaxStr);
      } else {
        minInt = newMinStr.trim() === '' ? undefined : parseInteger(newMinStr.trim());
        maxInt = newMaxStr.trim() === '' ? undefined : parseInteger(newMaxStr.trim());
      }

      if (minInt !== undefined && maxInt !== undefined && minInt > maxInt) {
        setError('Min cannot exceed Max');
        return;
      }

      if (minInt === undefined && maxInt === undefined) {
        onChange(undefined);
      } else {
        onChange({ min: minInt, max: maxInt });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid numeric value';
      setError(msg);
    }
  };

  return (
    <div className="flex flex-col space-y-1 text-xs">
      <span className="text-slate-400 font-medium">{label}</span>
      <div className="flex items-center space-x-1.5">
        <div className="relative flex-1">
          {prefix && (
            <span className="absolute left-2.5 top-1.5 text-slate-500 font-mono">{prefix}</span>
          )}
          <input
            type="text"
            value={minText}
            onChange={(e) => {
              setMinText(e.target.value);
              handleApply(e.target.value, maxText);
            }}
            placeholder="Min"
            className={`w-full bg-slate-900 border rounded px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none ${
              prefix ? 'pl-6' : ''
            } ${error ? 'border-rose-500' : 'border-slate-700 focus:border-blue-500'}`}
          />
        </div>

        <span className="text-slate-600 font-mono">—</span>

        <div className="relative flex-1">
          {prefix && (
            <span className="absolute left-2.5 top-1.5 text-slate-500 font-mono">{prefix}</span>
          )}
          <input
            type="text"
            value={maxText}
            onChange={(e) => {
              setMaxText(e.target.value);
              handleApply(minText, e.target.value);
            }}
            placeholder="Max"
            className={`w-full bg-slate-900 border rounded px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none ${
              prefix ? 'pl-6' : ''
            } ${error ? 'border-rose-500' : 'border-slate-700 focus:border-blue-500'}`}
          />
          {suffix && (
            <span className="absolute right-2 top-1.5 text-slate-500 font-mono text-[10px]">
              {suffix}
            </span>
          )}
        </div>
      </div>
      {error && <span className="text-[10px] text-rose-400">{error}</span>}
    </div>
  );
};

function parseInteger(s: string): number {
  let val = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 48 || code > 57) {
      throw new Error('Invalid integer character');
    }
    val = val * 10 + (code - 48);
  }
  return val;
}
