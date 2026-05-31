<p align="center">
  <img src="assets/banner.png" alt="Topolab TypeScript SDK" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@topolab/sdk"><img src="https://img.shields.io/npm/v/@topolab/sdk?color=1E3A8A&label=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@topolab/sdk"><img src="https://img.shields.io/npm/types/@topolab/sdk?color=1E3A8A" alt="TypeScript types"></a>
  <a href="https://github.com/topolab-bv/topolab-js/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/topolab-bv/topolab-js/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT"></a>
  <a href="https://docs.topolab.nl"><img src="https://img.shields.io/badge/docs-topolab.nl-1E3A8A" alt="Documentation"></a>
</p>

<h1 align="center">@topolab/sdk</h1>

<p align="center">
  The official <b>TypeScript</b> client for the <a href="https://topolab.nl">Topolab</a> dataset and geospatial API.<br>
  Lightweight, GeoJSON-first, runs in Node and the browser.
</p>

---

📖 **Docs:** [topolab-bv.github.io/topolab-js](https://topolab-bv.github.io/topolab-js/) · full platform docs at [docs.topolab.nl](https://docs.topolab.nl)

## Install

```bash
npm install @topolab/sdk
```

> **Pre-release:** until the first version is published to npm, install from Git:
> `npm install github:topolab-bv/topolab-js`

Ships ES modules + CommonJS and TypeScript types. Uses the platform `fetch`, so
Node 18+ or any modern browser / edge runtime works with no polyfill.

## Quickstart

```ts
// Page Domino's locations within an Amsterdam bounding box
import { Client } from "@topolab/sdk";

const tl = new Client({ apiKey: "tlb_prod_..." });
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
console.log(`${fc.features.length} locations`);
```

Your API key carries your scope and add-ons — spatial queries need `GIS_ACCESS`,
downloads need `API_ACCESS`, and data routes require an organization-scoped key.
Pass `apiKey` or set `TOPOLAB_API_KEY` (avoid embedding keys in client bundles):

```ts
const tl = new Client({ apiKey: process.env.TOPOLAB_API_KEY });
```

## Staging vs production

The client targets **production** (`https://api.topolab.nl`) by default. Point it
at staging with the `environment` option:

```ts
const tl = new Client({ apiKey: "tlb_staging_...", environment: "staging" }); // https://api-staging.topolab.nl
```

Or set `TOPOLAB_ENV=staging`. An explicit `baseUrl` always wins (self-hosting /
tests). Precedence: `baseUrl` → `environment` → `TOPOLAB_BASE_URL` →
`TOPOLAB_ENV` → production.

## What you can do

### Browse the catalog

```ts
const page = await tl.datasets.list({ country: "NL", limit: 10 });
```

### Query features in an area (spatial, paged)

```ts
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });

// or stream every feature, paging transparently:
for await (const feature of tl.dataset("nl-domino-poi").iterItems({ pageSize: 500 })) {
  // ...
}
```

The async iterator cancels the in-flight request if you `break` early.

### Pull a whole dataset (bulk)

```ts
const fc = await tl.dataset("nl-domino-poi").toGeoJSON();   // FeatureCollection
```

### Stream a dataset to disk (Node only)

```ts
import { Client } from "@topolab/sdk";
import { download } from "@topolab/sdk/node";

const tl = new Client();
await download(tl.dataset("nl-domino-poi"), "dominos-nl.geojson", { format: "geojson" });
```

`download` lives in the `@topolab/sdk/node` subpath because it writes to the
filesystem — the core entry point stays browser-safe.

## Errors

Every failure throws a subclass of `TopolabError`, so you never parse raw JSON:

| Error | When |
|---|---|
| `AuthenticationError` | missing or invalid API key (401) |
| `AddonRequiredError` | key lacks the add-on — `.addon` names it (403) |
| `AccessDeniedError` | dataset not accessible to your organization (403) |
| `InsufficientCreditsError` | not enough credits — `.required` / `.available` (402) |
| `NotFoundError` | unknown dataset (404) |
| `RateLimitError` | rate limited — `.retryAfter`, retried automatically (429) |

```ts
import { Client, AddonRequiredError } from "@topolab/sdk";

try {
  await tl.dataset("nl-domino-poi").toGeoJSON();
} catch (e) {
  if (e instanceof AddonRequiredError) console.log("Your key needs:", e.addon);
}
```

## Documentation

- **Full docs:** [docs.topolab.nl](https://docs.topolab.nl)
- The bulk vs. spatial access patterns, credits, and add-ons are described in the
  [SDK conventions](https://docs.topolab.nl) and the
  [`topolab-sdk-spec`](../topolab-sdk-spec) repository.
- A runnable example lives in [`examples/quickstart.ts`](examples/quickstart.ts).

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
Run `npm test`, type-check with `npm run typecheck`, build with `npm run build`.

## License

[MIT](LICENSE) © Topolab B.V.
