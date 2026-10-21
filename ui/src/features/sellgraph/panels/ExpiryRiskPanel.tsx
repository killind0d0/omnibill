// ui/src/features/sellgraph/panels/ExpiryRiskPanel.tsx
// Hospital clinical inventory expiry risk valuation panel

import React from 'react';
import { formatDay, formatPaise, formatQtyMilli } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { AlertCircle, ShieldAlert } from 'lucide-react';

interface ExpiryRiskItem {
  resourceId: string;
  name: string;
  stockMilli: number;
  stockValuePaise: number;
  earliestExpiryDay: number;
  atRiskMilli: number;
  atRiskValuePaise: number;
  isCritical: boolean;
}

interface ExpiryRiskPanelProps {
  vertical: string;
  today: number;
  onNavigateItem?: (id: string) => void;
}

export const ExpiryRiskPanel: React.FC<ExpiryRiskPanelProps> = ({
  vertical,
  today,
  onNavigateItem,
}) => {
  const { data, loading, error } = useSellGraphData<ExpiryRiskItem[]>(
    'expiryRisk',
    { today },
    vertical
  );

  const totalAtRiskPaise = (data || []).reduce((acc, item) => acc + item.atRiskValuePaise, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-purple-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Clinical Inventory Expiry Risk (90-Day Window)
            </h3>
            <span className="text-[10px] text-purple-300 font-mono">
              Total Excess Stock at Risk: <strong>{formatPaise(totalAtRiskPaise)}</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 max-h-64 overflow-y-auto space-y-1.5">
        {loading ? (
          <div className="p-4 text-center text-xs text-slate-500 animate-pulse">
            Analyzing batch expiration dates...
          </div>
        ) : error ? (
          <div className="p-4 text-center text-xs text-rose-400">{error}</div>
        ) : (data || []).length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Zero expiry risks detected within 90 days
          </div>
        ) : (
          (data || []).map((item) => (
            <div
              key={item.resourceId}
              onClick={() => onNavigateItem && onNavigateItem(item.resourceId)}
              className="p-2 bg-slate-950/70 border border-slate-800 rounded-lg flex items-center justify-between hover:border-slate-700 cursor-pointer transition-colors"
            >
              <div className="flex items-center space-x-2 truncate">
                {item.isCritical && (
                  <span title="Critical Drug" className="shrink-0">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  </span>
                )}
                <div>
                  <h4 className="text-xs font-bold text-slate-200 truncate">{item.name}</h4>
                  <span className="text-[10px] text-purple-400 font-mono">
                    Expires: {formatDay(item.earliestExpiryDay)}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0 font-mono">
                <span className="text-xs font-bold text-rose-400">
                  {formatPaise(item.atRiskValuePaise)}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {formatQtyMilli(item.atRiskMilli, 'units at risk')}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
