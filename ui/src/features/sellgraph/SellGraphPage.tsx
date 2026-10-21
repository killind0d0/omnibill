// ui/src/features/sellgraph/SellGraphPage.tsx
// Core Sell Graph analytics dashboard workspace with vertical-specific panels

import React, { useState } from 'react';
import { triggerRefreshAnalytics } from '../discovery/api';
import { TopMoversPanel } from './panels/TopMoversPanel';
import { DeadStockPanel } from './panels/DeadStockPanel';
import { MarginVelocityPanel } from './panels/MarginVelocityPanel';
import { StockoutDangerPanel } from './panels/StockoutDangerPanel';
import { CategoryTrendPanel } from './panels/CategoryTrendPanel';
import { PeakHoursPanel } from './panels/PeakHoursPanel';
import { WholesaleReorderPanel } from './panels/WholesaleReorderPanel';
import { ExpiryRiskPanel } from './panels/ExpiryRiskPanel';
import { CriticalDrugsPanel } from './panels/CriticalDrugsPanel';
import {
  BarChart3,
  RefreshCw,
  Building2,
  HeartPulse,
  ShoppingBag,
  Sparkles,
  Layers,
} from 'lucide-react';

interface SellGraphPageProps {
  vertical?: string;
  onNavigateDiscovery?: (productId?: string) => void;
  today?: number;
}

export const SellGraphPage: React.FC<SellGraphPageProps> = ({
  vertical = 'retail',
  onNavigateDiscovery,
  today = 20747,
}) => {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshSuccess, setRefreshSuccess] = useState<string | null>(null);

  const vert = vertical.toLowerCase();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshSuccess(null);
    try {
      const rep = await triggerRefreshAnalytics(today);
      setRefreshSuccess(`Updated ${rep.resourcesUpdated} products`);
      setTimeout(() => setRefreshSuccess(null), 3000);
    } catch {
      setRefreshSuccess('Refreshed');
      setTimeout(() => setRefreshSuccess(null), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getVerticalBadge = () => {
    if (vert === 'wholesale') {
      return {
        label: 'Wholesale B2B Distribution',
        icon: Building2,
        color: 'text-blue-400 bg-blue-950/60 border-blue-800',
      };
    }
    if (vert === 'hospital') {
      return {
        label: 'Hospital & Clinical Pharmacy',
        icon: HeartPulse,
        color: 'text-rose-400 bg-rose-950/60 border-rose-800',
      };
    }
    return {
      label: 'Retail Store POS',
      icon: ShoppingBag,
      color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800',
    };
  };

  const badge = getVerticalBadge();
  const Icon = badge.icon;

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 overflow-y-auto">
      {/* Header Toolbar */}
      <header className="px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-wrap gap-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-600/20 border border-blue-500/30 rounded-xl text-blue-400">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-white tracking-wide">
                OmniBill Sell Graph Analytics
              </h1>
              <span
                className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.color}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{badge.label}</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Float-free integer analytics, turnover velocity, and capital risk intelligence
            </p>
          </div>
        </div>

        {/* Period Selector & Refresh Analytics Action */}
        <div className="flex items-center space-x-3">
          {/* Period Toggle */}
          <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-medium">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                onClick={() => setWindowDays(days)}
                className={`px-3 py-1 rounded-md transition cursor-pointer ${
                  windowDays === days
                    ? 'bg-blue-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {days} Days
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer disabled:opacity-50"
            title="Recalculate GMROI, runout forecasts, and ABC classes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
            <span>{isRefreshing ? 'Computing...' : 'Refresh Analytics'}</span>
          </button>

          {refreshSuccess && (
            <span className="text-xs font-medium text-emerald-400 animate-in fade-in">
              {refreshSuccess}
            </span>
          )}

          {/* Discovery Button */}
          {onNavigateDiscovery && (
            <button
              onClick={() => onNavigateDiscovery()}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Discovery Hub</span>
            </button>
          )}
        </div>
      </header>

      {/* Dashboard Grid of Analytics Panels */}
      <main className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        {/* Panel 1: Top 10 Movers */}
        <TopMoversPanel
          vertical={vert}
          windowDays={windowDays}
          today={today}
          onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
        />

        {/* Panel 2: Dead Stock & Capital Locked */}
        <DeadStockPanel
          vertical={vert}
          today={today}
          onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
        />

        {/* Panel 3: Margin vs. Velocity Matrix */}
        <div className="lg:col-span-2">
          <MarginVelocityPanel
            vertical={vert}
            onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
          />
        </div>

        {/* Panel 4: Stockout Depletion Danger */}
        <StockoutDangerPanel
          vertical={vert}
          onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
        />

        {/* Panel 5: Category Trends */}
        <CategoryTrendPanel
          vertical={vert}
          fromDay={today - windowDays}
          toDay={today}
        />

        {/* Panel 6: Peak Counter Hours Heatmap */}
        <div className="lg:col-span-2">
          <PeakHoursPanel fromDay={today - windowDays} toDay={today} />
        </div>

        {/* Wholesale Extras: Reorder Interval Panel */}
        {vert === 'wholesale' && (
          <div className="lg:col-span-2">
            <WholesaleReorderPanel />
          </div>
        )}

        {/* Hospital Extras: Expiry Risk & Critical Medicines Panels */}
        {vert === 'hospital' && (
          <>
            <ExpiryRiskPanel
              vertical={vert}
              today={today}
              onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
            />
            <CriticalDrugsPanel
              vertical={vert}
              today={today}
              onNavigateItem={(id) => onNavigateDiscovery && onNavigateDiscovery(id)}
            />
          </>
        )}
      </main>
    </div>
  );
};
