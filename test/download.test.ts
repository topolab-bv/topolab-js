import { describe, it, expect } from "vitest";
import { readFileSync, rmSync, readFileSync as read } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../src/client";
import { download } from "../src/node";

// download() streams the response body to disk via Node's web-stream bridge.
// msw's mocked body does not interop with Readable.fromWeb, so we exercise the
// real streaming path against a genuine local HTTP server.
const here = dirname(fileURLToPath(import.meta.url));
const FULL = resolve(here, "../../topolab-sdk-spec/fixtures/nl-domino-poi/full.geojson");

function withServer(body: string): Promise<{ server: Server; url: string }> {
  return new Promise((res) => {
    const server = createServer((_req, response) => {
      response.setHeader("content-type", "application/geo+json");
      response.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      res({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("download (node)", () => {
  it("streams a dataset to disk", async () => {
    const { server, url } = await withServer(read(FULL, "utf8"));
    try {
      const ds = new Client({ apiKey: "k", baseUrl: url }).dataset("nl-domino-poi");
      const out = "./.tmp-out.geojson";
      await download(ds, out, { format: "geojson" });
      const parsed = JSON.parse(readFileSync(out, "utf8"));
      expect(parsed.features.length).toBe(2);
      rmSync(out);
    } finally {
      server.close();
    }
  });
});
