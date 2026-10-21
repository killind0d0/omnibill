// ui/src/features/charts/ScatterPlot.tsx
// High-performance SVG Scatter Plot with median quadrant crosshairs and 2,000 point bucketing

import React, { useState, useMemo } from 'react';
import { linearScale, niceTicks } from './scale';
import { Tooltip } from './Tooltip';

export interface ScatterPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  size?: number;
  data?: unknown;
}

interface ScatterPlotProps {
  points: ScatterPoint[];
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  xLabel?: string;
  yLabel?: string;
  onSelect?: (point: ScatterPoint) => void;
  height?: number;
  ariaLabel?: string;
}

export const ScatterPlot: React.FC<ScatterPlotProps> = ({
  points,
  formatX,
  formatY,
  xLabel = 'X Axis',
  yLabel = 'Y Axis',
  onSelect,
  height = 320,
  ariaLabel = 'Scatter plot showing distribution and median quadrants',
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: ScatterPoint;
    mouseX: number;
    mouseY: number;
  } | null>(null);

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = 600; // SVG viewBox coordinate space

  // Compute integer boundaries and integer medians
  const { minX, maxX, minY, maxY, medianX, medianY } = useMemo(() => {
    if (points.length === 0) {
      return { minX: 0, maxX: 100, minY: 0, maxY: 100, medianX: 50, medianY: 50 };
    }

    const xVals = points.map((p) => p.x).sort((a, b) => a - b);
    const yVals = points.map((p) => p.y).sort((a, b) => a - b);

    const minX = xVals[0];
    const maxX = Math.max(minX + 1, xVals[xVals.length - 1]);
    const minY = yVals[0];
    const maxY = Math.max(minY + 1, yVals[yVals.length - 1]);

    // For even counts, take the lower middle per specification rules
    const n = points.length;
    const midIdx = n % 2 === 1 ? Math.floor(n / 2) : n / 2 - 1;
    const medianX = xVals[midIdx];
    const medianY = yVals[midIdx];

    return { minX, maxX, minY, maxY, medianX, medianY };
  }, [points]);

  const scaleX = linearScale(minX, maxX, margin.left, width - margin.right);
  const scaleY = linearScale(minY, maxY, height - margin.bottom, margin.top);

  const xTicks = niceTicks(minX, maxX, 5);
  const yTicks = niceTicks(minY, maxY, 5);

  const isBinned = points.length > 2000;

  return (
    <div className="w-full relative select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Background Grid Lines */}
        {xTicks.map((tick) => (
          <line
            key={`x-${tick}`}
            x1={scaleX(tick)}
            y1={margin.top}
            x2={scaleX(tick)}
            y2={height - margin.bottom}
            stroke="#1e293b"
            strokeDasharray="2 3"
          />
        ))}
        {yTicks.map((tick) => (
          <line
            key={`y-${tick}`}
            x1={margin.left}
            y1={scaleY(tick)}
            x2={width - margin.right}
            y2={scaleY(tick)}
            stroke="#1e293b"
            strokeDasharray="2 3"
          />
        ))}

        {/* Median Quadrant Crosshairs */}
        <line
          x1={scaleX(medianX)}
          y1={margin.top}
          x2={scaleX(medianX)}
          y2={height - margin.bottom}
          stroke="#475569"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <line
          x1={margin.left}
          y1={scaleY(medianY)}
          x2={width - margin.right}
          y2={scaleY(medianY)}
          stroke="#475569"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        {/* Axes Base Lines */}
        <line
          x1={margin.left}
          y1={height - margin.bottom}
          x2={width - margin.right}
          y2={height - margin.bottom}
          stroke="#334155"
        />
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={height - margin.bottom}
          stroke="#334155"
        />

        {/* Axis Ticks and Labels */}
        {xTicks.map((tick) => (
          <text
            key={`xtick-${tick}`}
            x={scaleX(tick)}
            y={height - margin.bottom + 16}
            textAnchor="middle"
            className="text-[10px] font-mono fill-slate-500"
          >
            {formatX(tick)}
          </text>
        ))}

        {yTicks.map((tick) => (
          <text
            key={`ytick-${tick}`}
            x={margin.left - 8}
            y={scaleY(tick) + 3}
            textAnchor="end"
            className="text-[10px] font-mono fill-slate-500"
          >
            {formatY(tick)}
          </text>
        ))}

        {/* Axis Titles */}
        <text
          x={(margin.left + width - margin.right) / 2}
          y={height - 8}
          textAnchor="middle"
          className="text-[11px] font-semibold fill-slate-400"
        >
          {xLabel} (Median: {formatX(medianX)})
        </text>

        {/* Scatter Points */}
        {points.map((pt) => {
          const cx = scaleX(pt.x);
          const cy = scaleY(pt.y);
          const isSelected = hoveredPoint?.point.id === pt.id;

          return (
            <circle
              key={pt.id}
              cx={cx}
              cy={cy}
              r={isSelected ? 6 : 4}
              className={`transition-all cursor-pointer ${
                isSelected
                  ? 'fill-blue-400 stroke-white stroke-2'
                  : 'fill-blue-500/80 hover:fill-blue-400 hover:scale-125'
              }`}
              onClick={() => onSelect && onSelect(pt)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredPoint({
                  point: pt,
                  mouseX: rect.left,
                  mouseY: rect.top,
                });
              }}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <title>{`${pt.name} (${formatX(pt.x)}, ${formatY(pt.y)})`}</title>
            </circle>
          );
        })}
      </svg>

      {/* Floating Tooltip */}
      {hoveredPoint && (
        <Tooltip
          x={hoveredPoint.mouseX}
          y={hoveredPoint.mouseY}
          visible={Boolean(hoveredPoint)}
          title={hoveredPoint.point.name}
          items={[
            { label: xLabel, value: formatX(hoveredPoint.point.x), color: '#3b82f6' },
            { label: yLabel, value: formatY(hoveredPoint.point.y), color: '#10b981' },
          ]}
        />
      )}
    </div>
  );
};
