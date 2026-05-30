import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "../src/client";
import { ConfigurationError } from "../src/errors";
import { fx, BASE } from "./setup";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("client", () => {
  it("lists catalog", async () => {
    server.use(http.get(`${BASE}/v1/dataset/all`, () => HttpResponse.json(fx("catalog.json"))));
    const page = await new Client({ apiKey: "k", baseUrl: BASE }).datasets.list({ limit: 20 });
    expect(page.meta.totalItems).toBe(1);
    expect(page.data[0].table).toBe("nl-domino-poi");
  });
  it("reads key from env", () => {
    process.env.TOPOLAB_API_KEY = "envkey";
    expect(new Client({ baseUrl: BASE }).apiKey).toBe("envkey");
    delete process.env.TOPOLAB_API_KEY;
  });
  it("reads base url from TOPOLAB_BASE_URL env", () => {
    process.env.TOPOLAB_BASE_URL = "https://api-staging.topolab.nl";
    expect(new Client({ apiKey: "k" }).baseUrl).toBe("https://api-staging.topolab.nl");
    delete process.env.TOPOLAB_BASE_URL;
  });
  it("throws without key", () => {
    expect(() => new Client({ baseUrl: BASE })).toThrow(ConfigurationError);
  });
});
