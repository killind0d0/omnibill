// ui/src/features/charts/Tooltip.tsx
// Zero-dependency SVG/HTML floating tooltip component

import React from 'react';

interface TooltipProps {
  x: number;
  y: number;
  visible: boolean;
  title: string;
  items: Array<{ label: string; value: string; color?: string }>;
}

export const Tooltip: React.FC<TooltipProps> = ({ x, y, visible, title, items }) => {
  if (!visible) return null;

  return (
    <div
      style={{ left: x + 12, top: y - 24 }}
      className="pointer-events-none absolute z-50 bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 shadow-2xl backdrop-blur-sm text-xs min-w-[140px] animate-in fade-in duration-100"
    >
      <div className="font-semibold text-white truncate max-w-[200px] border-b border-slate-800 pb-1 mb-1.5">
        {title}
      </div>
      <div className="space-y-1">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between space-x-3 text-[11px]">
            <span className="text-slate-400 flex items-center gap-1.5">
              {item.color && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              )}
              {item.label}
            </span>
            <span className="font-mono font-bold text-slate-200">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
