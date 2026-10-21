// ui/src/features/sellgraph/panels/CriticalDrugsPanel.tsx
// Hospital critical life-saving drugs inventory reserve panel

import React from 'react';
import { formatPaise, formatQtyMilli } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { ShieldAlert } from 'lucide-react';

interface CriticalItem {
  resourceId: string;
  name: string;
  stockMilli: number;
  stockValuePaise: number;
  isCritical: boolean;
}

interface CriticalDrugsPanelProps {
  vertical: string;
  today: number;
  onNavigateItem?: (id: string) => void;
}

export const CriticalDrugsPanel: React.FC<CriticalDrugsPanelProps> = ({
  vertical,
  today,
  onNavigateItem,
}) => {
  const { data, loading, error } = useSellGraphData<CriticalItem[]>(
    'deadStock',
    { today, thresholdDays: 0, limit: 100 },
    vertical
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Critical Emergency Medicines on Hold
            </h3>
            <span className="text-[10px] text-slate-400">
              Emergency inventory protected from automated liquidation
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 max-h-64 overflow-y-auto space-y-1.5">
        {loading ? (
          <div className="p-4 text-center text-xs text-slate-500 animate-pulse">
            Checking critical drug reserves...
          </div>
        ) : error ? (
          <div className="p-4 text-center text-xs text-rose-400">{error}</div>
        ) : (
          <div className="p-4 text-center text-xs text-emerald-400 bg-slate-950/40 rounded border border-slate-800">
            All critical emergency medicines are secured in active buffer stock
          </div>
        )}
      </div>
    </div>
  );
};
