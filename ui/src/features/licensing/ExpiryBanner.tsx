import React from 'react';
import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import { AccessStatus } from '../access/types';
import { useAccess } from '../access/BootGate';

export interface ExpiryBannerProps {
  status?: AccessStatus | null;
  onOpenRenewal: () => void;
}

/**
 * Computes remaining days until expiry from valid_until_day (civil IST day or unix ms).
 * Returns null if valid_until_day is not provided.
 */
export function computeDaysUntilExpiry(
  validUntilDay: number | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (validUntilDay == null || isNaN(validUntilDay)) return null;

  let targetDay = validUntilDay;
  if (validUntilDay > 1_000_000_000_000) {
    // Unix millisecond timestamp converted to IST civil day index
    targetDay = Math.floor((validUntilDay + 19_800_000) / 86_400_000);
  } else if (validUntilDay > 1_000_000_000) {
    // Unix seconds timestamp converted to IST civil day index
    targetDay = Math.floor((validUntilDay * 1000 + 19_800_000) / 86_400_000);
  }

  const currentDay = Math.floor((nowMs + 19_800_000) / 86_400_000);
  return targetDay - currentDay;
}

export const ExpiryBanner: React.FC<ExpiryBannerProps> = ({ status: propStatus, onOpenRenewal }) => {
  let contextStatus: AccessStatus | null = null;
  try {
    const access = useAccess();
    contextStatus = access?.accessStatus || null;
  } catch {
    // In case used outside BootGate context
    contextStatus = null;
  }

  // Fallback to localStorage if status not available via props or context
  let fallbackStatus: AccessStatus | null = null;
  if (!propStatus && !contextStatus && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('omnibill_access_session');
      if (stored) {
        fallbackStatus = JSON.parse(stored);
      } else {
        const rawStatus = localStorage.getItem('omnibill_license_status');
        if (rawStatus) fallbackStatus = JSON.parse(rawStatus);
      }
    } catch {}
  }

  const activeStatus = propStatus || contextStatus || fallbackStatus;
  if (!activeStatus) return null;

  const days = computeDaysUntilExpiry(activeStatus.valid_until_day);
  const isGracePeriod =
    (days !== null && days <= 0 && days >= -5) ||
    activeStatus.reason === 'expired' ||
    (days !== null && days <= 0 && activeStatus.mode !== 'unlicensed');

  const isExpiringSoon = days !== null && days > 0 && days <= 7;

  // If active with plenty of time remaining, no banner is needed
  if (!isGracePeriod && !isExpiringSoon) {
    return null;
  }

  // Grace Period Warning (Rose)
  if (isGracePeriod) {
    return (
      <div
        className="bg-rose-950/95 border-b border-rose-800 text-rose-200 px-4 py-2.5 shadow-md sticky top-0 z-40 select-none animate-in fade-in duration-150"
        role="alert"
        aria-live="assertive"
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2 w-2 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
            </span>
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-bold text-white">
              Subscription in 5-day grace period. Billing will freeze soon.
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenRenewal}
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-900/40 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Renew Now</span>
          </button>
        </div>
      </div>
    );
  }

  // Expiring Soon Notice (Amber)
  return (
    <div
      className="bg-amber-950/90 border-b border-amber-700/80 text-amber-200 px-4 py-2 shadow-sm sticky top-0 z-40 select-none animate-in fade-in duration-150"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-amber-100">
            Subscription expiring in <strong className="text-white underline">{days} {days === 1 ? 'day' : 'days'}</strong>. Renew to avoid service interruption.
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenRenewal}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-xs transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Renew Now</span>
        </button>
      </div>
    </div>
  );
};
