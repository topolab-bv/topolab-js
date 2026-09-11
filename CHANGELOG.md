# Changelog

## Unreleased
### Added
- `tl.datasets.owned({limit, offset})` and `tl.datasets.iterOwned({pageSize, totalLimit})` —
  list the datasets your organization licences, or stream every one with
  transparent offset paging.
- `ds.archives()` — monthly snapshots available to you, newest month first,
  already filtered to your retention window.
- `downloadArchive(ds, path, {month, format})` in `@topolab/sdk/node` — stream one
  monthly archive to disk. `month` takes `latest`, `YYYY-MM` or `YYYY-MM-DD` and is
  validated as a real calendar value (leap years included) before the request is sent.
- `ds.coordinates({limit, offset})` — raw rows with their attribute bag; the paging
  facts are read from the `X-Total-Count` / `X-Returned-Count` / `X-Offset` headers,
  with safe fallbacks when they are missing. `latitude` / `longitude` stay strings.
- `tl.sql(query, {maxRows})` — one read-only SELECT across the datasets you licence
  (Enterprise `sql-access` entitlement). Transport now supports POST with a JSON body.
- `QueryTimeoutError` for 408 (a SQL query past the server statement timeout).
- Types: `OwnedDataset`, `OwnedDatasets`, `OwnedQuery`, `IterOwnedQuery`, `Archive`,
  `CoordinateRow`, `CoordinatePage`, `CoordinatesQuery`, `SqlResult`.

### Fixed
- `AddonRequiredError` was unreachable: the add-on match used a `\w+` capture,
  which stops at the hyphen in slugs such as `api-access`, so every add-on 403 was
  downgraded to `AccessDeniedError`. Both real message shapes now resolve, and
  `.addon` is normalised to the slug (`api-access`, `archived-data`, …).
- Error `.requestId` falls back to the envelope's `requestId` when the
  `X-Request-Id` header is absent. The envelope has no `statusCode` field, so error
  mapping continues to branch on the HTTP status.

## [0.1.0] - initial preview
- `Client` over native `fetch` (Node 18+ and modern browsers/edge).
- Dataset catalog, metadata, sample, bulk GeoJSON.
- OGC spatial `items()` with slug→collection resolution and `iterItems()` async iterator.
- Node-only streaming `download()` via `@topolab/sdk/node`.
- Typed error hierarchy with retry/backoff.
