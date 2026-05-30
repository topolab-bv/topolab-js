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
| `tl.dataset(slug)` | `Dataset` | Lazy handle for one dataset |

## `Dataset`

| Method | Returns | Notes |
|---|---|---|
| `.metadata(locale?)` | `Promise<DatasetSummary>` | Dataset metadata |
| `.sample({ format? })` | `Promise<unknown>` | Free preview; `csv`/`json`/`geojson`/`kml` |
| `.toGeoJSON()` | `Promise<FeatureCollection>` | Full dataset (requires `API_ACCESS`) |
| `.items(query?)` | `Promise<FeatureCollection>` | One page of OGC features |
| `.iterItems(query?)` | `AsyncGenerator<Feature>` | Auto-paginates; cancels on early `break` |

### `ItemsQuery`

```ts
{ bbox?: [number, number, number, number]; limit?: number; offset?: number;
  category?: string; city?: string; country?: string }
```

## Node entry — `@topolab/sdk/node`

```ts
download(ds: Dataset, path: string, opts?: { format?: string; signal?: AbortSignal }): Promise<string>
```

Streams a bulk export to disk. Creates the destination directory if missing.
Formats: `csv`/`json`/`geojson`/`kml`/`shp`. Node-only — kept out of the core
entry so the browser bundle stays free of `node:` imports.

## Collections are addressed by slug

The OGC `collectionId` is the dataset's `table` slug (e.g. `nl-domino-poi`) — the
same value you pass to `dataset()`. The SDK calls
`/v1/ogc/collections/{slug}/items` directly; there is no slug→uuid resolution.
