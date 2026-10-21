// ui/src/features/sellgraph/panels/PeakHoursPanel.tsx
// 7x24 Hourly sales heatmap panel displaying peak store counter traffic

import React from 'react';
import { Heatmap, HeatmapCellData } from '../../charts/Heatmap';
import { useSellGraphData } from '../useSellGraph';
import { Clock } from 'lucide-react';

interface PeakHoursPanelProps {
  fromDay: number;
  toDay: number;
}

export const PeakHoursPanel: React.FC<PeakHoursPanelProps> = ({ fromDay, toDay }) => {
  const { data, loading, error } = useSellGraphData<HeatmapCellData[]>('hourlyHeatmap', {
    fromDay,
    toDay,
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Peak Store Invoicing Hours (7×24 Matrix)
            </h3>
            <span className="text-[10px] text-slate-400">
              Counter Traffic & Volume Distribution Across Days & Hours
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[220px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Computing traffic heatmap...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <Heatmap
            cells={data || []}
            ariaLabel="Weekly 7x24 store invoicing peak traffic heatmap"
          />
        )}
      </div>
    </div>
  );
};
