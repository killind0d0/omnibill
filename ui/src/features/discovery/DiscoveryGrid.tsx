// ui/src/features/discovery/DiscoveryGrid.tsx
// High-performance windowed grid (~60 lines windowing engine, fixed 36px rows, zero external dependencies)

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { ProductDiscoveryItem, SortKey, SortSpec } from './types';
import { formatBp, formatDay, formatDaysX10, formatPaise, formatQtyMilli } from './format';
import { AlertCircle, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';

interface DiscoveryGridProps {
  items: ProductDiscoveryItem[];
  sort: SortSpec[];
  onToggleSort: (key: SortKey, additive: boolean) => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  onSelectProduct?: (product: ProductDiscoveryItem) => void;
  today?: number;
}

const ROW_HEIGHT = 36;
const OVERSCAN = 10;

export const DiscoveryGrid: React.FC<DiscoveryGridProps> = ({
  items,
  sort,
  onToggleSort,
  onLoadMore,
  isLoadingMore,
  onSelectProduct,
  today = 20747,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(600);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  // Measure container height on mount and resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setClientHeight(el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setClientHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Handle scroll and infinite loading trigger
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const top = target.scrollTop;
      setScrollTop(top);

      if (
        !isLoadingMore &&
        target.scrollHeight - (top + target.clientHeight) < ROW_HEIGHT * 10
      ) {
        onLoadMore();
      }
    },
    [isLoadingMore, onLoadMore]
  );

  // Keyboard navigation (↑/↓ focus, Enter select)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(items.length - 1, prev + 1);
          ensureVisible(next);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          ensureVisible(next);
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[focusedIndex];
        if (item && onSelectProduct) {
          onSelectProduct(item);
        }
      }
    },
    [items, focusedIndex, onSelectProduct]
  );

  const ensureVisible = (index: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rowTop = index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  };

  // Windowing math
  const totalHeight = items.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN
  );
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );
  const offsetY = startIndex * ROW_HEIGHT;

  const renderSortIcon = (key: SortKey) => {
    const idx = sort.findIndex((s) => s.key === key);
    if (idx === -1) return null;
    const item = sort[idx];
    return (
      <span className="inline-flex items-center text-blue-400 font-bold ml-1 text-[11px]">
        {item.dir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
        {sort.length > 1 && <span className="text-[9px] ml-0.5">{idx + 1}</span>}
      </span>
    );
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      className="flex-1 overflow-y-auto bg-slate-950 text-slate-200 select-none outline-none relative"
      role="grid"
      aria-rowcount={items.length}
    >
      {/* Sticky Table Header */}
      <div className="sticky top-0 z-10 flex items-center bg-slate-900 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider h-9">
        <div
          onClick={(e) => onToggleSort('name', e.shiftKey)}
          className="flex-1 min-w-[200px] px-3 flex items-center cursor-pointer hover:text-white"
        >
          Product / SKU {renderSortIcon('name')}
        </div>
        <div
          onClick={(e) => onToggleSort('stock', e.shiftKey)}
          className="w-24 text-right px-2 flex items-center justify-end cursor-pointer hover:text-white"
        >
          Stock {renderSortIcon('stock')}
        </div>
        <div
          onClick={(e) => onToggleSort('velocity', e.shiftKey)}
          className="w-24 text-right px-2 flex items-center justify-end cursor-pointer hover:text-white"
        >
          30d Qty {renderSortIcon('velocity')}
        </div>
        <div
          onClick={(e) => onToggleSort('margin', e.shiftKey)}
          className="w-20 text-right px-2 flex items-center justify-end cursor-pointer hover:text-white"
        >
          Margin {renderSortIcon('margin')}
        </div>
        <div
          onClick={(e) => onToggleSort('value', e.shiftKey)}
          className="w-28 text-right px-2 flex items-center justify-end cursor-pointer hover:text-white"
        >
          Sell Price {renderSortIcon('value')}
        </div>
        <div
          onClick={(e) => onToggleSort('runout', e.shiftKey)}
          className="w-24 text-right px-2 flex items-center justify-end cursor-pointer hover:text-white"
        >
          Runout {renderSortIcon('runout')}
        </div>
        <div
          onClick={(e) => onToggleSort('expiry', e.shiftKey)}
          className="w-28 text-center px-2 flex items-center justify-center cursor-pointer hover:text-white"
        >
          Expiry {renderSortIcon('expiry')}
        </div>
        <div
          onClick={(e) => onToggleSort('revenue', e.shiftKey)}
          className="w-28 text-right px-3 flex items-center justify-end cursor-pointer hover:text-white"
        >
          90d Rev {renderSortIcon('revenue')}
        </div>
      </div>

      {/* Grid Canvas with Windowing Virtual Offset */}
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${offsetY}px)`,
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
          }}
        >
          {visibleItems.map((item, idx) => {
            const actualIndex = startIndex + idx;
            const isFocused = actualIndex === focusedIndex;

            // Runout danger highlight: red < 70 (7 days), amber < 300 (30 days)
            let runoutColor = 'text-slate-300';
            if (item.runoutDaysX10 < 70) {
              runoutColor = 'text-rose-400 font-bold';
            } else if (item.runoutDaysX10 < 300) {
              runoutColor = 'text-amber-400';
            }

            // Expiry danger chip: red <= 30 days, amber <= 90 days
            const daysToExpiry = item.earliestExpiryDay - today;
            let expiryChip = null;
            if (item.earliestExpiryDay < 99999999 && item.stockMilli > 0) {
              if (daysToExpiry <= 30) {
                expiryChip = (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/80 text-rose-300 border border-rose-800">
                    {formatDay(item.earliestExpiryDay)}
                  </span>
                );
              } else if (daysToExpiry <= 90) {
                expiryChip = (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-800">
                    {formatDay(item.earliestExpiryDay)}
                  </span>
                );
              } else {
                expiryChip = (
                  <span className="text-slate-400 text-xs">
                    {formatDay(item.earliestExpiryDay)}
                  </span>
                );
              }
            } else {
              expiryChip = <span className="text-slate-600 text-xs">—</span>;
            }

            // ABC chip colors
            const abcColors: Record<number, string> = {
              1: 'bg-emerald-950 text-emerald-300 border-emerald-800',
              2: 'bg-blue-950 text-blue-300 border-blue-800',
              3: 'bg-slate-900 text-slate-400 border-slate-800',
            };
            const abcLabels: Record<number, string> = { 1: 'A', 2: 'B', 3: 'C' };

            return (
              <div
                key={item.id}
                onClick={() => {
                  setFocusedIndex(actualIndex);
                  if (onSelectProduct) onSelectProduct(item);
                }}
                className={`flex items-center h-9 px-0 text-xs border-b border-slate-900 cursor-pointer transition-colors ${
                  isFocused
                    ? 'bg-blue-950/60 text-white'
                    : 'hover:bg-slate-900/50 text-slate-300'
                }`}
                role="row"
                aria-selected={isFocused}
              >
                {/* Name, SKU, and ABC Chip */}
                <div className="flex-1 min-w-[200px] px-3 flex items-center space-x-2 truncate">
                  <span
                    className={`px-1 py-0.2 rounded border text-[10px] font-bold ${
                      abcColors[item.abcClass] || abcColors[3]
                    }`}
                  >
                    {abcLabels[item.abcClass] || 'C'}
                  </span>
                  <span className="font-semibold text-slate-100 truncate">{item.name}</span>
                  <span className="text-[11px] text-slate-500 font-mono">[{item.sku}]</span>
                </div>

                {/* Current Stock */}
                <div className="w-24 text-right px-2 font-mono">
                  {formatQtyMilli(item.stockMilli)}
                </div>

                {/* 30-Day Velocity */}
                <div className="w-24 text-right px-2 font-mono text-slate-400">
                  {formatQtyMilli(item.qty30Milli)}
                </div>

                {/* Margin */}
                <div className="w-20 text-right px-2 font-mono text-emerald-400">
                  {formatBp(item.marginBp)}
                </div>

                {/* Sell Price */}
                <div className="w-28 text-right px-2 font-mono font-semibold">
                  {formatPaise(item.sellPaise)}
                </div>

                {/* Runout Days */}
                <div className={`w-24 text-right px-2 font-mono ${runoutColor}`}>
                  {formatDaysX10(item.runoutDaysX10)}
                </div>

                {/* Expiry */}
                <div className="w-28 text-center px-2">{expiryChip}</div>

                {/* 90-Day Revenue */}
                <div className="w-28 text-right px-3 font-mono text-slate-400">
                  {formatPaise(item.rev90Paise)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Infinite Scroll Loader Indicator */}
      {isLoadingMore && (
        <div className="py-2 flex items-center justify-center text-xs text-blue-400 bg-slate-950/80">
          <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> Loading more products...
        </div>
      )}

      {/* Empty State */}
      {items.length === 0 && (
        <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
          <AlertCircle className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-sm font-semibold text-slate-400">No products match current filters</p>
          <p className="text-xs text-slate-600 mt-1">Try resetting filters or searching a different term</p>
        </div>
      )}
    </div>
  );
};
