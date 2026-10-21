import React, { useState, useEffect, createContext, useContext } from 'react';
import { BootState, AuthenticatedUser, AccessStatus, ClientSession } from './types';
import { apiGetBootState, apiGetAccessStatus, apiLogout } from './clientApi';
import { ActivationScreen } from './ActivationScreen';
import { LoginScreen } from './LoginScreen';
import { OwnerResetScreen } from './OwnerResetScreen';
import { ChangePasswordScreen } from './ChangePasswordScreen';
import { KeyRecoveryScreen } from './KeyRecoveryScreen';
import { AccessBanner } from './AccessBanner';

interface AccessContextValue {
  session: ClientSession | null;
  accessStatus: AccessStatus | null;
  logout: () => void;
  refreshAccessStatus: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue>({
  session: null,
  accessStatus: null,
  logout: () => {},
  refreshAccessStatus: async () => {},
});

export const useAccess = () => useContext(AccessContext);

interface BootGateProps {
  children: React.ReactNode;
}

type GateView =
  | 'loading'
  | 'activation'
  | 'key_recovery'
  | 'login'
  | 'owner_reset'
  | 'change_password'
  | 'app';

export const BootGate: React.FC<BootGateProps> = ({ children }) => {
  const [bootState, setBootState] = useState<BootState | null>(null);
  const [view, setView] = useState<GateView>('loading');
  const [session, setSession] = useState<ClientSession | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('omnibill_access_session');
        if (stored) return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const checkBoot = async () => {
    setView('loading');
    setInitError(null);
    try {
      const state = await apiGetBootState();
      setBootState(state);

      if (!state.has_primary_owner) {
        setView('activation');
        return;
      }

      if (session) {
        if (session.user.must_change_password) {
          setView('change_password');
        } else {
          setView('app');
          fetchStatus(session.token);
        }
      } else {
        setView('login');
      }
    } catch (err: any) {
      // If service is not running yet or in dev fallback, check if we have a saved session
      if (session) {
        setView('app');
      } else {
        // Fallback to login screen so UI remains operable
        setView('login');
      }
    }
  };

  const fetchStatus = async (token: string) => {
    try {
      const status = await apiGetAccessStatus(token);
      setAccessStatus(status);
    } catch {
      // Ignore background status polling errors
    }
  };

  useEffect(() => {
    checkBoot();
  }, []);

  const handleLoginSuccess = (token: string, user: AuthenticatedUser) => {
    const newSession: ClientSession = {
      token,
      user,
      vertical: bootState?.vertical || 'retail',
    };
    setSession(newSession);
    try {
      localStorage.setItem('omnibill_access_session', JSON.stringify(newSession));
    } catch {}

    if (user.must_change_password) {
      setView('change_password');
    } else {
      setView('app');
      fetchStatus(token);
    }
  };

  const handlePasswordChanged = () => {
    if (session) {
      const updated: ClientSession = {
        ...session,
        user: {
          ...session.user,
          must_change_password: false,
        },
      };
      setSession(updated);
      try {
        localStorage.setItem('omnibill_access_session', JSON.stringify(updated));
      } catch {}
      fetchStatus(session.token);
    }
    setView('app');
  };

  const handleLogout = async () => {
    if (session) {
      await apiLogout(session.token);
    }
    setSession(null);
    setAccessStatus(null);
    try {
      localStorage.removeItem('omnibill_access_session');
    } catch {}
    setView('login');
  };

  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <div className="text-slate-400 font-mono text-sm">Checking hardware security & license state...</div>
      </div>
    );
  }

  if (view === 'activation') {
    return (
      <ActivationScreen
        onActivated={() => {
          checkBoot();
        }}
        onOpenKeyRecovery={() => setView('key_recovery')}
      />
    );
  }

  if (view === 'key_recovery') {
    return (
      <KeyRecoveryScreen
        onBack={() => setView(bootState?.has_primary_owner ? 'login' : 'activation')}
        onKeyImported={() => {
          checkBoot();
        }}
      />
    );
  }

  if (view === 'owner_reset') {
    return (
      <OwnerResetScreen
        onBackToLogin={() => setView('login')}
        onResetSuccess={() => setView('login')}
      />
    );
  }

  if (view === 'login') {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        onOpenOwnerReset={() => setView('owner_reset')}
        onOpenActivation={() => setView('activation')}
      />
    );
  }

  if (view === 'change_password' && session) {
    return (
      <ChangePasswordScreen
        token={session.token}
        username={session.user.username}
        onPasswordChanged={handlePasswordChanged}
      />
    );
  }

  return (
    <AccessContext.Provider
      value={{
        session,
        accessStatus,
        logout: handleLogout,
        refreshAccessStatus: () => (session ? fetchStatus(session.token) : Promise.resolve()),
      }}
    >
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {accessStatus && <AccessBanner status={accessStatus} />}
        <div className="flex-1">{children}</div>
      </div>
    </AccessContext.Provider>
  );
};
