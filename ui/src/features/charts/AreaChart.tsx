// ui/src/features/charts/AreaChart.tsx
// Stacked Category Area Chart with integer coordinate paths and hover crosshair

import React, { useState } from 'react';
import { linearScale, niceTicks } from './scale';
import { Tooltip } from './Tooltip';

export interface AreaSeries {
  id: string;
  name: string;
  color: string;
  values: number[]; // 1 value per bucket
}

interface AreaChartProps {
  buckets: string[];
  series: AreaSeries[];
  formatValue: (val: number) => string;
  height?: number;
  ariaLabel?: string;
}

export const AreaChart: React.FC<AreaChartProps> = ({
  buckets,
  series,
  formatValue,
  height = 260,
  ariaLabel = 'Stacked area chart showing trends across categories',
}) => {
  const [hoveredBucketIdx, setHoveredBucketIdx] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const margin = { top: 20, right: 20, bottom: 35, left: 60 };
  const width = 600;

  if (buckets.length === 0 || series.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-500">
        No trend data available
      </div>
    );
  }

  // Calculate stacked totals per bucket
  const numBuckets = buckets.length;
  const stackedTotals = new Array(numBuckets).fill(0);
  for (let b = 0; b < numBuckets; b++) {
    for (const s of series) {
      stackedTotals[b] += s.values[b] || 0;
    }
  }

  const maxTotal = Math.max(1, ...stackedTotals);
  const ticks = niceTicks(0, maxTotal, 4);
  const maxTick = ticks[ticks.length - 1] || maxTotal;

  const scaleX = linearScale(0, Math.max(1, numBuckets - 1), margin.left, width - margin.right);
  const scaleY = linearScale(0, maxTick, height - margin.bottom, margin.top);

  // Build SVG stacked paths (bottom to top)
  let currentBase = new Array(numBuckets).fill(0);
  const paths: Array<{ id: string; color: string; d: string }> = [];

  for (const s of series) {
    const nextBase = [...currentBase];
    const topPoints: string[] = [];
    const bottomPoints: string[] = [];

    for (let b = 0; b < numBuckets; b++) {
      const val = s.values[b] || 0;
      nextBase[b] += val;
      const x = Math.round(scaleX(b));
      const yTop = Math.round(scaleY(nextBase[b]));
      const yBottom = Math.round(scaleY(currentBase[b]));

      topPoints.push(`${x},${yTop}`);
      bottomPoints.unshift(`${x},${yBottom}`);
    }

    const d = `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
    paths.push({ id: s.id, color: s.color, d });
    currentBase = nextBase;
  }

  return (
    <div className="w-full relative select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const svgX = ((e.clientX - rect.left) / rect.width) * width;
          const bucketFrac = (svgX - margin.left) / (width - margin.left - margin.right);
          const bIdx = Math.max(0, Math.min(numBuckets - 1, Math.round(bucketFrac * (numBuckets - 1))));
          setHoveredBucketIdx(bIdx);
          setMousePos({ x: e.clientX, y: e.clientY });
        }}
        onMouseLeave={() => {
          setHoveredBucketIdx(null);
          setMousePos(null);
        }}
      >
        {/* Y Axis Grid Ticks */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              y1={scaleY(tick)}
              x2={width - margin.right}
              y2={scaleY(tick)}
              stroke="#1e293b"
              strokeDasharray="2 3"
            />
            <text
              x={margin.left - 8}
              y={scaleY(tick) + 3}
              textAnchor="end"
              className="text-[10px] font-mono fill-slate-500"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {/* Stacked Paths */}
        {paths.map((p) => (
          <path
            key={p.id}
            d={p.d}
            fill={p.color}
            opacity={0.65}
            className="hover:opacity-85 transition-opacity"
          />
        ))}

        {/* X Axis Base Line and Labels */}
        <line
          x1={margin.left}
          y1={height - margin.bottom}
          x2={width - margin.right}
          y2={height - margin.bottom}
          stroke="#334155"
        />

        {buckets.map((b, idx) => {
          // Show up to 8 evenly spaced x-axis labels
          const step = Math.ceil(numBuckets / 7);
          if (idx % step !== 0 && idx !== numBuckets - 1) return null;

          return (
            <text
              key={b}
              x={scaleX(idx)}
              y={height - margin.bottom + 16}
              textAnchor="middle"
              className="text-[10px] font-mono fill-slate-500"
            >
              {b}
            </text>
          );
        })}

        {/* Crosshair Line */}
        {hoveredBucketIdx !== null && (
          <line
            x1={scaleX(hoveredBucketIdx)}
            y1={margin.top}
            x2={scaleX(hoveredBucketIdx)}
            y2={height - margin.bottom}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {/* Hover Tooltip */}
      {hoveredBucketIdx !== null && mousePos && (
        <Tooltip
          x={mousePos.x}
          y={mousePos.y}
          visible={true}
          title={`Bucket: ${buckets[hoveredBucketIdx]}`}
          items={series.map((s) => ({
            label: s.name,
            value: formatValue(s.values[hoveredBucketIdx] || 0),
            color: s.color,
          }))}
        />
      )}
    </div>
  );
};
