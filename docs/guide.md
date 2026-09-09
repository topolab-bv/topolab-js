# Guide

## Pull everything you own, on your own schedule

This is the loop the SDK exists for: discover what your organization licences,
then pull each dataset's newest snapshot. No hard-coded slugs, no catalog
crawling — `iterOwned()` is filtered by the same licence check the download
routes enforce, so everything it yields is downloadable.

```ts
import { Client } from "@topolab/sdk";
import { downloadArchive } from "@topolab/sdk/node";

const tl = new Client();

for await (const ds of tl.datasets.iterOwned()) {
  await downloadArchive(tl.dataset(ds.table), `${ds.table}.zip`, { month: "latest", format: "geojson" });
}
```

A single page, if you would rather drive the paging yourself:

```ts
const page = await tl.datasets.owned({ limit: 50, offset: 0 });
page.total;         // every licensed dataset, not the size of this page
page.items[0].table; // the slug used everywhere else
page.items[0].links; // absolute URLs — `current` and `latestArchive` carry a literal {format}
```

`iterOwned({ pageSize, totalLimit })` pages by offset until `total` is reached
and cancels the in-flight request if you `break` early.

## Monthly archives

`archives()` lists the snapshots available to you, newest month first. It is
free — no credits are charged — and already reflects your retention window, so
it never lists a month that would 404.

```ts
const ds = tl.dataset("business_professional_services_autocrew");
for (const a of await ds.archives()) {
  console.log(a.month, a.formats.join(", "), a.archiveDate); // "2026-07", "csv, geojson, …"
}
```

Download one with `downloadArchive` from the Node subpath (it writes a file, so
it lives beside `download`):

```ts
import { downloadArchive } from "@topolab/sdk/node";

await downloadArchive(ds, "autocrew-2026-07.zip", { month: "2026-07", format: "geojson" });
```

### Addressing an archive

`month` accepts three forms:

| Value | Meaning |
|---|---|
| `"latest"` | Newest archive inside your plan's retention window (case-insensitive) |
| `"YYYY-MM"` | That month |
| `"YYYY-MM-DD"` | The month containing that date |

Formats: `csv`, `json`, `geojson`, `kml`, `shp`. Both arguments are validated
before the request is sent, and the month is checked as a **calendar value**,
not just a shape — `2026-13`, `2026-07-99` and `2026-02-29` all throw locally
(`2024-02-29` is fine), which saves a round trip and a credit.

Two failure modes are worth telling apart:

- **400 (`ValidationError`)** — the month is malformed or impossible. The SDK
  normally catches this first.
- **404 (`NotFoundError`)** — the month is real, but no archive is available to
  you. Months outside your retention window and months that have not started
  both return 404 and are deliberately indistinguishable, so the response never
  reveals an archive you cannot access.

Retention: **Team** plans see a trailing 12 months of archives; **Enterprise**
and full-history add-ons see everything.

## Coordinates with attributes

`coordinates()` returns raw rows — geometry plus the attribute bag — instead of
GeoJSON features. The API sends the rows as a bare array and reports the paging
facts in response headers, which the SDK folds into the returned page:

```ts
const page = await ds.coordinates({ limit: 1000, offset: 0 });
page.total;    // X-Total-Count: rows in the whole dataset, regardless of paging
page.returned; // X-Returned-Count
page.offset;   // X-Offset
page.rows[0].latitude; // "51.49638600" — a decimal string, never coerced to a number
```

`latitude` and `longitude` arrive as strings and are kept as strings; parsing
them would silently drop precision the API preserves. `limit` maxes out at
50000, and omitting both parameters returns the whole dataset in one response
(capped at the same 50000 rows). Advanced-tier attributes (email, phone,
website, hours, services) appear only if your organization is entitled to
high-value data for that dataset.

## SQL across the datasets you licence (Enterprise)

`tl.sql()` sits on the client, not on a dataset handle, because one query may
join several. It needs the `sql-access` entitlement, which is part of the
Enterprise plan and is not sold separately.

```ts
const res = await tl.sql("SELECT city, count(*) AS n FROM autocrew GROUP BY 1", { maxRows: 100 });
res.columns;   // ["city", "n"]
res.rows;      // [{ city: "Amsterdam", n: 412 }, …]
res.truncated; // true when the result was cut off at the row cap
res.datasets;  // licensed tables the query actually read, per the query plan
```

One read-only `SELECT` (or `WITH`) — no DDL/DML, no system catalogues — and
every relation the planner resolves must be a dataset you hold an active licence
for. A query that outruns the server statement timeout throws
`QueryTimeoutError` (408).

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

## Stream one archive to disk (Node only)

```ts
import { Client } from "@topolab/sdk";
import { downloadArchive } from "@topolab/sdk/node";

const tl = new Client();
const ctrl = new AbortController();
await downloadArchive(tl.dataset("nl-domino-poi"), "archives/2026-07.zip", {
  month: "2026-07",
  format: "geojson",
  signal: ctrl.signal,
});
```

Like `download`, it creates the destination directory if missing and accepts an
`AbortSignal`. The archive arrives as a zip (gzip when the stored object is
gzipped), so name the destination accordingly.
