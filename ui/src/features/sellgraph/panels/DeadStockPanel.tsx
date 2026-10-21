// ui/src/features/sellgraph/panels/DeadStockPanel.tsx
// Dead stock liquidation panel highlighting capital locked in inactive inventory

import React from 'react';
import { BarChart, BarDatum } from '../../charts/BarChart';
import { formatPaise } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { AlertTriangle, Lock } from 'lucide-react';

interface DeadStockItem {
  resourceId: string;
  name: string;
  stockMilli: number;
  stockValuePaise: number;
  inactiveDays: number;
}

interface DeadStockPanelProps {
  vertical: string;
  today: number;
  thresholdDays?: number;
  onNavigateItem?: (id: string) => void;
}

export const DeadStockPanel: React.FC<DeadStockPanelProps> = ({
  vertical,
  today,
  thresholdDays = 60,
  onNavigateItem,
}) => {
  const { data, loading, error } = useSellGraphData<DeadStockItem[]>(
    'deadStock',
    { today, thresholdDays, limit: 10 },
    vertical
  );

  const totalLockedPaise = (data || []).reduce((acc, item) => acc + item.stockValuePaise, 0);

  const chartData: BarDatum[] = (data || []).map((item) => ({
    id: item.resourceId,
    label: `${item.name} (${item.inactiveDays}d)`,
    value: item.stockValuePaise,
    data: item,
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Dormant / Dead Inventory ({thresholdDays}d+)
            </h3>
            <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
              <Lock className="w-2.5 h-2.5 text-amber-400" />
              Locked Capital:{' '}
              <strong className="text-amber-300 font-mono">
                {formatPaise(totalLockedPaise)}
              </strong>
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[260px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Calculating dead stock...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <BarChart
            data={chartData}
            formatValue={formatPaise}
            barColor="#f43f5e"
            onSelect={(d) => onNavigateItem && onNavigateItem(d.id)}
            ariaLabel="Dead stock products by locked capital value"
          />
        )}
      </div>
    </div>
  );
};
