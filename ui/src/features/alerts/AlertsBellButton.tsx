// ui/src/features/alerts/AlertsBellButton.tsx
// Top navigation bell button with unacknowledged risk count badge

import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { listAlerts, AlertItem } from './api';

interface AlertsBellButtonProps {
  onClick: () => void;
  className?: string;
}

export const AlertsBellButton: React.FC<AlertsBellButtonProps> = ({
  onClick,
  className = '',
}) => {
  const [unackedCount, setUnackedCount] = useState<number>(0);

  const refreshCount = async () => {
    try {
      const items: AlertItem[] = await listAlerts(false);
      setUnackedCount(items.length);
    } catch {
      // Backend may still be spinning up
    }
  };

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <button
      onClick={onClick}
      className={`relative p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer ${className}`}
      title={`Risk & Inventory Alerts (${unackedCount} unacknowledged)`}
    >
      <Bell className="w-4 h-4 text-amber-400" />
      {unackedCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white font-bold text-[10px] flex items-center justify-center shadow-xs animate-pulse">
          {unackedCount > 99 ? '99+' : unackedCount}
        </span>
      )}
    </button>
  );
};
