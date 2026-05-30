import { describe, it, expect } from "vitest";
import {
  errorFromResponse,
  AddonRequiredError,
  AccessDeniedError,
  InsufficientCreditsError,
  RateLimitError,
  AuthenticationError,
} from "../src/errors";

function resp(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("errorFromResponse", () => {
  it("maps 403 addon", async () => {
    const e = await errorFromResponse(resp(403, { message: "This endpoint requires the API_ACCESS add-on" }));
    expect(e).toBeInstanceOf(AddonRequiredError);
    expect((e as AddonRequiredError).addon).toBe("API_ACCESS");
  });
  it("maps 403 access", async () => {
    expect(await errorFromResponse(resp(403, { message: "Organization does not have access" }))).toBeInstanceOf(
      AccessDeniedError,
    );
  });
  it("maps 402 credits", async () => {
    const e = await errorFromResponse(resp(402, { message: "Insufficient credits", details: { required: 10, available: 0 } }));
    expect((e as InsufficientCreditsError).required).toBe(10);
  });
  it("maps 429 retryAfter", async () => {
    const e = await errorFromResponse(resp(429, { message: "rl", retryAfter: 2 }));
    expect((e as RateLimitError).retryAfter).toBe(2);
  });
  it("maps 401", async () => {
    expect(await errorFromResponse(resp(401, { message: "x" }))).toBeInstanceOf(AuthenticationError);
  });
});
