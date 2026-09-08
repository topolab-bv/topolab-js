import { describe, it, expect } from "vitest";
import {
  errorFromResponse,
  AddonRequiredError,
  AccessDeniedError,
  InsufficientCreditsError,
  RateLimitError,
  AuthenticationError,
  QueryTimeoutError,
} from "../src/errors";

function resp(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("errorFromResponse", () => {
  it("maps 403 addon", async () => {
    const e = await errorFromResponse(resp(403, { message: "This endpoint requires the API_ACCESS add-on" }));
    expect(e).toBeInstanceOf(AddonRequiredError);
    expect((e as AddonRequiredError).addon).toBe("api_access");
  });

  // Add-on ids are hyphenated slugs, and the engine spells them two ways. A
  // \w+ capture stops at the hyphen, matches neither, and silently downgrades
  // every add-on 403 to an access denial.
  it("recognises the hyphenated-slug add-on message", async () => {
    const e = await errorFromResponse(
      resp(403, { code: 403, message: "This endpoint requires the api-access add-on" }),
    );
    expect(e).toBeInstanceOf(AddonRequiredError);
    expect((e as AddonRequiredError).addon).toBe("api-access");
  });

  it("recognises the prose add-on message and normalises it to a slug", async () => {
    const e = await errorFromResponse(
      resp(403, {
        code: 403,
        message: "Archive access requires the Archived Data add-on. Please upgrade to access historical data.",
      }),
    );
    expect(e).toBeInstanceOf(AddonRequiredError);
    expect((e as AddonRequiredError).addon).toBe("archived-data");
  });

  it("recognises every add-on slug the platform sells", async () => {
    for (const slug of ["api-access", "gis-access", "archived-data", "high-value-data", "sql-access"]) {
      const e = await errorFromResponse(resp(403, { message: `This endpoint requires the ${slug} add-on` }));
      expect((e as AddonRequiredError).addon).toBe(slug);
    }
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
  it("maps 408 to QueryTimeoutError", async () => {
    expect(await errorFromResponse(resp(408, { code: 408, message: "timeout" }))).toBeInstanceOf(
      QueryTimeoutError,
    );
  });
  // The envelope has no statusCode field, so mapping branches on the HTTP
  // status; the request id is a header, with the body envelope as fallback.
  it("branches on the HTTP status, not on a body field", async () => {
    const e = await errorFromResponse(resp(404, { code: 403, message: "Archive file not found" }));
    expect(e).not.toBeInstanceOf(AddonRequiredError);
    expect(e.statusCode).toBe(404);
  });
  it("takes the request id from the header, falling back to the body", async () => {
    const withHeader = new Response(JSON.stringify({ code: 404, message: "x", requestId: "body-id" }), {
      status: 404,
      headers: { "content-type": "application/json", "x-request-id": "header-id" },
    });
    expect((await errorFromResponse(withHeader)).requestId).toBe("header-id");
    expect((await errorFromResponse(resp(404, { code: 404, message: "x", requestId: "body-id" }))).requestId).toBe(
      "body-id",
    );
  });
});
