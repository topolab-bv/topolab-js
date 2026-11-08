# Errors

Every failure throws a subclass of `TopolabError`, so you never parse raw JSON.

| Error | When |
|---|---|
| `AuthenticationError` | missing or invalid API key (401) |
| `AddonRequiredError` | key lacks the add-on — `.addon` names it (403) |
| `AccessDeniedError` | dataset not accessible to your organization, or the monthly spending limit is reached (`code === "SPENDING_LIMIT_EXCEEDED"`) (403) |
| `InsufficientCreditsError` | not enough credits — `.required` / `.available` (402) |
| `NotFoundError` | unknown dataset or collection (404) |
| `ValidationError` | invalid request parameters (400/4xx) |
| `QueryTimeoutError` | a SQL query exceeded the server statement timeout (408) |
| `RateLimitError` | rate limited (`code` `RATE_LIMIT_EXCEEDED`) or the key's usage quota is used up (`USAGE_QUOTA_EXCEEDED`) — `.retryAfter`, retried automatically (429) |
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

```json
{ "code": "SPENDING_LIMIT_EXCEEDED",
  "message": "Organization monthly spending limit exceeded",
  "details": { "limit": 5000, "consumed": 4995, "remaining": 5,
               "periodEnd": "2026-11-30T23:59:59.999Z" },
  "path": "/v1/dataset/{table}/files/geojson", "method": "GET",
  "time": "2026-11-07T11:52:28.000Z", "requestId": "8f0c41d2…" }
```

There is **no `statusCode` field** in the body. `code` is a **string** when the
error has its own code (upper-snake, such as `SPENDING_LIMIT_EXCEEDED`) and
otherwise the **numeric HTTP status**, so it does not always equal the status.
The SDK chooses the error class from the HTTP status, never from a body field,
and `code` refines the meaning inside a class: a 403 with
`SPENDING_LIMIT_EXCEEDED` is still an `AccessDeniedError`.

Every error built from a response carries:

| Property | Type | Meaning |
|---|---|---|
| `status` | `number` | HTTP status of the response. Use this for numeric checks. |
| `statusCode` | `number` | Alias of `status`, kept for code written against 0.1. Reading or assigning either one changes both. |
| `code` | `ErrorCode` (`string` or `number`) | The envelope's `code`; the HTTP status when the body has none (for example a proxy's error page). |
| `details` | `Record<string, unknown>` or `undefined` | The envelope's allow-listed `details`, when present. |
| `requestId` | `string` or `undefined` | The `X-Request-Id` header, falling back to the envelope's `requestId`; quote it in support requests. |
| `body` | `unknown` | The decoded response body. |

Errors thrown before a response exists (`ConnectionError`, `TimeoutError`, or a
`ConfigurationError` thrown by the client itself) leave `status`, `code` and
`details` undefined.

```ts
import { Client, AccessDeniedError } from "@topolab/sdk";
import { download } from "@topolab/sdk/node";

const tl = new Client();
try {
  await download(tl.dataset("nl-domino-poi"), "poi.geojson");
} catch (e) {
  if (e instanceof AccessDeniedError && e.code === "SPENDING_LIMIT_EXCEEDED") {
    console.log("Monthly limit reached; resets at", e.details?.periodEnd);
  } else {
    throw e;
  }
}
```

Compare string codes with `===`. If you used to read `body.code` as the HTTP
status, read `e.status` instead.

## Known string codes

Codes this SDK's calls can return:

| Status | `code` | Thrown as | Meaning | `details` |
|---|---|---|---|---|
| 403 | `SPENDING_LIMIT_EXCEEDED` | `AccessDeniedError` | A metered call (download, SQL) would pass the organization's monthly spending limit. | `limit`, `consumed`, `remaining` (numbers), `periodEnd` (ISO 8601 timestamp) |
| 400 | `SQL_DATA_ERROR` | `ValidationError` | The SQL query raised a data error while evaluating a value, such as a bad cast. The message names the SQLSTATE. | none |
| 400 | `MAX_NODES_EXCEEDED`, `MAX_DEPTH_EXCEEDED`, `MAX_ARRAY_LENGTH_EXCEEDED`, `MAX_KEYS_EXCEEDED` | `ValidationError` | A JSON request body is larger or deeper than the server accepts. | none |
| 400 | `PROTOTYPE_POLLUTION_KEY` | `ValidationError` | A JSON request body contains a forbidden key (`__proto__`, `constructor`, `prototype`). | none |
| 429 | `RATE_LIMIT_EXCEEDED` | `RateLimitError` | The API key passed its per-minute rate limit. The response also carries a `Retry-After` header. | `retryAfter` (seconds), `limit`, `remaining` (numbers), `resetAt` (ISO 8601 timestamp) |
| 429 | `USAGE_QUOTA_EXCEEDED` | `RateLimitError` | The API key has used up its usage quota. Waiting does not help; `.retryAfter` is `undefined`. | `quota`, `used` (numbers) |

Numeric codes that carry `details`:

| `code` | Thrown as | `details` |
|---|---|---|
| `402` | `InsufficientCreditsError` (also on `.required` / `.available`) | `required`, `available` |
| `413` | `ValidationError` | `quotaBytes`, `usageBytes`, `additionalBytes` (Data Studio uploads) |

Other parts of the API use further codes, listed in the
[SDK conventions](https://github.com/topolab-bv/topolab-sdk-spec/blob/main/conventions.md#known-string-codes):
`HIGH_VALUE_DATA_REQUIRED` (403, `details.columns` / `details.datasetIds`),
`REGENERATE_REQUIRED` (410) and `METADATA_NOT_READABLE` (400) from Data Studio,
`SSO_REQUIRED` (403) and `SSO_CHECK_UNAVAILABLE` (503) from sign-in, and the
order add-on and delivery-destination codes. The chat API reports a failed turn
on its event stream with upper-snake codes such as `AI_BUSY`, `AI_INTERRUPTED`
and `AI_CANCELLED`, the same codes Data Studio's HTTP errors send; this SDK does
not call it.

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
retried with exponential backoff. When the server says how long to wait, the SDK
waits that long instead, reading in order:

1. the `Retry-After` header (seconds, or an HTTP date);
2. `details.retryAfter` (seconds);
3. a top-level `retryAfter`, sent by engines older than the `RATE_LIMIT_EXCEEDED` code.

`RateLimitError.retryAfter` holds the same value, and `retryAfterSeconds(headers,
body)` is exported for your own retry logic. `maxRetries` (default 3) is the
number of retries **after** the first attempt.
