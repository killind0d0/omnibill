// ui/src/features/sellgraph/panels/CategoryTrendPanel.tsx
// Stacked Area Chart displaying category sales trends over selected period

import React from 'react';
import { AreaChart, AreaSeries } from '../../charts/AreaChart';
import { formatPaise } from '../../discovery/format';
import { useSellGraphData } from '../useSellGraph';
import { Layers } from 'lucide-react';

interface CategoryTrendPoint {
  categoryId: number;
  bucketKey: string;
  revPaise: number;
  qtyMilli: number;
}

interface CategoryTrendPanelProps {
  vertical: string;
  fromDay: number;
  toDay: number;
}

const CATEGORY_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

export const CategoryTrendPanel: React.FC<CategoryTrendPanelProps> = ({
  vertical,
  fromDay,
  toDay,
}) => {
  const { data, loading, error } = useSellGraphData<CategoryTrendPoint[]>(
    'categoryTrend',
    { fromDay, toDay, bucket: 'Week' },
    vertical
  );

  // Group by category and bucket
  const bucketsSet = new Set<string>();
  const catMap = new Map<number, Map<string, number>>();

  for (const pt of data || []) {
    bucketsSet.add(pt.bucketKey);
    let catBuckets = catMap.get(pt.categoryId);
    if (!catBuckets) {
      catBuckets = new Map();
      catMap.set(pt.categoryId, catBuckets);
    }
    catBuckets.set(pt.bucketKey, pt.revPaise);
  }

  const sortedBuckets = Array.from(bucketsSet).sort();

  const series: AreaSeries[] = Array.from(catMap.entries()).map(([catId, bMap], idx) => ({
    id: `cat-${catId}`,
    name: `Category ${catId}`,
    color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
    values: sortedBuckets.map((b) => bMap.get(b) || 0),
  }));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Category Turnover Trends
          </h3>
        </div>
      </div>

      <div className="flex-1 min-h-[260px] flex items-center justify-center">
        {loading ? (
          <span className="text-xs text-slate-500 animate-pulse">Aggregating category series...</span>
        ) : error ? (
          <span className="text-xs text-rose-400">{error}</span>
        ) : (
          <AreaChart
            buckets={sortedBuckets}
            series={series}
            formatValue={formatPaise}
            ariaLabel="Category revenue trends over time"
          />
        )}
      </div>
    </div>
  );
};
