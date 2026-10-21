// ui/src/features/sellgraph/useSellGraph.ts
// Data fetching hook for Sell Graph analytics with caching and refresh

import { useState, useEffect, useCallback } from 'react';
import { getDbPath } from '../../lib/api';

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown })
      .__TAURI_INTERNALS__ ||
      (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI__
  );

export async function fetchSellGraphData<T>(
  kind: string,
  params: Record<string, unknown> = {},
  vertical = 'retail'
): Promise<T> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>('cmd_sell_graph', {
      db_path: getDbPath(),
      kind,
      params,
      vertical,
    });
  }

  const res = await fetch('http://127.0.0.1:4000/api/discovery/sell_graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, params, vertical }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network failure' }));
    throw new Error(err.error || `Failed to fetch graph data for ${kind}`);
  }

  return (await res.json()) as T;
}

export function useSellGraphData<T>(
  kind: string,
  params: Record<string, unknown> = {},
  vertical = 'retail'
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSellGraphData<T>(kind, params, vertical);
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [kind, JSON.stringify(params), vertical]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
