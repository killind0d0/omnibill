// ui/src/features/charts/Donut.tsx
// Zero-dependency SVG Donut Chart with integer basis-point threshold merging

import React, { useState } from 'react';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color?: string;
}

interface DonutProps {
  data: DonutSlice[];
  formatValue: (val: number) => string;
  size?: number;
  innerRadius?: number;
  ariaLabel?: string;
}

const DEFAULT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#64748b', // slate
];

export const Donut: React.FC<DonutProps> = ({
  data,
  formatValue,
  size = 220,
  innerRadius = 60,
  ariaLabel = 'Donut chart showing proportion breakdown',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = data.reduce((acc, d) => acc + d.value, 0);

  if (total === 0 || data.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-slate-500">
        No breakdown data available
      </div>
    );
  }

  // Filter & merge slices: min visible slice 1% (100 bp out of 10000)
  const processedSlices: Array<{ label: string; value: number; bp: number; color: string }> = [];
  let otherValue = 0;
  let otherBp = 0;

  data.forEach((d, idx) => {
    const bp = Math.floor((d.value * 10000) / total);
    if (bp >= 100) {
      processedSlices.push({
        label: d.label,
        value: d.value,
        bp,
        color: d.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      });
    } else {
      otherValue += d.value;
      otherBp += bp;
    }
  });

  if (otherValue > 0) {
    processedSlices.push({
      label: 'Other',
      value: otherValue,
      bp: otherBp,
      color: '#475569',
    });
  }

  const radius = (size - 20) / 2;
  const center = size / 2;

  // Compute angles for each slice
  let currentAngle = -90; // Start at top
  const paths: Array<{
    d: string;
    label: string;
    value: number;
    color: string;
    percentage: string;
  }> = [];

  for (const s of processedSlices) {
    const sliceAngle = (s.bp / 10000) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = center + radius * Math.cos(startRad);
    const y1 = center + radius * Math.sin(startRad);
    const x2 = center + radius * Math.cos(endRad);
    const y2 = center + radius * Math.sin(endRad);

    const x3 = center + innerRadius * Math.cos(endRad);
    const y3 = center + innerRadius * Math.sin(endRad);
    const x4 = center + innerRadius * Math.cos(startRad);
    const y4 = center + innerRadius * Math.sin(startRad);

    const largeArc = sliceAngle > 180 ? 1 : 0;

    const d = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}`,
      'Z',
    ].join(' ');

    const wholePct = Math.trunc(s.bp / 100);
    const fracPct = s.bp % 100;
    const pctStr = `${wholePct}.${fracPct < 10 ? '0' + fracPct : fracPct}%`;

    paths.push({
      d,
      label: s.label,
      value: s.value,
      color: s.color,
      percentage: pctStr,
    });
  }

  return (
    <div className="flex items-center space-x-4 select-none">
      <svg
        width={size}
        height={size}
        className="overflow-visible"
        role="img"
        aria-label={ariaLabel}
      >
        {paths.map((p, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <path
              key={idx}
              d={p.d}
              fill={p.color}
              className={`transition-all cursor-pointer ${
                isHovered ? 'brightness-125 scale-105' : 'opacity-90'
              }`}
              style={{ transformOrigin: `${center}px ${center}px` }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <title>{`${p.label}: ${formatValue(p.value)} (${p.percentage})`}</title>
            </path>
          );
        })}

        {/* Center Total Display */}
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          className="text-[10px] font-semibold fill-slate-400 uppercase tracking-wider"
        >
          Total
        </text>
        <text
          x={center}
          y={center + 14}
          textAnchor="middle"
          className="text-xs font-mono font-bold fill-white"
        >
          {formatValue(total)}
        </text>
      </svg>

      {/* Legend */}
      <div className="space-y-1 text-xs max-h-48 overflow-y-auto">
        {paths.map((p, idx) => (
          <div
            key={idx}
            className={`flex items-center space-x-2 cursor-pointer transition-colors ${
              hoveredIdx === idx ? 'text-white font-bold' : 'text-slate-400'
            }`}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="truncate max-w-[100px]">{p.label}:</span>
            <span className="font-mono text-slate-200">{p.percentage}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
