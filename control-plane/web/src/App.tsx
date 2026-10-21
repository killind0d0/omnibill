import React, { useState, useEffect } from 'react';
import { AdminMe } from './types';
import { apiRequest, setUnauthorizedHandler } from './utils/api';
import { Navbar } from './components/Navbar';
import { LoginScreen } from './screens/LoginScreen';
import { TenantsListScreen } from './screens/TenantsListScreen';
import { TenantDetailScreen } from './screens/TenantDetailScreen';
import { AuditLogScreen } from './screens/AuditLogScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export const App: React.FC = () => {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [currentTab, setCurrentTab] = useState<'tenants' | 'audit' | 'settings'>('tenants');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const checkAuth = async () => {
    try {
      setCheckingAuth(true);
      const me = await apiRequest<AdminMe>('/v1/admin/me');
      setAdmin(me);
    } catch {
      setAdmin(null);
    } finally {
      setCheckingAuth(false);
    }
  };

  useEffect(() => {
    // Intercept 401 unauthorized errors from any apiRequest
    setUnauthorizedHandler(() => {
      setAdmin(null);
      setSelectedTenantId(null);
    });

    checkAuth();
  }, []);

  const handleLoginSuccess = (adminMe: AdminMe) => {
    setAdmin(adminMe);
    setCurrentTab('tenants');
    setSelectedTenantId(null);
  };

  const handleLogout = () => {
    setAdmin(null);
    setSelectedTenantId(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <div className="text-slate-400 font-mono text-sm">Verifying administrative session...</div>
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
          />
        )}

        {currentTab === 'audit' && <AuditLogScreen />}

        {currentTab === 'settings' && <SettingsScreen />}
      </main>

      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        OmniBill Hardware-Secured Billing & Access Control Plane • Air-gapped & Offline-First
      </footer>
    </div>
  );
};
