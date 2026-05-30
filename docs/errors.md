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

## Retries

Transient statuses (`429`, `500`, `502`, `503`, `504`) and network errors are
retried with exponential backoff, honouring `Retry-After` / `retryAfter` when
present. `maxRetries` (default 3) is the number of retries **after** the first
attempt.
