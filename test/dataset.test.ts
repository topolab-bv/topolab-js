import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "../src/client";
import { AddonRequiredError } from "../src/errors";
import { fx, BASE, COLL } from "./setup";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("dataset", () => {
  it("metadata", async () => {
    server.use(http.get(`${BASE}/v1/dataset/nl-domino-poi`, () => HttpResponse.json(fx("metadata.json"))));
    const md = await new Client({ apiKey: "k", baseUrl: BASE }).dataset("nl-domino-poi").metadata();
    expect(md.id).toBe("3f9a2c7e-8b1d-4056-a1c2-e3f4a5b6c7d8");
  });

  it("items resolves slug->uuid once and serializes bbox", async () => {
    let mdCalls = 0;
    const bboxSeen: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/v1/dataset/nl-domino-poi`, () => {
        mdCalls++;
        return HttpResponse.json(fx("metadata.json"));
      }),
      http.get(`${BASE}/v1/ogc/collections/${COLL}/items`, ({ request }) => {
        bboxSeen.push(new URL(request.url).searchParams.get("bbox"));
        return HttpResponse.json(fx("items.json"));
      }),
    );
    const ds = new Client({ apiKey: "k", baseUrl: BASE }).dataset("nl-domino-poi");
    const fc = await ds.items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
    await ds.items({ limit: 10 });
    expect(fc.type).toBe("FeatureCollection");
    expect(mdCalls).toBe(1); // slug->uuid resolved once, then cached
    expect(bboxSeen[0]).toBe("4.7,52.2,5.1,52.5"); // first call serialized bbox
    expect(bboxSeen[1]).toBeNull(); // second call had no bbox
  });

  it("toGeoJSON addon error", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/nl-domino-poi/files/geojson`, () =>
        HttpResponse.json({ message: "This endpoint requires the API_ACCESS add-on" }, { status: 403 }),
      ),
    );
    await expect(
      new Client({ apiKey: "k", baseUrl: BASE }).dataset("nl-domino-poi").toGeoJSON(),
    ).rejects.toBeInstanceOf(AddonRequiredError);
  });

  it("iterItems paginates and stops on short page", async () => {
    server.use(http.get(`${BASE}/v1/dataset/nl-domino-poi`, () => HttpResponse.json(fx("metadata.json"))));
    let call = 0;
    server.use(
      http.get(`${BASE}/v1/ogc/collections/${COLL}/items`, () => {
        call++;
        return HttpResponse.json(call === 1 ? fx("items.json") : { type: "FeatureCollection", features: [] });
      }),
    );
    const out = [];
    for await (const f of new Client({ apiKey: "k", baseUrl: BASE }).dataset("nl-domino-poi").iterItems({ pageSize: 2 }))
      out.push(f);
    expect(out.length).toBe(2);
  });
});
