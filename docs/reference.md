# API reference

## `Client`

```ts
new Client({
  apiKey?: string,        // defaults to process.env.TOPOLAB_API_KEY
  baseUrl?: string,       // explicit override (wins over environment)
  environment?: "production" | "staging",
  timeout?: number,       // ms, default 60000
  maxRetries?: number,    // default 3
  userAgent?: string,
})
```

| Member | Returns | Notes |
|---|---|---|
| `tl.datasets.list(query?)` | `Promise<DatasetPage>` | Catalog listing |
| `tl.datasets.owned(query?)` | `Promise<OwnedDatasets>` | One page of the datasets you licence |
| `tl.datasets.iterOwned(query?)` | `AsyncGenerator<OwnedDataset>` | Every licensed dataset; auto-paginates |
| `tl.dataset(slug)` | `Dataset` | Lazy handle for one dataset |
| `tl.sql(query, opts?)` | `Promise<SqlResult>` | Read-only SQL (Enterprise `sql-access`) |

### `OwnedQuery` / `IterOwnedQuery`

```ts
{ limit?: number; offset?: number }                 // limit 1-200 (server default 50), offset >= 0
{ pageSize?: number; totalLimit?: number }          // pageSize 1-200 (default 50)
```

### `OwnedDatasets` / `OwnedDataset`

```ts
{ items: OwnedDataset[]; total: number; limit: number; offset: number }

{ table: string; name: string; recordCount?: number | null;
  latestArchiveMonth?: string | null;       // "YYYY-MM", or null when none is in range
  latestArchiveFormats?: string[];
  archiveMonthsAvailable?: number;
  links: { current: string; archives: string; latestArchive: string | null } }
```

`total` counts **every** licensed dataset, not the rows on this page. `links`
values are absolute URLs; `current` and `latestArchive` contain a literal
`{format}` placeholder, and `latestArchive` may be `null`.

### `tl.sql(query, { maxRows? })`

```ts
{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number;
  truncated: boolean; elapsedMs: number; datasets: string[] }
```

`maxRows` is omitted from the request body when not given, leaving the server
default in place. Requires the `sql-access` entitlement (Enterprise); a query
that exceeds the server statement timeout throws `QueryTimeoutError` (408).

## `Dataset`

| Method | Returns | Notes |
|---|---|---|
| `.metadata(locale?)` | `Promise<DatasetSummary>` | Dataset metadata |
| `.sample({ format? })` | `Promise<unknown>` | Free preview; `csv`/`json`/`geojson`/`kml` |
| `.toGeoJSON()` | `Promise<FeatureCollection>` | Full dataset (requires `API_ACCESS`) |
| `.items(query?)` | `Promise<FeatureCollection>` | One page of OGC features |
| `.iterItems(query?)` | `AsyncGenerator<Feature>` | Auto-paginates; cancels on early `break` |
| `.archives()` | `Promise<Archive[]>` | Monthly snapshots, newest first; free |
| `.coordinates(query?)` | `Promise<CoordinatePage>` | Raw rows + attributes, paged via headers |

### `Archive`

```ts
{ month: string; formats: string[]; archiveDate?: string }   // month is "YYYY-MM"
```

The route answers with a bare JSON array (no envelope), newest month first,
already filtered to your retention window — Team plans see a trailing 12 months,
Enterprise and full-history add-ons see everything.

### `CoordinatesQuery` / `CoordinatePage`

```ts
{ limit?: number; offset?: number }        // limit 1-50000; omit both for the whole dataset

{ rows: CoordinateRow[]; total: number; returned: number; offset: number }

{ id: string; location: CoordinateGeometry;
  latitude: string; longitude: string;     // decimal strings, never coerced
  metadata: Record<string, unknown> }
```

The body is a bare array; `total` / `returned` / `offset` come from the
`X-Total-Count` / `X-Returned-Count` / `X-Offset` response headers. Missing or
unparseable headers fall back to `rows.length` (`total`, `returned`) and `0`
(`offset`) rather than failing a successful response.

### `ItemsQuery`

```ts
{ bbox?: [number, number, number, number]; limit?: number; offset?: number;
  category?: string; city?: string; country?: string }
```

## Node entry — `@topolab/sdk/node`

```ts
download(ds: Dataset, path: string, opts?: { format?: string; signal?: AbortSignal }): Promise<string>

downloadArchive(ds: Dataset, path: string,
                opts?: { month?: string; format?: string; signal?: AbortSignal }): Promise<string>
```

Both stream to disk, create the destination directory if missing, and accept an
`AbortSignal`. Formats: `csv`/`json`/`geojson`/`kml`/`shp`. Node-only — kept out
of the core entry so the browser bundle stays free of `node:` imports.

`downloadArchive` pulls one monthly archive (a zip, or gzip when the stored
object is gzipped). `month` defaults to `"latest"` and accepts `"latest"` (any
case), `"YYYY-MM"` or `"YYYY-MM-DD"`; `format` defaults to `"geojson"`. The
month is validated as a calendar value before the request is sent, so
`2026-13`, `2026-07-99` and `2026-02-29` throw locally while `2024-02-29` does
not. A real month with no archive available for you is a `NotFoundError` (404) —
out-of-retention and not-yet-started months are deliberately indistinguishable.

`normalizeArchiveMonth(month)` and `archivePath(slug, month, format)` are
exported from the core entry if you need the same validation without writing a
file.

## Collections are addressed by slug

The OGC `collectionId` is the dataset's `table` slug (e.g. `nl-domino-poi`) — the
same value you pass to `dataset()`. The SDK calls
`/v1/ogc/collections/{slug}/items` directly; there is no slug→uuid resolution.
