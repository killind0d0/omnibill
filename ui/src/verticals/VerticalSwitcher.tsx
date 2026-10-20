// ui/src/verticals/VerticalSwitcher.tsx
// Multi-Vertical Switcher component for OmniBill ERP top navigation bar

import React, { useEffect } from 'react';
import { ShoppingCart, Truck, GraduationCap, HeartPulse, Sparkles, ChevronDown } from 'lucide-react';
import { VerticalMode } from './types';

export interface VerticalConfig {
  id: VerticalMode;
  name: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  activeBg: string;
  accentBorder: string;
  badge: string;
  shortcut: string;
}

export const VERTICALS: VerticalConfig[] = [
  {
    id: 'RETAIL',
    name: 'Retail Store POS',
    tagline: 'Barcode Scan • Fast Cashier • 80mm Slip',
    icon: ShoppingCart,
    color: 'text-emerald-400',
    activeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    accentBorder: 'border-emerald-500',
    badge: 'Supermarket / FMCG',
    shortcut: 'Alt+1',
  },
  {
    id: 'WHOLESALE',
    name: 'Wholesale & B2B',
    tagline: 'Multi-Line GST • Lot Batch Expiry • e-Way Bill',
    icon: Truck,
    color: 'text-blue-400',
    activeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    accentBorder: 'border-blue-500',
    badge: 'Distribution / Agency',
    shortcut: 'Alt+2',
  },
  {
    id: 'SCHOOL',
    name: 'School & College',
    tagline: 'Student Registry • Fee Heads • Term Vouchers',
    icon: GraduationCap,
    color: 'text-amber-400',
    activeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    accentBorder: 'border-amber-500',
    badge: 'Education / Academy',
    shortcut: 'Alt+3',
  },
  {
    id: 'HOSPITAL',
    name: 'Hospital & Clinic',
    tagline: 'UHID Patient • OPD Consult • Pharmacy • Ward',
    icon: HeartPulse,
    color: 'text-rose-400',
    activeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    accentBorder: 'border-rose-500',
    badge: 'Healthcare / Nursing',
    shortcut: 'Alt+4',
  },
];

interface VerticalSwitcherProps {
  currentVertical: VerticalMode;
  onSelectVertical: (mode: VerticalMode) => void;
  className?: string;
}

export const VerticalSwitcher: React.FC<VerticalSwitcherProps> = ({
  currentVertical,
  onSelectVertical,
  className = '',
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const activeConfig = VERTICALS.find((v) => v.id === currentVertical) || VERTICALS[0];
  const IconComponent = activeConfig.icon;

  // Keyboard shortcut listener: Alt+1, Alt+2, Alt+3, Alt+4
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          onSelectVertical('RETAIL');
        } else if (e.key === '2') {
          e.preventDefault();
          onSelectVertical('WHOLESALE');
        } else if (e.key === '3') {
          e.preventDefault();
          onSelectVertical('SCHOOL');
        } else if (e.key === '4') {
          e.preventDefault();
          onSelectVertical('HOSPITAL');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectVertical]);

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* Desktop Segmented Tab Buttons (For Wide Screens) */}
      <div className="hidden lg:flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 shadow-inner">
        {VERTICALS.map((v) => {
          const ItemIcon = v.icon;
          const isActive = v.id === currentVertical;
          return (
            <button
              key={v.id}
              onClick={() => onSelectVertical(v.id)}
              type="button"
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border ${
                isActive
                  ? `${v.activeBg} shadow-sm font-semibold`
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title={`${v.name} (${v.shortcut}) - ${v.tagline}`}
            >
              <ItemIcon className={`w-4 h-4 ${isActive ? v.color : 'text-slate-400'}`} />
              <span className="truncate">{v.name}</span>
              <kbd className="hidden xl:inline-block px-1.5 py-0.2 text-[10px] uppercase font-mono bg-slate-800/80 text-slate-400 rounded border border-slate-700/60">
                {v.shortcut}
              </kbd>
            </button>
          );
        })}
      </div>

      {/* Dropdown for Medium / Compact Screens */}
      <div className="flex lg:hidden relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          className="flex items-center space-x-2.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-100"
        >
          <IconComponent className={`w-4 h-4 ${activeConfig.color}`} />
          <span>{activeConfig.name}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {isOpen && (
          <div className="absolute left-0 top-full mt-2 w-64 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-50 p-1.5 backdrop-blur-md">
            <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Select Industry Vertical</span>
              <Sparkles className="w-3 h-3 text-cyan-400" />
            </div>
            {VERTICALS.map((v) => {
              const ItemIcon = v.icon;
              const isActive = v.id === currentVertical;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    onSelectVertical(v.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left flex items-start space-x-3 p-2 rounded-lg text-xs transition-colors ${
                    isActive ? v.activeBg : 'hover:bg-slate-800/80 text-slate-300'
                  }`}
                >
                  <ItemIcon className={`w-4 h-4 mt-0.5 ${v.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-100">{v.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{v.shortcut}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">{v.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
