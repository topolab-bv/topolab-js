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
  it("defaults to the production environment", () => {
    delete process.env.TOPOLAB_BASE_URL;
    delete process.env.TOPOLAB_ENV;
    expect(new Client({ apiKey: "k" }).baseUrl).toBe("https://api.topolab.nl");
  });
  it("selects staging via the environment option", () => {
    delete process.env.TOPOLAB_BASE_URL;
    delete process.env.TOPOLAB_ENV;
    expect(new Client({ apiKey: "k", environment: "staging" }).baseUrl).toBe(
      "https://api-staging.topolab.nl",
    );
  });
  it("throws on an unknown environment", () => {
    expect(() => new Client({ apiKey: "k", environment: "dev" as never })).toThrow(ConfigurationError);
  });
  it("reads TOPOLAB_ENV from the environment", () => {
    delete process.env.TOPOLAB_BASE_URL;
    process.env.TOPOLAB_ENV = "staging";
    expect(new Client({ apiKey: "k" }).baseUrl).toBe("https://api-staging.topolab.nl");
    delete process.env.TOPOLAB_ENV;
  });
  it("explicit baseUrl beats environment", () => {
    delete process.env.TOPOLAB_BASE_URL;
    delete process.env.TOPOLAB_ENV;
    const c = new Client({ apiKey: "k", baseUrl: "https://self.example/api", environment: "staging" });
    expect(c.baseUrl).toBe("https://self.example/api");
  });
  it("rejects plain-http remote baseUrl", () => {
    expect(() => new Client({ apiKey: "k", baseUrl: "http://evil.example/api" })).toThrow(ConfigurationError);
  });
  it("rejects baseUrl with embedded credentials", () => {
    expect(() => new Client({ apiKey: "k", baseUrl: "https://user:pass@evil.example" })).toThrow(ConfigurationError);
  });
  it("rejects a non-http(s) scheme", () => {
    expect(() => new Client({ apiKey: "k", baseUrl: "ftp://api.topolab.nl" })).toThrow(ConfigurationError);
  });
  it("allows plain-http loopback (for local dev/tests)", () => {
    expect(new Client({ apiKey: "k", baseUrl: "http://127.0.0.1:8080" }).baseUrl).toBe("http://127.0.0.1:8080");
  });
  it("validates TOPOLAB_BASE_URL from env", () => {
    process.env.TOPOLAB_BASE_URL = "http://evil.example";
    expect(() => new Client({ apiKey: "k" })).toThrow(ConfigurationError);
    delete process.env.TOPOLAB_BASE_URL;
  });
});
