// ui/src/features/discovery/api.ts
// Thin IPC bridge for Product Discovery Hub with monotonic request sequencing

import { DiscoveryPage, DiscoveryQuery, Facets } from './types';
import { getDbPath } from '../../lib/api';

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown })
      .__TAURI_INTERNALS__ ||
      (window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI__
  );

let nextProductsRequestId = 0;
let nextFacetsRequestId = 0;

export class StaleResponseError extends Error {
  constructor() {
    super('Stale request discarded');
    this.name = 'StaleResponseError';
  }
}

/**
 * Dispatches product discovery query with monotonic sequencing to ignore stale responses.
 */
export async function fetchDiscoveryProducts(
  query: DiscoveryQuery,
  vertical?: string
): Promise<DiscoveryPage> {
  const reqId = ++nextProductsRequestId;

  let page: DiscoveryPage;

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    page = await invoke<DiscoveryPage>('cmd_discover_products', {
      db_path: getDbPath(),
      query,
      vertical: vertical || 'retail',
    });
  } else {
    const res = await fetch('http://127.0.0.1:4000/api/discovery/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, vertical: vertical || 'retail' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || 'Failed to fetch discovery products');
    }
    page = (await res.json()) as DiscoveryPage;
  }

  if (reqId !== nextProductsRequestId) {
    throw new StaleResponseError();
  }

  return page;
}

/**
 * Dispatches facet discovery query with monotonic sequencing.
 */
export async function fetchDiscoveryFacets(
  query: DiscoveryQuery,
  vertical?: string
): Promise<Facets> {
  const reqId = ++nextFacetsRequestId;

  let facets: Facets;

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    facets = await invoke<Facets>('cmd_discover_facets', {
      db_path: getDbPath(),
      query,
      vertical: vertical || 'retail',
    });
  } else {
    const res = await fetch('http://127.0.0.1:4000/api/discovery/facets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, vertical: vertical || 'retail' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || 'Failed to fetch discovery facets');
    }
    facets = (await res.json()) as Facets;
  }

  if (reqId !== nextFacetsRequestId) {
    throw new StaleResponseError();
  }

  return facets;
}

/**
 * Triggers full statistics recalculation.
 */
export async function triggerRefreshAnalytics(today?: number): Promise<{
  resourcesUpdated: number;
  gmroiSkipped: number;
  inventorySnapshotsWritten: number;
}> {
  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('cmd_refresh_analytics', {
      db_path: getDbPath(),
      today,
    });
  }

  const res = await fetch('http://127.0.0.1:4000/api/discovery/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ today }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Failed to refresh analytics');
  }
  return await res.json();
}
