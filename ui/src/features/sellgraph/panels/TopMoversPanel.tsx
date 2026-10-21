// ui/src/features/sellgraph/panels/TopMoversPanel.tsx
// Top 10 fastest moving inventory items with Revenue/Quantity/Profit toggle

import React, { useState } from 'react';
import { BarChart, BarDatum } from '../../charts/BarChart';
import { formatBp, formatPaise, formatQtyMilli } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { TrendingUp } from 'lucide-react';

interface TopMoverItem {
  resourceId: string;
  name: string;
  qtyMilli: number;
  revPaise: number;
  gpPaise: number;
}

interface TopMoversPanelProps {
  vertical: string;
  windowDays: number;
  today: number;
  onNavigateItem?: (id: string) => void;
}

export const TopMoversPanel: React.FC<TopMoversPanelProps> = ({
  vertical,
  windowDays,
  today,
  onNavigateItem,
}) => {
  const [metric, setMetric] = useState<'Revenue' | 'Qty' | 'GrossProfit'>('Revenue');

  const { data, loading, error } = useSellGraphData<TopMoverItem[]>(
    'topMovers',
    { today, windowDays, limit: 10, by: metric },
    vertical
  );

  const formatValue = (val: number) => {
    if (metric === 'Qty') return formatQtyMilli(val, 'units');
    return formatPaise(val);
  };

  const chartData: BarDatum[] = (data || []).map((item) => ({
    id: item.resourceId,
    label: item.name,
    value: metric === 'Qty' ? item.qtyMilli : metric === 'Revenue' ? item.revPaise : item.gpPaise,
    data: item,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Top 10 High Velocity Movers
          </h3>
        </div>

        {/* Metric Switcher */}
        <div className="flex items-center space-x-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
          {(['Revenue', 'Qty', 'GrossProfit'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                metric === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {m === 'GrossProfit' ? 'Profit' : m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-[260px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Loading top movers...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <BarChart
            data={chartData}
            formatValue={formatValue}
            barColor="#3b82f6"
            onSelect={(d) => onNavigateItem && onNavigateItem(d.id)}
            ariaLabel="Top 10 highest velocity selling products"
          />
        )}
      </div>
    </div>
  );
};
