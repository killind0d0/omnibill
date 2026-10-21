import React from 'react';
import { AdminMe } from '../types';
import { apiRequest } from '../utils/api';

interface NavbarProps {
  currentTab: 'tenants' | 'audit' | 'settings';
  onSelectTab: (tab: 'tenants' | 'audit' | 'settings') => void;
  admin: AdminMe | null;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  admin,
  onLogout,
}) => {
  const handleLogout = async () => {
    try {
      await apiRequest('/v1/admin/logout', { method: 'POST' }).catch(() => {});
    } finally {
      onLogout();
    }
  };

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <div className="flex items-center gap-8">
            <div
              onClick={() => onSelectTab('tenants')}
              className="flex items-center gap-2.5 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20 group-hover:bg-indigo-500 transition-colors">
                OB
              </div>
              <div>
                <span className="font-bold text-base text-white tracking-tight">OmniBill</span>
                <span className="ml-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-800/80 rounded">
                  Control Plane
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => onSelectTab('tenants')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  currentTab === 'tenants'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                Businesses
              </button>
              <button
                onClick={() => onSelectTab('audit')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  currentTab === 'audit'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                Audit Log
              </button>
              <button
                onClick={() => onSelectTab('settings')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  currentTab === 'settings'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                Settings
              </button>
            </nav>
          </div>

          {/* User profile & Logout */}
          <div className="flex items-center gap-4">
            {admin && (
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Admin:</span>
                <span className="font-mono font-medium text-slate-200">{admin.username}</span>
              </div>
            )}

            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="sm:hidden flex items-center gap-1 pb-3 pt-1 border-t border-slate-800/60">
          <button
            onClick={() => onSelectTab('tenants')}
            className={`flex-1 py-1 text-center rounded text-xs font-medium ${
              currentTab === 'tenants' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Businesses
          </button>
          <button
            onClick={() => onSelectTab('audit')}
            className={`flex-1 py-1 text-center rounded text-xs font-medium ${
              currentTab === 'audit' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Audit Log
          </button>
          <button
            onClick={() => onSelectTab('settings')}
            className={`flex-1 py-1 text-center rounded text-xs font-medium ${
              currentTab === 'settings' ? 'bg-slate-800 text-white' : 'text-slate-400'
            }`}
          >
            Settings
          </button>
        </div>
      </div>
    </header>
  );
};
