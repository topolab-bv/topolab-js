# Topolab TypeScript SDK

`@topolab/sdk` is a lightweight, GeoJSON-first client over the [Topolab](https://topolab.nl)
dataset and geospatial API. It uses the platform `fetch`, runs in Node and the
browser, and ships ES modules + CommonJS with TypeScript types.

!!! info "Full platform docs"
    This site is the technical reference for the npm package. The full platform
    documentation lives at [docs.topolab.nl](https://docs.topolab.nl).

## Install

```bash
npm install @topolab/sdk
```

> **Pre-release:** until the first version is published to npm, install from Git:
> `npm install github:topolab-bv/topolab-js`

Node 18+ or any modern browser / edge runtime — no polyfill.

## Quickstart

```ts
import { Client } from "@topolab/sdk";

// Page Domino's locations within an Amsterdam bounding box
const tl = new Client({ apiKey: "tlb_prod_..." });
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
console.log(`${fc.features.length} locations`);
```

Your API key carries your scope and add-ons — spatial queries need `GIS_ACCESS`,
downloads need `API_ACCESS`, and data routes require an organization-scoped key.
Prefer the environment over embedding keys in client bundles:

```ts
const tl = new Client({ apiKey: process.env.TOPOLAB_API_KEY });
```

## Staging vs production

The client targets **production** (`https://api.topolab.nl`) by default. Switch
with the `environment` option:

```ts
const tl = new Client({ apiKey: "tlb_staging_...", environment: "staging" }); // https://api-staging.topolab.nl
```

Or set `TOPOLAB_ENV=staging`. An explicit `baseUrl` always wins. Precedence:
`baseUrl` → `environment` → `TOPOLAB_BASE_URL` → `TOPOLAB_ENV` → production.
