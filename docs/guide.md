# Guide

## Browse the catalog

```ts
const page = await tl.datasets.list({ country: "NL", limit: 10 });
```

## Dataset metadata and samples

```ts
const ds = tl.dataset("nl-domino-poi");
const meta = await ds.metadata();
const sample = await ds.sample({ format: "geojson" }); // csv/json/geojson/kml
```

## Query features in an area (spatial, paged)

`items()` addresses the collection by slug directly — the OGC `collectionId`
**is** the dataset slug, so there is no metadata round-trip.

```ts
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
```

Stream every feature, paging transparently. The async iterator cancels the
in-flight request if you `break` early:

```ts
for await (const feature of tl.dataset("nl-domino-poi").iterItems({ pageSize: 500 })) {
  // ...
}
```

## Pull a whole dataset (bulk)

```ts
const fc = await tl.dataset("nl-domino-poi").toGeoJSON();   // FeatureCollection
```

## Stream a dataset to disk (Node only)

```ts
import { Client } from "@topolab/sdk";
import { download } from "@topolab/sdk/node";

const tl = new Client();
await download(tl.dataset("nl-domino-poi"), "exports/dominos-nl.geojson", { format: "geojson" });
```

`download` lives in the `@topolab/sdk/node` subpath because it writes to the
filesystem — the core entry point stays browser-safe. It creates the destination
directory if missing, and accepts an `AbortSignal` to cancel an in-flight export:

```ts
const ctrl = new AbortController();
await download(tl.dataset("nl-domino-poi"), "out.geojson", { signal: ctrl.signal });
```
