// ui/src/features/sellgraph/panels/StockoutDangerPanel.tsx
// Stockout danger forecast ranking inventory by runout days ascending

import React from 'react';
import { BarChart, BarDatum } from '../../charts/BarChart';
import { formatDaysX10 } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { AlertCircle } from 'lucide-react';

interface StockoutItem {
  resourceId: string;
  name: string;
  stockMilli: number;
  runoutDaysX10: number;
  qty30Milli: number;
}

interface StockoutDangerPanelProps {
  vertical: string;
  onNavigateItem?: (id: string) => void;
}

export const StockoutDangerPanel: React.FC<StockoutDangerPanelProps> = ({
  vertical,
  onNavigateItem,
}) => {
  const { data, loading, error } = useSellGraphData<StockoutItem[]>(
    'stockoutForecast',
    { limit: 10 },
    vertical
  );

  const chartData: BarDatum[] = (data || []).map((item) => ({
    id: item.resourceId,
    label: item.name,
    value: item.runoutDaysX10,
    data: item,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-orange-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Stockout Depletion Forecast
            </h3>
            <span className="text-[10px] text-slate-400">
              Immediate Danger: Items depleting in &lt; 7 days
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[260px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Forecasting runout depletion...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <BarChart
            data={chartData}
            formatValue={formatDaysX10}
            barColor="#f97316"
            onSelect={(d) => onNavigateItem && onNavigateItem(d.id)}
            ariaLabel="Inventory stockout forecast by days remaining"
          />
        )}
      </div>
    </div>
  );
};
