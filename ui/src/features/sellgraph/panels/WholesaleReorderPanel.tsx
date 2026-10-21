// ui/src/features/sellgraph/panels/WholesaleReorderPanel.tsx
// Wholesale customer reorder interval analysis panel using LAG median cadence

import React, { useState } from 'react';
import { useSellGraphData } from '../useSellGraph';
import { Truck } from 'lucide-react';

interface WholesaleReorderPanelProps {
  customerId?: string;
  resourceId?: string;
}

export const WholesaleReorderPanel: React.FC<WholesaleReorderPanelProps> = ({
  customerId = 'cust_1',
  resourceId = 'r1',
}) => {
  const { data, loading, error } = useSellGraphData<number | null>('wholesaleReorder', {
    customerId,
    resourceId,
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Truck className="w-4 h-4 text-blue-400" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              B2B Customer Purchase Cadence
            </h3>
            <span className="text-[10px] text-slate-400">
              Median Reorder Interval (Requires &ge; 3 Invoices)
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 flex flex-col items-center justify-center text-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Calculating median interval...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : data === null ? (
          <div className="space-y-1">
            <span className="text-sm font-semibold text-slate-400">Not enough history</span>
            <p className="text-[11px] text-slate-600">Customer has fewer than 3 recorded purchases for this item</p>
          </div>
        ) : (
          <div className="space-y-1">
            <span className="text-3xl font-extrabold font-mono text-blue-400">{data} Days</span>
            <p className="text-xs text-slate-400">Typical customer reorder cadence between bulk shipments</p>
          </div>
        )}
      </div>
    </div>
  );
};
