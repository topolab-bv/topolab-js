import { describe, it, expect } from "vitest";
import {
  errorFromResponse,
  AddonRequiredError,
  AccessDeniedError,
  InsufficientCreditsError,
  RateLimitError,
  AuthenticationError,
  QueryTimeoutError,
  ServerError,
  TopolabError,
  ValidationError,
  ConfigurationError,
  type ErrorCode,
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

  // Since engine #641, `code` is a string when the error has its own code and
  // otherwise the numeric HTTP status. Bodies are inlined so these tests do not
  // depend on fixtures that land in topolab-sdk-spec separately.
  describe("code is a string or a number", () => {
    const spendingLimit = {
      path: "/v1/dataset/nl-domino-poi/files/geojson",
      method: "GET",
      code: "SPENDING_LIMIT_EXCEEDED",
      message: "Organization monthly spending limit exceeded",
      details: { limit: 5000, consumed: 4995, remaining: 5, periodEnd: "2026-11-30T23:59:59.999Z" },
      time: "2026-11-07T11:52:28.000Z",
      requestId: "8f0c41d2",
    };
    const credits = {
      path: "/v1/dataset/nl-domino-poi/files/geojson",
      method: "GET",
      code: 402,
      message: "Insufficient credits",
      details: { required: 10, available: 0 },
      time: "2026-11-07T11:52:28.000Z",
      requestId: "6a1b3c5d",
    };

    it("keeps a string code and takes status from the response", async () => {
      const e = await errorFromResponse(resp(403, spendingLimit));
      // The class still follows the HTTP status; the code refines it.
      expect(e).toBeInstanceOf(AccessDeniedError);
      expect(e.code).toBe("SPENDING_LIMIT_EXCEEDED");
      expect(typeof e.code).toBe("string");
      expect(e.status).toBe(403);
      expect(e.statusCode).toBe(403);
      expect(e.details).toEqual(spendingLimit.details);
      expect(e.requestId).toBe("8f0c41d2");
    });

    it("keeps a numeric code and exposes details", async () => {
      const e = await errorFromResponse(resp(402, credits));
      expect(e).toBeInstanceOf(InsufficientCreditsError);
      expect(e.code).toBe(402);
      expect(typeof e.code).toBe("number");
      expect(e.status).toBe(402);
      expect(e.statusCode).toBe(402);
      expect(e.details).toEqual({ required: 10, available: 0 });
      expect((e as InsufficientCreditsError).required).toBe(10);
      expect((e as InsufficientCreditsError).available).toBe(0);
    });

    it("keeps a string code without details", async () => {
      const e = await errorFromResponse(
        resp(400, {
          code: "SQL_DATA_ERROR",
          message: "The query raised a data error (SQLSTATE 22P02) while evaluating a value.",
        }),
      );
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.code).toBe("SQL_DATA_ERROR");
      expect(e.status).toBe(400);
      expect(e.details).toBeUndefined();
    });

    it.each([
      [{ message: "no code at all" }],
      [{ code: null, message: "x" }],
      [{ code: "", message: "x" }],
      [{ code: true, message: "x" }],
      [{ code: { nested: 1 }, message: "x" }],
    ])("falls back to the HTTP status when the body has no usable code (%j)", async (body) => {
      const e = await errorFromResponse(resp(502, body));
      expect(e).toBeInstanceOf(ServerError);
      expect(e.code).toBe(502);
      expect(e.details).toBeUndefined();
    });

    it("falls back to the HTTP status for a non-JSON body", async () => {
      const e = await errorFromResponse(new Response("<html>Bad Gateway</html>", { status: 502 }));
      expect(e.code).toBe(502);
      expect(e.status).toBe(502);
    });

    it("ignores details that are not an object", async () => {
      const e = await errorFromResponse(resp(403, { code: 403, message: "x", details: ["a"] }));
      expect(e.details).toBeUndefined();
    });

    it("accepts the 0.1 statusCode option and keeps both fields equal", () => {
      const e = new TopolabError("x", { statusCode: 418 });
      expect(e.status).toBe(418);
      expect(e.statusCode).toBe(418);
      expect(JSON.parse(JSON.stringify(e))).toMatchObject({ status: 418, statusCode: 418 });
    });

    it("types code as string | number", () => {
      const codes: ErrorCode[] = ["SPENDING_LIMIT_EXCEEDED", 402];
      expect(codes).toHaveLength(2);
    });

    it("leaves status, code and details unset on client-side errors", () => {
      const e = new ConfigurationError("No API key");
      expect(e.status).toBeUndefined();
      expect(e.code).toBeUndefined();
      expect(e.details).toBeUndefined();
    });
  });
});
