import type { Feature, FeatureCollection, Geometry, GeometryCollection } from "geojson";
export type { Feature, FeatureCollection, Geometry };

export interface DatasetSummary {
  id: string;
  table: string;
  theme?: string;
  country?: string;
  metadata?: Record<string, unknown>;
}
export interface PageMeta {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}
export interface DatasetPage {
  data: DatasetSummary[];
  meta: PageMeta;
}

export interface ItemsQuery {
  bbox?: [number, number, number, number];
  limit?: number;
  offset?: number;
  category?: string;
  city?: string;
  country?: string;
}
export interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
  theme?: string;
  country?: string;
  sortBy?: string;
  sortOrder?: "ASC" | "DESC";
}
export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Named API environment: "production" (default) or "staging". */
  environment?: "production" | "staging";
  timeout?: number;
  maxRetries?: number;
  userAgent?: string;
}

// --- Backend integration: pull what you own, on your own schedule ---

/** Absolute URLs from an owned-dataset entry, so an integration can follow links
 *  instead of building paths. `current` and `latestArchive` carry a literal
 *  `{format}` placeholder. */
export interface OwnedDatasetLinks {
  current: string;
  archives: string;
  /** null when no archive falls inside the organization's retention window. */
  latestArchive: string | null;
}
/** A dataset the calling organization holds an active licence for. Every entry is
 *  downloadable — the listing is filtered by the same licence check the download
 *  routes enforce. */
export interface OwnedDataset {
  table: string;
  name: string;
  recordCount?: number | null;
  /** Newest archive month (`YYYY-MM`) inside the retention window, or null. */
  latestArchiveMonth?: string | null;
  latestArchiveFormats?: string[];
  /** How many archive months are inside the retention window. */
  archiveMonthsAvailable?: number;
  links: OwnedDatasetLinks;
}
export interface OwnedDatasets {
  items: OwnedDataset[];
  /** Total licensed datasets, not the size of this page. */
  total: number;
  limit: number;
  offset: number;
}
export interface OwnedQuery {
  /** 1–200; the server defaults to 50. */
  limit?: number;
  /** >= 0; defaults to 0. */
  offset?: number;
}
export interface IterOwnedQuery {
  /** Rows fetched per request (1–200), default 50. */
  pageSize?: number;
  /** Stop after this many datasets have been yielded. */
  totalLimit?: number;
}

/** One monthly snapshot of a dataset. */
export interface Archive {
  /** `YYYY-MM`. */
  month: string;
  formats: string[];
  archiveDate?: string;
}

/** GeoJSON geometry as returned by the coordinates route — always carries
 *  `coordinates` (a GeometryCollection is never emitted here). */
export type CoordinateGeometry = Exclude<Geometry, GeometryCollection>;
export interface CoordinateRow {
  id: string;
  location: CoordinateGeometry;
  /** Sent by the API as a decimal string, and kept as one — parsing it to a
   *  number would silently lose precision the API deliberately preserves. */
  latitude: string;
  /** Decimal string; see `latitude`. */
  longitude: string;
  /** Attribute bag. Advanced-tier fields (email, phone, website, hours,
   *  services) are present only for organizations entitled to high-value data. */
  metadata: Record<string, unknown>;
}
/** A page of coordinate rows. The paging facts arrive as response headers
 *  (`X-Total-Count`, `X-Returned-Count`, `X-Offset`), not in the body. */
export interface CoordinatePage {
  rows: CoordinateRow[];
  /** Total rows in the dataset, regardless of paging. */
  total: number;
  /** Rows in this response. */
  returned: number;
  /** Offset applied. */
  offset: number;
}
export interface CoordinatesQuery {
  /** 1–50000. Omit both parameters to receive the whole dataset in one response. */
  limit?: number;
  /** >= 0. */
  offset?: number;
}

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True when the result was cut off at the row cap. */
  truncated: boolean;
  elapsedMs: number;
  /** Licensed tables the query actually read, resolved from the query plan. */
  datasets: string[];
}
