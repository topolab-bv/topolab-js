# Errors

Every failure throws a subclass of `TopolabError`, so you never parse raw JSON.

| Error | When |
|---|---|
| `AuthenticationError` | missing or invalid API key (401) |
| `AddonRequiredError` | key lacks the add-on — `.addon` names it (403) |
| `AccessDeniedError` | dataset not accessible to your organization (403) |
| `InsufficientCreditsError` | not enough credits — `.required` / `.available` (402) |
| `NotFoundError` | unknown dataset or collection (404) |
| `ValidationError` | invalid request parameters (400/4xx) |
| `QueryTimeoutError` | a SQL query exceeded the server statement timeout (408) |
| `RateLimitError` | rate limited — `.retryAfter`, retried automatically (429) |
| `ConfigurationError` | client misconfiguration (missing key, invalid base URL) |
| `ServerError` | upstream error (5xx), retried automatically |
| `ConnectionError` | network failure after retries |
| `TimeoutError` | request exceeded the client timeout (subclass of `ConnectionError`) |

```ts
import { Client, AddonRequiredError } from "@topolab/sdk";

const tl = new Client({ apiKey: "tlb_prod_..." });
try {
  await tl.dataset("nl-domino-poi").toGeoJSON();
} catch (e) {
  if (e instanceof AddonRequiredError) console.log("Your key needs:", e.addon);
}
```

## The error envelope

Every failure shares one envelope, produced by the engine's global exception
filter:

```json
{ "code": 403, "message": "This endpoint requires the api-access add-on",
  "path": "/v1/dataset/{table}/files/geojson", "method": "GET",
  "time": "2026-09-08T23:42:15.819Z", "requestId": "25c2a6a1…" }
```

There is **no `statusCode` field** — the numeric status is `code`, and it always
equals the HTTP status. The SDK branches on the HTTP status, never on a body
field. `.requestId` is taken from the `X-Request-Id` header, falling back to the
envelope's `requestId`; quote it in support requests.

## Recognising an add-on requirement

Add-on identifiers are hyphenated slugs — `api-access`, `gis-access`,
`archived-data`, `high-value-data`, `sql-access`. Two message shapes carry a
requirement, and both normalise to the same slug on `.addon`:

| Message | `.addon` |
|---|---|
| `This endpoint requires the api-access add-on` | `api-access` |
| `Archive access requires the Archived Data add-on. Please upgrade…` | `archived-data` |

A 403 matching neither is an access denial (`AccessDeniedError`) — the dataset is
unknown to you, or your organization has no licence for it.

## Archives: 400 vs 404

A malformed or impossible month (`2026-13`, `2026-07-99`) is a **400**
(`ValidationError`); `downloadArchive` normally catches those client-side. A real
month with no archive available is a **404** (`NotFoundError`) — as are months
outside your retention window and months that have not started, which the API
deliberately does not distinguish, so a response never reveals an archive you
cannot access.

## Retries

Transient statuses (`429`, `500`, `502`, `503`, `504`) and network errors are
retried with exponential backoff, honouring `Retry-After` / `retryAfter` when
present. `maxRetries` (default 3) is the number of retries **after** the first
attempt.
