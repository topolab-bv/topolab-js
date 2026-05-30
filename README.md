# @topolab/sdk

Official TypeScript client for the [Topolab](https://topolab.nl) dataset and geospatial API. Works in Node 18+ and modern browsers / edge runtimes.

```bash
npm install @topolab/sdk
```

## Quickstart

```javascript
// Page Domino's locations within an Amsterdam bounding box
import { Client } from "@topolab/sdk";

const tl = new Client({ apiKey: "tlb_prod_..." });
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
console.log(`${fc.features.length} locations`);
```

The key carries your scope and addons — OGC feature access needs `GIS_ACCESS`,
downloads need `API_ACCESS`, and data routes require an organization-scoped key.
Pass `apiKey` or set `TOPOLAB_API_KEY`.

## Browsing & paging

```javascript
const page = await tl.datasets.list({ country: "NL", limit: 10 });
for await (const feature of tl.dataset("nl-domino-poi").iterItems({ pageSize: 500 })) {
  // streams every feature, paging transparently
}
```

## Streaming a dataset to disk (Node only)

```javascript
import { Client } from "@topolab/sdk";
import { download } from "@topolab/sdk/node";

const tl = new Client();
await download(tl.dataset("nl-domino-poi"), "dominos-nl.geojson", { format: "geojson" });
```

`download` lives in the `/node` subpath because it writes to the filesystem; the
core entry point stays browser-safe.

## Errors

All failures throw a subclass of `TopolabError` (`AuthenticationError`,
`AddonRequiredError`, `AccessDeniedError`, `InsufficientCreditsError`,
`RateLimitError`, …). `AddonRequiredError.addon` names the missing addon.

MIT licensed.
