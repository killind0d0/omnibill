// ui/src/features/charts/Heatmap.tsx
// 7x24 Hourly sales heatmap with 8-step integer quantised intensity and cell tooltips

import React, { useState } from 'react';
import { formatPaise } from '../discovery/format';
import { Tooltip } from './Tooltip';

export interface HeatmapCellData {
  weekday: number; // 0=Sun .. 6=Sat
  hour: number; // 0..23
  bills: number;
  netPaise: number;
}

interface HeatmapProps {
  cells: HeatmapCellData[];
  onSelectCell?: (cell: HeatmapCellData) => void;
  ariaLabel?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 8 distinct intensity levels using Tailwind blue gradient steps
const INTENSITY_COLORS = [
  'bg-slate-900/40 border-slate-900', // Step 0 (zero bills)
  'bg-blue-950/60 border-blue-900/50', // Step 1
  'bg-blue-900/70 border-blue-800/60', // Step 2
  'bg-blue-800/80 border-blue-700/70', // Step 3
  'bg-blue-700/90 border-blue-600', // Step 4
  'bg-blue-600 border-blue-500', // Step 5
  'bg-blue-500 border-blue-400 text-white', // Step 6
  'bg-blue-400 border-blue-300 text-slate-950 font-bold', // Step 7
  'bg-cyan-300 border-white text-slate-950 font-extrabold', // Step 8 (peak)
];

export const Heatmap: React.FC<HeatmapProps> = ({
  cells,
  onSelectCell,
  ariaLabel = 'Weekly peak hours sales heatmap across 7 days and 24 hours',
}) => {
  const [hoveredCell, setHoveredCell] = useState<{
    cell: HeatmapCellData;
    x: number;
    y: number;
  } | null>(null);

  // Index cells in a 7x24 matrix
  const matrix: HeatmapCellData[][] = Array.from({ length: 7 }, (_, wd) =>
    Array.from({ length: 24 }, (_, h) => ({
      weekday: wd,
      hour: h,
      bills: 0,
      netPaise: 0,
    }))
  );

  let maxBills = 1;
  for (const c of cells) {
    if (c.weekday >= 0 && c.weekday < 7 && c.hour >= 0 && c.hour < 24) {
      matrix[c.weekday][c.hour] = c;
      if (c.bills > maxBills) {
        maxBills = c.bills;
      }
    }
  }

  return (
    <div className="w-full flex flex-col space-y-1.5 select-none relative" role="img" aria-label={ariaLabel}>
      {/* Hours Header Row */}
      <div className="flex items-center text-[10px] text-slate-500 font-mono pl-10 pr-2">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="flex-1 text-center truncate">
            {h % 3 === 0 ? `${h}h` : ''}
          </div>
        ))}
      </div>

      {/* Grid of 7 Days */}
      {WEEKDAYS.map((dayName, wd) => (
        <div key={dayName} className="flex items-center space-x-1">
          {/* Day Label */}
          <span className="w-9 text-[11px] font-medium text-slate-400 text-right pr-1 shrink-0">
            {dayName}
          </span>

          {/* 24 Hour Blocks */}
          <div
            className="flex-1 gap-1"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {matrix[wd].map((cell) => {
              const step =
                cell.bills === 0 ? 0 : Math.min(8, Math.max(1, Math.floor((cell.bills * 8) / maxBills)));

              const colorClass = INTENSITY_COLORS[step];

              return (
                <div
                  key={cell.hour}
                  onClick={() => onSelectCell && onSelectCell(cell)}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredCell({
                      cell,
                      x: rect.left,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setHoveredCell(null)}
                  className={`h-6 rounded border cursor-pointer transition-all flex items-center justify-center text-[9px] hover:scale-125 hover:z-20 ${colorClass}`}
                >
                  <title>{`${dayName} ${cell.hour}:00 — ${cell.bills} bills, ${formatPaise(
                    cell.netPaise
                  )}`}</title>
                  {cell.bills > 0 && <span className="opacity-80">{cell.bills}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Intensity Legend */}
      <div className="flex items-center justify-end space-x-1 text-[10px] text-slate-400 pt-2 pr-2">
        <span className="mr-1">Less</span>
        {INTENSITY_COLORS.map((cls, idx) => (
          <span key={idx} className={`w-3.5 h-3.5 rounded border ${cls}`} />
        ))}
        <span className="ml-1">More</span>
      </div>

      {/* Cell Tooltip */}
      {hoveredCell && (
        <Tooltip
          x={hoveredCell.x}
          y={hoveredCell.y}
          visible={Boolean(hoveredCell)}
          title={`${WEEKDAYS[hoveredCell.cell.weekday]} @ ${hoveredCell.cell.hour}:00`}
          items={[
            { label: 'Bills Counter', value: `${hoveredCell.cell.bills} invoices`, color: '#38bdf8' },
            { label: 'Net Turnover', value: formatPaise(hoveredCell.cell.netPaise), color: '#34d399' },
          ]}
        />
      )}
    </div>
  );
};
