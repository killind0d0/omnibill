// ui/src/features/alerts/AlertsPanel.tsx
// Inventory Risk & Day-Close Alerts Panel
// Supports grouping by kind, sorting by severity then value, keyboard Enter to acknowledge,
// and navigation to Discovery Hub.

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Bell,
  AlertTriangle,
  Clock,
  TrendingDown,
  PackageX,
  CheckCircle2,
  X,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import {
  AlertItem,
  listAlerts,
  acknowledgeAlert,
  generateAlerts,
} from './api';
import { formatPaise } from '../discovery/format';

export interface AlertsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  vertical?: string;
  onNavigateToItem?: (resourceId: string, resourceName: string) => void;
}

type FilterKind = 'ALL' | 'expiry' | 'stockout' | 'dead' | 'below_reorder';

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  isOpen,
  onClose,
  vertical = 'retail',
  onNavigateToItem,
}) => {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKind>('ALL');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const data = await listAlerts(includeAcknowledged);
      setAlerts(data);
    } catch (e) {
      console.error('Failed to load alerts:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAlerts();
    }
  }, [isOpen, includeAcknowledged]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateAlerts(vertical);
      await loadAlerts();
    } catch (e) {
      console.error('Failed to generate alerts:', e);
    } finally {
      setGenerating(false);
    }
  };

  const handleAcknowledge = async (id: number) => {
    try {
      await acknowledgeAlert(id);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, acknowledgedDay: 1 } : a))
      );
      if (!includeAcknowledged) {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (e) {
      console.error('Failed to acknowledge alert:', e);
    }
  };

  // Group / Filter items
  const filteredAlerts = useMemo(() => {
    let list = alerts;
    if (activeFilter !== 'ALL') {
      list = list.filter((a) => a.kind === activeFilter);
    }
    // Sort by severity DESC, then value_paise DESC
    return [...list].sort((a, b) => {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return b.valuePaise - a.valuePaise;
    });
  }, [alerts, activeFilter]);

  // Handle keyboard navigation & Enter to acknowledge
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredAlerts.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        if (focusedIndex >= 0 && focusedIndex < filteredAlerts.length) {
          e.preventDefault();
          const target = filteredAlerts[focusedIndex];
          if (!target.acknowledgedDay) {
            handleAcknowledge(target.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusedIndex, filteredAlerts]);

  if (!isOpen) return null;

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case 'expiry':
        return {
          label: 'EXPIRY RISK',
          icon: Clock,
          color: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
        };
      case 'stockout':
        return {
          label: 'STOCKOUT DANGER',
          icon: AlertTriangle,
          color: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        };
      case 'dead':
        return {
          label: 'DEAD STOCK',
          icon: PackageX,
          color: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        };
      case 'below_reorder':
        return {
          label: 'REORDER RESTOCK',
          icon: TrendingDown,
          color: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
        };
      default:
        return {
          label: kind.toUpperCase(),
          icon: ShieldAlert,
          color: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
        };
    }
  };

  const getSeverityBadge = (sev: number) => {
    if (sev >= 3) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-rose-600 text-white shadow-xs">
          CRITICAL
        </span>
      );
    }
    if (sev === 2) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500 text-slate-950">
          WARNING
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-slate-700 text-slate-300">
        NOTICE
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Panel Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Inventory & Risk Alerts</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {filteredAlerts.length}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Sorted by severity & locked capital • Enter to acknowledge
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition cursor-pointer disabled:opacity-50"
              title="Recalculate risk alerts from product stats"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Bar & Options */}
        <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center space-x-1">
            {(
              [
                { id: 'ALL', label: 'All' },
                { id: 'expiry', label: 'Expiry' },
                { id: 'stockout', label: 'Stockout' },
                { id: 'dead', label: 'Dead' },
                { id: 'below_reorder', label: 'Reorder' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                  activeFilter === f.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeAcknowledged}
              onChange={(e) => setIncludeAcknowledged(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
            />
            <span>Show Acked</span>
          </label>
        </div>

        {/* Alerts List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-500 text-xs">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading alerts...
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500/40" />
              <p className="text-sm font-semibold text-slate-400">No active alerts found</p>
              <p className="text-xs text-slate-600 mt-1">
                Your inventory levels and product lifecycles are healthy.
              </p>
            </div>
          ) : (
            filteredAlerts.map((alert, idx) => {
              const kindBadge = getKindBadge(alert.kind);
              const KindIcon = kindBadge.icon;
              const isFocused = idx === focusedIndex;

              return (
                <div
                  key={alert.id}
                  onClick={() => setFocusedIndex(idx)}
                  className={`p-3 rounded-xl border transition-all duration-150 ${
                    alert.severity >= 3
                      ? 'border-rose-800/50 bg-rose-950/20 hover:bg-rose-950/30'
                      : alert.severity === 2
                      ? 'border-amber-800/40 bg-amber-950/20 hover:bg-amber-950/30'
                      : 'border-slate-800 bg-slate-900/60 hover:bg-slate-800/40'
                  } ${
                    isFocused ? 'ring-2 ring-blue-500 shadow-lg' : ''
                  } ${alert.acknowledgedDay ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border ${kindBadge.color}`}
                      >
                        <KindIcon className="w-3 h-3" />
                        <span>{kindBadge.label}</span>
                      </span>
                      {getSeverityBadge(alert.severity)}
                    </div>

                    {alert.valuePaise > 0 && (
                      <span className="text-xs font-mono font-semibold text-slate-200">
                        {formatPaise(alert.valuePaise)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2">
                    <h3 className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{alert.resourceName}</span>
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {alert.detail}
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {onNavigateToItem && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToItem(alert.resourceId, alert.resourceName);
                            onClose();
                          }}
                          className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
                        >
                          <span>Discovery</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div>
                      {alert.acknowledgedDay ? (
                        <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Acknowledged
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcknowledge(alert.id);
                          }}
                          className="flex items-center space-x-1 px-2 py-1 rounded bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 font-medium transition cursor-pointer text-[11px]"
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          <span>Acknowledge</span>
                          <kbd className="ml-1 text-[9px] px-1 py-0.2 rounded bg-slate-700 font-mono">
                            ↵
                          </kbd>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
