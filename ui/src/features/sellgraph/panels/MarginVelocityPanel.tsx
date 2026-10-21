// ui/src/features/sellgraph/panels/MarginVelocityPanel.tsx
// Matrix scatter plot showing Margin vs Velocity distribution with median quadrant lines

import React from 'react';
import { ScatterPlot, ScatterPoint } from '../../charts/ScatterPlot';
import { formatBp, formatQtyMilli } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { Grid } from 'lucide-react';

interface MarginVelocityPoint {
  resourceId: string;
  name: string;
  marginBp: number;
  qty30Milli: number;
  rev90Paise: number;
}

interface MarginVelocityPanelProps {
  vertical: string;
  onNavigateItem?: (id: string) => void;
}

export const MarginVelocityPanel: React.FC<MarginVelocityPanelProps> = ({
  vertical,
  onNavigateItem,
}) => {
  const { data, loading, error } = useSellGraphData<MarginVelocityPoint[]>(
    'marginVsVelocity',
    { limit: 500 },
    vertical
  );

  const points: ScatterPoint[] = (data || []).map((p) => ({
    id: p.resourceId,
    name: p.name,
    x: p.marginBp,
    y: p.qty30Milli,
    size: p.rev90Paise,
    data: p,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Grid className="w-4 h-4 text-emerald-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Margin vs. Velocity Matrix
            </h3>
            <span className="text-[10px] text-slate-400">
              Quadrant Crosshairs: Median Margin & Median 30-Day Velocity
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[300px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Plotting inventory matrix...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <ScatterPlot
            points={points}
            formatX={formatBp}
            formatY={(q) => formatQtyMilli(q, 'units')}
            xLabel="Gross Margin"
            yLabel="30-Day Unit Sales"
            onSelect={(pt) => onNavigateItem && onNavigateItem(pt.id)}
            ariaLabel="Margin vs velocity scatter plot with median quadrants"
          />
        )}
      </div>
    </div>
  );
};
