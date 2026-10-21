// ui/src/features/discovery/store.ts
// Client-side query store with keyset pagination and URL hash synchronization.

import { useSyncExternalStore } from 'react';
import {
  DiscoveryPage,
  DiscoveryQuery,
  Facets,
  Preset,
  ProductDiscoveryItem,
  SortKey,
  SortSpec,
} from './types';
import { fetchDiscoveryFacets, fetchDiscoveryProducts, StaleResponseError } from './api';

export interface DiscoveryStoreState {
  query: DiscoveryQuery;
  items: ProductDiscoveryItem[];
  facets: Facets | null;
  nextCursor?: string;
  totalCapped: number;
  status: 'idle' | 'loading' | 'loadingMore' | 'error';
  error?: string;
  selectedRowId?: string;
}

const DEFAULT_QUERY: DiscoveryQuery = {
  brandIds: [],
  supplierIds: [],
  categoryIds: [],
  taxBp: [],
  abc: [],
  sort: [{ key: 'velocity', dir: 'desc' }],
  limit: 50,
};

let state: DiscoveryStoreState = {
  query: { ...DEFAULT_QUERY },
  items: [],
  facets: null,
  totalCapped: 0,
  status: 'idle',
};

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function updateState(partial: Partial<DiscoveryStoreState>) {
  state = { ...state, ...partial };
  notify();
}

/**
 * Serializes query into a size-capped URL hash string.
 */
export function queryToHash(q: DiscoveryQuery): string {
  try {
    const json = JSON.stringify(q);
    if (json.length > 2048) return '';
    return encodeURIComponent(json);
  } catch {
    return '';
  }
}

/**
 * Deserializes query from a URL hash string.
 */
export function queryFromHash(hash: string): DiscoveryQuery | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!raw) return null;
    const json = decodeURIComponent(raw);
    const parsed = JSON.parse(json) as DiscoveryQuery;
    return parsed;
  } catch {
    return null;
  }
}

let activeVertical = 'retail';

export const discoveryStore = {
  getState(): DiscoveryStoreState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setVertical(vertical: string) {
    activeVertical = vertical;
  },

  setSelectedRowId(id?: string) {
    updateState({ selectedRowId: id });
  },

  async loadInitial(vertical?: string) {
    if (vertical) activeVertical = vertical;
    updateState({ status: 'loading', error: undefined });

    try {
      const [page, facets] = await Promise.all([
        fetchDiscoveryProducts(state.query, activeVertical),
        fetchDiscoveryFacets(state.query, activeVertical),
      ]);

      updateState({
        items: page.items,
        nextCursor: page.nextCursor,
        totalCapped: page.totalCapped,
        facets,
        status: 'idle',
      });
    } catch (err: unknown) {
      if (err instanceof StaleResponseError) return;
      const message = err instanceof Error ? err.message : String(err);
      updateState({ status: 'error', error: message });
    }
  },

  async setFilter(partial: Partial<DiscoveryQuery>) {
    const newQuery: DiscoveryQuery = {
      ...state.query,
      ...partial,
      cursor: undefined, // Reset cursor on filter change
    };

    updateState({
      query: newQuery,
      items: [],
      nextCursor: undefined,
      status: 'loading',
      error: undefined,
    });

    try {
      const [page, facets] = await Promise.all([
        fetchDiscoveryProducts(newQuery, activeVertical),
        fetchDiscoveryFacets(newQuery, activeVertical),
      ]);

      updateState({
        items: page.items,
        nextCursor: page.nextCursor,
        totalCapped: page.totalCapped,
        facets,
        status: 'idle',
      });
    } catch (err: unknown) {
      if (err instanceof StaleResponseError) return;
      const message = err instanceof Error ? err.message : String(err);
      updateState({ status: 'error', error: message });
    }
  },

  async toggleSort(key: SortKey, additive: boolean) {
    let newSort: SortSpec[] = [];
    const currentSort = state.query.sort || [];

    if (!additive) {
      const existing = currentSort[0];
      if (existing && existing.key === key) {
        newSort = [{ key, dir: existing.dir === 'desc' ? 'asc' : 'desc' }];
      } else {
        newSort = [{ key, dir: 'desc' }];
      }
    } else {
      const existingIdx = currentSort.findIndex((s) => s.key === key);
      if (existingIdx >= 0) {
        const item = currentSort[existingIdx];
        if (item.dir === 'desc') {
          newSort = currentSort.map((s, idx) => (idx === existingIdx ? { ...s, dir: 'asc' as const } : s));
        } else {
          newSort = currentSort.filter((_, idx) => idx !== existingIdx);
        }
      } else if (currentSort.length < 3) {
        newSort = [...currentSort, { key, dir: 'desc' as const }];
      } else {
        newSort = currentSort;
      }
    }

    if (newSort.length === 0) {
      newSort = [{ key: 'velocity', dir: 'desc' }];
    }

    await this.setFilter({ sort: newSort });
  },

  async applyPreset(preset?: Preset) {
    await this.setFilter({ preset });
  },

  async loadMore() {
    if (!state.nextCursor || state.status === 'loading' || state.status === 'loadingMore') {
      return;
    }

    const nextQuery: DiscoveryQuery = {
      ...state.query,
      cursor: state.nextCursor,
    };

    updateState({ status: 'loadingMore' });

    try {
      const page: DiscoveryPage = await fetchDiscoveryProducts(nextQuery, activeVertical);
      updateState({
        items: [...state.items, ...page.items],
        nextCursor: page.nextCursor,
        totalCapped: page.totalCapped,
        status: 'idle',
      });
    } catch (err: unknown) {
      if (err instanceof StaleResponseError) return;
      const message = err instanceof Error ? err.message : String(err);
      updateState({ status: 'error', error: message });
    }
  },

  async reset() {
    await this.setFilter({
      text: undefined,
      brandIds: [],
      supplierIds: [],
      categoryIds: [],
      taxBp: [],
      sellPaise: undefined,
      costPaise: undefined,
      marginBp: undefined,
      stockMilli: undefined,
      receivedDay: undefined,
      lastSoldDay: undefined,
      expiryDay: undefined,
      preset: undefined,
      abc: [],
      sort: [{ key: 'velocity', dir: 'desc' }],
      limit: 50,
      cursor: undefined,
    });
  },
};

export function useDiscoveryStore(): DiscoveryStoreState {
  return useSyncExternalStore(discoveryStore.subscribe, discoveryStore.getState);
}
