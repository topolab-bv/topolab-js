import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync, rmSync } from "node:fs";
import { Client } from "../src/client";
import { download } from "../src/node";
import { fx, BASE } from "./setup";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("download (node)", () => {
  it("streams a dataset to disk", async () => {
    server.use(http.get(`${BASE}/v1/dataset/nl-domino-poi/files/geojson`, () => HttpResponse.json(fx("full.geojson"))));
    const ds = new Client({ apiKey: "k", baseUrl: BASE }).dataset("nl-domino-poi");
    const out = "./.tmp-out.geojson";
    await download(ds, out, { format: "geojson" });
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.features.length).toBe(2);
    rmSync(out);
  });
});
