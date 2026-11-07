import { describe, it, expect } from "vitest";
import {
  errorFromResponse,
  retryAfterSeconds,
  InsufficientCreditsError,
  RateLimitError,
  TopolabError,
} from "../src/errors";
import { Transport } from "../src/transport";

function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("statusCode follows status", () => {
  it("tracks a status assigned after construction, in both directions", () => {
    const e = new TopolabError("x", { status: 404 });
    e.status = 410;
    expect(e.statusCode).toBe(410);
    e.statusCode = 418;
    expect(e.status).toBe(418);
  });

  it("stays an enumerable own property, so loggers and JSON still see it", () => {
    const e = new TopolabError("x", { status: 404 });
    expect(Object.keys(e)).toContain("statusCode");
    expect(JSON.parse(JSON.stringify(e))).toMatchObject({ status: 404, statusCode: 404 });
    e.status = 409;
    expect(JSON.parse(JSON.stringify(e)).statusCode).toBe(409);
  });

  it("still accepts the 0.1 statusCode option", () => {
    const e = new TopolabError("x", { statusCode: 403 });
    expect(e.status).toBe(403);
    expect(e.statusCode).toBe(403);
  });
});

describe("402 credit amounts must be numbers", () => {
  it("keeps finite numbers", async () => {
    const e = (await errorFromResponse(
      resp(402, { code: 402, message: "Insufficient credits", details: { required: 10, available: 0 } }),
    )) as InsufficientCreditsError;
    expect(e.required).toBe(10);
    expect(e.available).toBe(0);
  });

  it.each([
    [{ required: "10", available: "0" }],
    [{ required: null, available: true }],
    [{ required: { n: 1 }, available: [0] }],
  ])("drops values that are not numbers (%j)", async (details) => {
    const e = (await errorFromResponse(
      resp(402, { code: 402, message: "Insufficient credits", details }),
    )) as InsufficientCreditsError;
    expect(e).toBeInstanceOf(InsufficientCreditsError);
    expect(e.required).toBeUndefined();
    expect(e.available).toBeUndefined();
  });
});

describe("429s since engine #650", () => {
  const rateLimited = {
    code: "RATE_LIMIT_EXCEEDED",
    message: "Rate limit exceeded",
    details: { retryAfter: 42, limit: 300, remaining: 0, resetAt: "2026-11-07T12:01:00.000Z" },
  };
  const quota = {
    code: "USAGE_QUOTA_EXCEEDED",
    message: "API key usage quota exceeded",
    details: { quota: 10, used: 10 },
  };

  it("takes the wait from details.retryAfter", async () => {
    const e = (await errorFromResponse(resp(429, rateLimited))) as RateLimitError;
    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(e.retryAfter).toBe(42);
    expect(e.details?.limit).toBe(300);
  });

  it("prefers the Retry-After header", async () => {
    const e = (await errorFromResponse(resp(429, rateLimited, { "retry-after": "43" }))) as RateLimitError;
    expect(e.retryAfter).toBe(43);
  });

  it("reads an HTTP-date Retry-After header", async () => {
    const when = new Date(Date.now() + 120_000).toUTCString();
    const e = (await errorFromResponse(resp(429, { code: 429, message: "x" }, { "retry-after": when }))) as RateLimitError;
    expect(e.retryAfter).toBeGreaterThanOrEqual(100);
    expect(e.retryAfter).toBeLessThanOrEqual(121);
  });

  it("ignores an unparseable Retry-After header", async () => {
    const e = (await errorFromResponse(resp(429, rateLimited, { "retry-after": "soon" }))) as RateLimitError;
    expect(e.retryAfter).toBe(42);
  });

  it("still reads the older top-level retryAfter", async () => {
    const e = (await errorFromResponse(resp(429, { message: "rl", retryAfter: 2 }))) as RateLimitError;
    expect(e.retryAfter).toBe(2);
  });

  it("has no wait for a used-up quota, but keeps its details", async () => {
    const e = (await errorFromResponse(resp(429, quota))) as RateLimitError;
    expect(e.code).toBe("USAGE_QUOTA_EXCEEDED");
    expect(e.retryAfter).toBeUndefined();
    expect(e.details).toEqual({ quota: 10, used: 10 });
  });

  it("orders the sources header, details, legacy body", () => {
    const h = (v?: string) => new Headers(v ? { "retry-after": v } : {});
    expect(retryAfterSeconds(h("9"), { details: { retryAfter: 7 }, retryAfter: 5 })).toBe(9);
    expect(retryAfterSeconds(h(), { details: { retryAfter: 7 }, retryAfter: 5 })).toBe(7);
    expect(retryAfterSeconds(h(), { retryAfter: 5 })).toBe(5);
    expect(retryAfterSeconds(h(), { details: { retryAfter: -1 } })).toBeUndefined();
    expect(retryAfterSeconds(h(), {})).toBeUndefined();
  });

  it("the retry delay uses the same rule, in milliseconds", async () => {
    const t = new Transport({ apiKey: "k", baseUrl: "https://api.topolab.nl", timeout: 1000, maxRetries: 1, backoffBase: 0 });
    const delay = (r: Response) => (t as any).delay(0, r) as Promise<number>;
    expect(await delay(resp(429, rateLimited, { "retry-after": "9" }))).toBe(9000);
    expect(await delay(resp(429, rateLimited))).toBe(42000);
    expect(await delay(resp(429, { message: "x", retryAfter: 5 }))).toBe(5000);
    expect(await delay(resp(429, quota))).toBe(0);
    expect(await delay(resp(429, { code: 429, message: "x" }, { "retry-after": "not a date" }))).toBe(0);
  });
});
