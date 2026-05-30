import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "../src/client";
import { fx, BASE, COLL } from "./setup";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Mirrors topolab-sdk-spec/examples/example.js against mocks.
describe("advertised example", () => {
  it("pages items within a bbox", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/nl-domino-poi`, () => HttpResponse.json(fx("metadata.json"))),
      http.get(`${BASE}/v1/ogc/collections/${COLL}/items`, () => HttpResponse.json(fx("items.json"))),
    );
    const tl = new Client({ apiKey: "k", baseUrl: BASE });
    const f = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
    expect(f.features.length).toBeGreaterThan(0);
  });
});
