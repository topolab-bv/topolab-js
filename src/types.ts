import type { Feature, FeatureCollection } from "geojson";
export type { Feature, FeatureCollection };

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
  timeout?: number;
  maxRetries?: number;
  userAgent?: string;
}
