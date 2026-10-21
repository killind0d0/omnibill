// ui/src/features/alerts/api.ts
// IPC & HTTP client for Inventory Risk & Day-Close Alerts

import { getDbPath } from '../../lib/api';

export interface AlertItem {
  id: number;
  day: number;
  kind: 'expiry' | 'stockout' | 'dead' | 'below_reorder';
  resourceId: string;
  resourceName: string;
  severity: number;
  valuePaise: number;
  detail: string;
  acknowledgedDay?: number | null;
}

export interface GenerateAlertsReport {
  expiryAlerts: number;
  stockoutAlerts: number;
  deadAlerts: number;
  reorderAlerts: number;
  totalGenerated: number;
}

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown })
      .__TAURI_INTERNALS__ ||
      (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI__
  );

export async function generateAlerts(
  vertical?: string,
  today?: number
): Promise<GenerateAlertsReport> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<GenerateAlertsReport>('cmd_generate_alerts', {
      db_path: getDbPath(),
      vertical,
      today,
    });
  }

  const res = await fetch('http://127.0.0.1:4000/api/alerts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vertical, today }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Failed to generate alerts');
  }
  return await res.json();
}

export async function listAlerts(includeAcknowledged: boolean = false): Promise<AlertItem[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<AlertItem[]>('cmd_list_alerts', {
      db_path: getDbPath(),
      include_acknowledged: includeAcknowledged,
    });
  }

  const res = await fetch('http://127.0.0.1:4000/api/alerts/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeAcknowledged }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Failed to list alerts');
  }
  return await res.json();
}

export async function acknowledgeAlert(alertId: number, today?: number): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('cmd_acknowledge_alert', {
      db_path: getDbPath(),
      alert_id: alertId,
      today,
    });
    return;
  }

  const res = await fetch('http://127.0.0.1:4000/api/alerts/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alertId, today }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Failed to acknowledge alert');
  }
}
