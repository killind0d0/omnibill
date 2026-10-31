import React, { useState, useEffect } from 'react';
import { AdminMe, TenantSummary } from './types';
import { apiRequest, setUnauthorizedHandler } from './utils/api';
import { Navbar, NavTab } from './components/Navbar';
import { LoginScreen } from './screens/LoginScreen';
import { TenantsListScreen } from './screens/TenantsListScreen';
import { TenantDetailScreen } from './screens/TenantDetailScreen';
import { AuditLogScreen } from './screens/AuditLogScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { LiveSupportScreen } from './screens/LiveSupportScreen';

export const App: React.FC = () => {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<NavTab>('tenants');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [supportTenant, setSupportTenant] = useState<TenantSummary | null>(null);

  const checkAuth = async () => {
    try {
      setCheckingAuth(true);
      // 1. Try local daemon session
      const me = await apiRequest<AdminMe>('/v1/admin/me');
      setAdmin(me);
    } catch {
      // 2. Fallback to Cloud Admin session in localStorage
      try {
        const stored = localStorage.getItem('omnibill_admin_cloud_session');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.username) {
            setAdmin(parsed);
            return;
          }
        }
      } catch {}
      setAdmin(null);
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // If 401 occurs, check if we are in cloud mode before kicking out
      const stored = localStorage.getItem('omnibill_admin_cloud_session');
      if (!stored) {
        setAdmin(null);
        setSelectedTenantId(null);
      }
    });

    checkAuth();
  }, []);

  const handleLoginSuccess = (adminMe: AdminMe) => {
    setAdmin(adminMe);
    setCurrentTab('tenants');
    setSelectedTenantId(null);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('omnibill_admin_cloud_session');
    } catch {}
    setAdmin(null);
    setSelectedTenantId(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <div className="text-slate-400 font-mono text-sm">Verifying Super Admin session...</div>
      </div>
    );
  }

  if (!admin) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <Navbar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setSelectedTenantId(null);
        }}
        admin={admin}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === 'tenants' && !selectedTenantId && (
          <TenantsListScreen onSelectTenant={(id) => setSelectedTenantId(id)} />
        )}

        {currentTab === 'tenants' && selectedTenantId && (
          <TenantDetailScreen
            tenantId={selectedTenantId}
            onBack={() => setSelectedTenantId(null)}
            onStartLiveSupport={(tenant) => {
              setSupportTenant(tenant);
              setCurrentTab('support');
            }}
          />
        )}

        {currentTab === 'support' && (
          <LiveSupportScreen
            initialTenant={supportTenant}
            onClearTenant={() => setSupportTenant(null)}
            onBackToTenants={() => {
              setCurrentTab('tenants');
              setSelectedTenantId(null);
            }}
          />
        )}

        {currentTab === 'audit' && <AuditLogScreen />}

        {currentTab === 'settings' && <SettingsScreen />}
      </main>

      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500 space-y-1">
        <div>OmniBill Super Admin Control Plane • Serverless Cloud & Air-Gapped POS</div>
        <div className="text-[11px] text-slate-600">
          Sync Registry: <span className="font-mono text-slate-400">killind0d0/omnibill-licenses</span>
        </div>
      </footer>
    </div>
  );
};
