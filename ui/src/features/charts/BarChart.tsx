// ui/src/features/charts/BarChart.tsx
// Horizontal accessible SVG Bar Chart (zero external dependencies)

import React, { useState } from 'react';
import { linearScale, niceTicks } from './scale';

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  secondaryValue?: number;
  data?: unknown;
}

interface BarChartProps {
  data: BarDatum[];
  formatValue: (val: number) => string;
  onSelect?: (datum: BarDatum) => void;
  height?: number;
  barColor?: string;
  ariaLabel?: string;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  formatValue,
  onSelect,
  height = 260,
  barColor = 'currentColor',
  ariaLabel = 'Horizontal bar chart displaying metrics by item',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-500">
        No bar data available
      </div>
    );
  }

  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(0, maxValue, 4);
  const maxTick = ticks[ticks.length - 1] || maxValue;

  const rowHeight = Math.max(24, Math.floor((height - 30) / Math.max(1, data.length)));
  const labelWidth = 140;
  const paddingRight = 60;

  return (
    <div className="w-full relative select-none">
      <svg
        width="100%"
        height={height}
        className="overflow-visible text-blue-500"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Background Grid Ticks */}
        {ticks.map((tick) => {
          return (
            <g key={tick} className="text-slate-800">
              <line
                x1={`${labelWidth + ((tick / maxTick) * (100 - (labelWidth / 8) - (paddingRight / 8)))}%`}
                y1={0}
                x2={`${labelWidth + ((tick / maxTick) * (100 - (labelWidth / 8) - (paddingRight / 8)))}%`}
                y2={height - 24}
                stroke="currentColor"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* Horizontal Bars */}
        {data.map((datum, idx) => {
          const y = idx * rowHeight;
          const barH = Math.max(12, rowHeight - 8);
          const widthPercent = (datum.value / maxTick) * 60; // 0..60% of width
          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={datum.id}
              tabIndex={0}
              role="button"
              aria-label={`${datum.label}: ${formatValue(datum.value)}`}
              onClick={() => onSelect && onSelect(datum)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onSelect) onSelect(datum);
                }
              }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer outline-none group"
            >
              <title>{`${datum.label} — ${formatValue(datum.value)}`}</title>

              {/* Label */}
              <text
                x={labelWidth - 8}
                y={y + barH / 2 + 4}
                textAnchor="end"
                className={`text-[11px] font-medium transition-colors ${
                  isHovered ? 'fill-white font-bold' : 'fill-slate-400'
                }`}
              >
                {datum.label.length > 18 ? datum.label.slice(0, 18) + '…' : datum.label}
              </text>

              {/* Bar Track Background */}
              <rect
                x={labelWidth}
                y={y}
                width="65%"
                height={barH}
                rx={3}
                className="fill-slate-900/50"
              />

              {/* Data Bar */}
              <rect
                x={labelWidth}
                y={y}
                width={`${widthPercent}%`}
                height={barH}
                rx={3}
                fill={barColor}
                className={`transition-all ${isHovered ? 'brightness-125' : 'opacity-85'}`}
              />

              {/* Value Text */}
              <text
                x={`${labelWidth + widthPercent + 1}%`}
                y={y + barH / 2 + 4}
                className={`text-[11px] font-mono transition-colors ${
                  isHovered ? 'fill-white font-bold' : 'fill-slate-300'
                }`}
              >
                {formatValue(datum.value)}
              </text>
            </g>
          );
        })}

        {/* X Axis Base Line */}
        <line
          x1={labelWidth}
          y1={height - 24}
          x2="95%"
          y2={height - 24}
          stroke="#334155"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
};
