// Client API bridge for Access Control & Authentication
import { BootState, AuthenticatedUser, AccessStatus, ActivateResult } from './types';

const BRIDGE_HOST = typeof window !== 'undefined' ? (window.location.hostname || '127.0.0.1') : '127.0.0.1';
const BRIDGE_PORT = '4000';
const BASE_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

export async function clientRequest<T>(
  route: string,
  options?: {
    method?: string;
    token?: string | null;
    body?: any;
    vertical?: string;
  }
): Promise<T> {
  const method = options?.method || 'POST';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  // Determine active vertical for dynamic database routing
  let vert = options?.vertical;
  if (!vert && typeof window !== 'undefined') {
    try {
      const activeV = localStorage.getItem('omnibill_active_vertical');
      if (activeV) {
        vert = activeV;
      } else {
        const sess = localStorage.getItem('omnibill_active_session');
        if (sess) {
          const parsed = JSON.parse(sess);
          vert = parsed.businessType;
        } else {
          const acc = localStorage.getItem('omnibill_access_session');
          if (acc) {
            const parsedAcc = JSON.parse(acc);
            vert = parsedAcc.vertical;
          }
        }
      }
    } catch {}
  }
  const chosenVertical = (vert || 'RETAIL').toString().toLowerCase();
  headers['X-Vertical'] = chosenVertical;
  headers['X-Business-Type'] = chosenVertical.toUpperCase();

  try {
    const res = await fetch(`${BASE_URL}${route}`, {
      method,
      headers,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data as T;
  } catch (err: any) {
    // If backend bridge is not currently running (e.g. during static UI testing),
    // provide consistent structured errors
    if (err.message && err.message.includes('Failed to fetch')) {
      throw new Error('Local OmniBill service is not reachable on port 4000.');
    }
    throw err;
  }
}

export async function apiGetBootState(): Promise<BootState> {
  return clientRequest<BootState>('/api/boot_state', { method: 'POST', body: {} });
}

export async function apiActivateLicence(
  tenantCode: string,
  ownerUsername: string,
  tempPassword: string
): Promise<ActivateResult> {
  return clientRequest<ActivateResult>('/api/activate_licence', {
    method: 'POST',
    body: {
      tenant_code: tenantCode.trim(),
      owner_username: ownerUsername.trim(),
      temp_password: tempPassword.trim(),
    },
  });
}

export async function apiLogin(
  username: string,
  password: string,
  vertical?: string
): Promise<{ token: string; user: AuthenticatedUser }> {
  return clientRequest<{ token: string; user: AuthenticatedUser }>('/api/login', {
    method: 'POST',
    vertical,
    body: {
      username: username.trim(),
      password,
    },
  });
}

export async function apiLogout(token: string): Promise<void> {
  try {
    await clientRequest('/api/logout', {
      method: 'POST',
      token,
      body: {},
    });
  } catch {
    // Ignore logout transport errors
  }
}

export async function apiChangePassword(
  token: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  await clientRequest('/api/change_password', {
    method: 'POST',
    token,
    body: {
      oldPassword,
      newPassword,
    },
  });
}

export async function apiOwnerResetWithCode(resetCode: string): Promise<{ success: boolean; message?: string }> {
  return clientRequest<{ success: boolean; message?: string }>('/api/owner_reset_with_code', {
    method: 'POST',
    body: {
      reset_code: resetCode.trim(),
    },
  });
}

export async function apiImportDatabaseKey(hexKey: string): Promise<void> {
  await clientRequest('/api/import_database_key', {
    method: 'POST',
    body: {
      hex_key: hexKey.trim(),
    },
  });
}

export async function apiGetAccessStatus(token?: string | null): Promise<AccessStatus> {
  return clientRequest<AccessStatus>('/api/access_status', {
    method: 'POST',
    token,
    body: {},
  });
}
