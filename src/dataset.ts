import type { Transport } from "./transport";
import type {
  Archive,
  CoordinatePage,
  CoordinateRow,
  CoordinatesQuery,
  DatasetSummary,
  FeatureCollection,
  Feature,
  ItemsQuery,
} from "./types";

const SAMPLE_FORMATS = new Set(["csv", "json", "geojson", "kml"]);
/** Formats a bulk export or a monthly archive can be requested in. */
export const ARCHIVE_FORMATS = new Set(["csv", "json", "geojson", "kml", "shp"]);
const MAX_COORDINATES = 50000;
const MONTH_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one — leap years included.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Normalise an archive `month` to its wire form, rejecting anything the server
 *  would answer with a 400. Accepts `latest` (any case), `YYYY-MM` and
 *  `YYYY-MM-DD`, and validates the calendar value rather than only the shape:
 *  `2026-13`, `2026-07-99` and `2026-02-29` are all rejected here, so a bad
 *  month costs neither a round trip nor a credit. */
export function normalizeArchiveMonth(month: string): string {
  if (typeof month === "string" && month.toLowerCase() === "latest") return "latest";
  const m = MONTH_RE.exec(month);
  if (m) {
    const [, y, mo, d] = m;
    const year = Number(y);
    const monthNo = Number(mo);
    if (monthNo >= 1 && monthNo <= 12) {
      if (d === undefined) return month;
      const day = Number(d);
      if (day >= 1 && day <= daysInMonth(year, monthNo)) return month;
    }
  }
  throw new Error(`archive month must be "latest", YYYY-MM or YYYY-MM-DD; got ${month}`);
}

/** Build the archive download path for a dataset, validating month and format. */
export function archivePath(slug: string, month: string, format: string): string {
  if (!ARCHIVE_FORMATS.has(format))
    throw new Error(`archive format must be one of ${[...ARCHIVE_FORMATS].join(", ")}`);
  return `/v1/dataset/${slug}/archives/${normalizeArchiveMonth(month)}/${format}`;
}

function boundedInt(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}; got ${value}`);
  return value;
}

/** Read an integer paging header, tolerating a missing or unparseable value —
 *  paging facts are metadata, never a reason to fail a successful response. */
function headerInt(headers: Headers, name: string, fallback: number): number {
  const raw = headers.get(name);
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function itemsParams(q: ItemsQuery): Record<string, unknown> {
  const p: Record<string, unknown> = {
    limit: q.limit,
    offset: q.offset,
    category: q.category,
    city: q.city,
    country: q.country,
  };
  if (q.bbox) p.bbox = q.bbox.join(",");
  return p;
}

export class Dataset {
  constructor(readonly t: Transport, public readonly slug: string) {}

  metadata(locale?: string): Promise<DatasetSummary> {
    return this.t.getJson<DatasetSummary>(`/v1/dataset/${this.slug}`, locale ? { locale } : undefined);
  }

  toGeoJSON(): Promise<FeatureCollection> {
    return this.t.getJson<FeatureCollection>(`/v1/dataset/${this.slug}/files/geojson`);
  }

  async sample(opts: { format?: string } = {}): Promise<unknown> {
    const format = opts.format ?? "geojson";
    if (!SAMPLE_FORMATS.has(format))
      throw new Error(`sample format must be one of ${[...SAMPLE_FORMATS].join(", ")}`);
    const resp = await this.t.request(`/v1/dataset/${this.slug}/sample/${format}`);
    return format === "json" || format === "geojson" ? resp.json() : resp.text();
  }

  // The OGC collectionId is the dataset slug, so items() addresses the
  // collection by slug directly — no metadata round-trip needed.
  async items(q: ItemsQuery = {}): Promise<FeatureCollection> {
    return this.t.getJson<FeatureCollection>(
      `/v1/ogc/collections/${this.slug}/items`,
      itemsParams({ limit: 100, ...q }),
    );
  }

  /** Monthly archives available to this organization, newest month first.
   *  Already filtered to the plan's retention window, so it never lists a month
   *  that would 404. Free — no credits are charged. Requires the
   *  `archived-data` add-on. */
  archives(): Promise<Archive[]> {
    // The route answers with a bare JSON array, not a paging envelope.
    return this.t.getJson<Archive[]>(`/v1/dataset/${this.slug}/archives/list`);
  }

  /** One page of coordinate rows with their attribute bag. The body is a bare
   *  array and the paging facts arrive as `X-Total-Count` / `X-Returned-Count` /
   *  `X-Offset` headers, so this reads the raw response. Omit both parameters to
   *  receive the whole dataset in one response, capped at 50000 rows. */
  async coordinates(q: CoordinatesQuery = {}): Promise<CoordinatePage> {
    if (q.limit != null) boundedInt("limit", q.limit, 1, MAX_COORDINATES);
    if (q.offset != null) boundedInt("offset", q.offset, 0, Number.MAX_SAFE_INTEGER);
    const resp = await this.t.request(`/v1/dataset/${this.slug}/coordinates`, {
      limit: q.limit,
      offset: q.offset,
    });
    const rows = ((await resp.json()) ?? []) as CoordinateRow[];
    return {
      rows,
      total: headerInt(resp.headers, "x-total-count", rows.length),
      returned: headerInt(resp.headers, "x-returned-count", rows.length),
      offset: headerInt(resp.headers, "x-offset", 0),
    };
  }

  async *iterItems(
    q: { pageSize?: number; totalLimit?: number } & Omit<ItemsQuery, "limit" | "offset"> = {},
  ): AsyncGenerator<Feature> {
    const pageSize = q.pageSize ?? 100;
    let yielded = 0;
    let offset = 0;
    const ctrl = new AbortController();
    try {
      while (true) {
        const fc = await this.t.getJson<FeatureCollection>(
          `/v1/ogc/collections/${this.slug}/items`,
          itemsParams({ ...q, limit: pageSize, offset }),
          ctrl.signal,
        );
        const feats = fc.features ?? [];
        if (feats.length === 0) return;
        for (const f of feats) {
          yield f;
          yielded++;
          if (q.totalLimit != null && yielded >= q.totalLimit) return;
        }
        if (feats.length < pageSize) return;
        offset += pageSize;
      }
    } finally {
      ctrl.abort(); // cancel any in-flight request if the caller breaks early
    }
  }
}
