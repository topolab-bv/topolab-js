import { describe, it, expect } from "vitest";
import { readFileSync, rmSync, existsSync, readFileSync as read } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../src/client";
import { download, downloadArchive } from "../src/node";

// download() streams the response body to disk via Node's web-stream bridge.
// msw's mocked body does not interop with Readable.fromWeb, so we exercise the
// real streaming path against a genuine local HTTP server.
const here = dirname(fileURLToPath(import.meta.url));
const FULL = resolve(here, "../../topolab-sdk-spec/fixtures/nl-domino-poi/full.geojson");

function withServer(body: string, paths?: string[]): Promise<{ server: Server; url: string }> {
  return new Promise((res) => {
    const server = createServer((req, response) => {
      paths?.push(req.url ?? "");
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

  it("creates the destination directory if it is missing", async () => {
    const { server, url } = await withServer(read(FULL, "utf8"));
    const out = "./.tmp-download-dir/nested/out.geojson";
    try {
      const ds = new Client({ apiKey: "k", baseUrl: url }).dataset("nl-domino-poi");
      await download(ds, out, { format: "geojson" });
      expect(existsSync(out)).toBe(true);
    } finally {
      server.close();
      rmSync("./.tmp-download-dir", { recursive: true, force: true });
    }
  });
});

describe("downloadArchive (node)", () => {
  it("streams one monthly archive to disk and addresses the archive route", async () => {
    const paths: string[] = [];
    const { server, url } = await withServer(read(FULL, "utf8"), paths);
    const out = "./.tmp-archive.zip";
    try {
      const ds = new Client({ apiKey: "k", baseUrl: url }).dataset("nl-domino-poi");
      await downloadArchive(ds, out, { month: "2026-07", format: "geojson" });
      expect(paths[0]).toBe("/v1/dataset/nl-domino-poi/archives/2026-07/geojson");
      expect(existsSync(out)).toBe(true);
    } finally {
      server.close();
      rmSync(out, { force: true });
    }
  });

  it("defaults to the latest archive and lower-cases the keyword", async () => {
    const paths: string[] = [];
    const { server, url } = await withServer(read(FULL, "utf8"), paths);
    const out = "./.tmp-archive-latest/nested/out.zip";
    try {
      const ds = new Client({ apiKey: "k", baseUrl: url }).dataset("nl-domino-poi");
      await downloadArchive(ds, out);
      await downloadArchive(ds, out, { month: "LATEST", format: "shp" });
      expect(paths[0]).toBe("/v1/dataset/nl-domino-poi/archives/latest/geojson");
      expect(paths[1]).toBe("/v1/dataset/nl-domino-poi/archives/latest/shp");
      expect(existsSync(out)).toBe(true); // destination directory was created
    } finally {
      server.close();
      rmSync("./.tmp-archive-latest", { recursive: true, force: true });
    }
  });

  it("rejects an impossible month and an unknown format before requesting", async () => {
    const paths: string[] = [];
    const { server, url } = await withServer(read(FULL, "utf8"), paths);
    try {
      const ds = new Client({ apiKey: "k", baseUrl: url }).dataset("nl-domino-poi");
      await expect(downloadArchive(ds, "./.tmp-x.zip", { month: "2026-13" })).rejects.toThrow(/archive month/);
      await expect(downloadArchive(ds, "./.tmp-x.zip", { month: "2026-02-29" })).rejects.toThrow(/archive month/);
      await expect(downloadArchive(ds, "./.tmp-x.zip", { month: "latest", format: "xlsx" })).rejects.toThrow(
        /archive format/,
      );
      expect(paths).toEqual([]); // nothing left the client
    } finally {
      server.close();
      rmSync("./.tmp-x.zip", { force: true });
    }
  });
});
