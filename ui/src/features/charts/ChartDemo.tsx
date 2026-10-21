// ui/src/features/charts/ChartDemo.tsx
// Dev-only preview gallery demonstrating all 5 zero-dependency SVG chart components

import React from 'react';
import { BarChart } from './BarChart';
import { ScatterPlot } from './ScatterPlot';
import { AreaChart } from './AreaChart';
import { Donut } from './Donut';
import { Heatmap } from './Heatmap';
import { formatBp, formatPaise, formatQtyMilli } from '../discovery/format';

export const ChartDemo: React.FC = () => {
  return (
    <div className="p-6 bg-slate-950 text-white min-h-screen space-y-8 overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold">OmniBill Zero-Dependency SVG Chart Suite (Dev Demo)</h1>
        <p className="text-xs text-slate-400 mt-1">
          Zero chart libraries, zero floats in data, accessible SVG paths with Indian integer formatting.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Bar Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Top Movers (Horizontal BarChart)
          </h2>
          <BarChart
            data={[
              { id: '1', label: 'Amul Milk 500ml', value: 450000 },
              { id: '2', label: 'Tata Salt 1kg', value: 320000 },
              { id: '3', label: 'Parle-G Biscuit', value: 280000 },
              { id: '4', label: 'Fortune Sunlite 1L', value: 190000 },
              { id: '5', label: 'Aashirvaad Atta 5kg', value: 120000 },
            ]}
            formatValue={formatPaise}
          />
        </div>

        {/* 2. Donut Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Category Contribution (Donut Chart)
          </h2>
          <Donut
            data={[
              { id: '1', label: 'Dairy & Fresh', value: 550000, color: '#3b82f6' },
              { id: '2', label: 'Staples & Grains', value: 340000, color: '#10b981' },
              { id: '3', label: 'Snacks & Beverages', value: 210000, color: '#f59e0b' },
              { id: '4', label: 'Personal Care', value: 120000, color: '#8b5cf6' },
              { id: '5', label: 'Micro item', value: 2000, color: '#ec4899' }, // < 1% -> Merged into Other
            ]}
            formatValue={formatPaise}
          />
        </div>

        {/* 3. Scatter Plot */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 lg:col-span-2">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Margin vs. Velocity (ScatterPlot with Median Crosshairs)
          </h2>
          <ScatterPlot
            points={[
              { id: 'p1', name: 'Amul Milk 500ml', x: 2500, y: 120000 },
              { id: 'p2', name: 'Tata Salt 1kg', x: 3500, y: 80000 },
              { id: 'p3', name: 'Parle-G Biscuit', x: 1800, y: 95000 },
              { id: 'p4', name: 'Aashirvaad Atta 5kg', x: 4200, y: 35000 },
              { id: 'p5', name: 'Premium Coffee 200g', x: 5500, y: 15000 },
            ]}
            formatX={formatBp}
            formatY={(q) => formatQtyMilli(q, 'units')}
            xLabel="Gross Margin"
            yLabel="30-Day Units Sold"
          />
        </div>

        {/* 4. Area Chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 lg:col-span-2">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Category Trend Over Time (Stacked AreaChart)
          </h2>
          <AreaChart
            buckets={['W140', 'W141', 'W142', 'W143', 'W144', 'W145']}
            series={[
              {
                id: 'c1',
                name: 'Dairy',
                color: '#3b82f6',
                values: [120000, 140000, 160000, 150000, 180000, 210000],
              },
              {
                id: 'c2',
                name: 'Staples',
                color: '#10b981',
                values: [80000, 95000, 110000, 105000, 125000, 130000],
              },
              {
                id: 'c3',
                name: 'Snacks',
                color: '#f59e0b',
                values: [50000, 60000, 75000, 80000, 90000, 110000],
              },
            ]}
            formatValue={formatPaise}
          />
        </div>

        {/* 5. Heatmap */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 lg:col-span-2">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
            Peak Invoicing Hours (7×24 Heatmap)
          </h2>
          <Heatmap
            cells={[
              { weekday: 1, hour: 10, bills: 12, netPaise: 84000 },
              { weekday: 1, hour: 11, bills: 28, netPaise: 196000 },
              { weekday: 1, hour: 18, bills: 45, netPaise: 350000 },
              { weekday: 1, hour: 19, bills: 60, netPaise: 480000 },
              { weekday: 5, hour: 18, bills: 75, netPaise: 620000 },
              { weekday: 6, hour: 19, bills: 92, netPaise: 810000 },
            ]}
          />
        </div>
      </div>
    </div>
  );
};
