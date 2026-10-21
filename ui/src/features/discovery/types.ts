// ui/src/features/discovery/types.ts
// Pure integer contract mirroring Rust discovery data types

export interface Range {
  min?: number;
  max?: number;
}

export type SortKey =
  | 'name'
  | 'margin'
  | 'velocity'
  | 'stock'
  | 'runout'
  | 'expiry'
  | 'lastSold'
  | 'received'
  | 'value'
  | 'gmroi'
  | 'revenue';

export type Dir = 'asc' | 'desc';

export interface SortSpec {
  key: SortKey;
  dir: Dir;
}

export type Preset =
  | 'fast'
  | 'slow'
  | 'dead30'
  | 'dead60'
  | 'dead90'
  | 'expiring30'
  | 'expiring60'
  | 'expiring90'
  | 'out'
  | 'belowReorder'
  | 'overstock';

export interface DiscoveryQuery {
  text?: string;
  brandIds?: number[];
  supplierIds?: number[];
  categoryIds?: number[];
  taxBp?: number[];
  sellPaise?: Range;
  costPaise?: Range;
  marginBp?: Range;
  stockMilli?: Range;
  receivedDay?: Range;
  lastSoldDay?: Range;
  expiryDay?: Range;
  preset?: Preset;
  abc?: number[];
  sort?: SortSpec[];
  limit?: number;
  cursor?: string;
}

export interface ProductDiscoveryItem {
  id: string;
  sku: string;
  name: string;
  barcode?: string;
  brandId?: number;
  categoryId?: number;
  taxBp: number;
  sellPaise: number;
  avgCostPaise: number;
  marginBp: number;
  stockMilli: number;
  reorderMilli: number;
  maxStockMilli: number;
  stockValuePaise: number;
  earliestExpiryDay: number;
  lastReceivedDay: number;
  lastSoldDay: number;
  qty7Milli: number;
  qty30Milli: number;
  qty90Milli: number;
  rev90Paise: number;
  gp90Paise: number;
  runoutDaysX10: number;
  gmroiBp: number;
  abcClass: number; // 1 = A, 2 = B, 3 = C
  isCritical: boolean;
}

export interface DiscoveryPage {
  items: ProductDiscoveryItem[];
  nextCursor?: string;
  totalCapped: number;
}

export interface FacetItem {
  id: string;
  label: string;
  count: number;
}

export interface Facets {
  brands: FacetItem[];
  suppliers: FacetItem[];
  categories: FacetItem[];
  taxBp: FacetItem[];
}
