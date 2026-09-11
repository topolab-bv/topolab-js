import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Client } from "../src/client";
import { Dataset } from "../src/dataset";
import * as sdk from "../src/index";
import * as node from "../src/node";

const here = dirname(fileURLToPath(import.meta.url));
const conv = parse(readFileSync(resolve(here, "../../topolab-sdk-spec/conventions.yaml"), "utf8"));

// Canonical (snake_case) method name -> where its TypeScript spelling lives.
// "n/a" marks an op this SDK deliberately does not implement (the TS client
// returns typed GeoJSON, so there is no geodataframe conversion).
const SURFACE: Record<string, string> = {
  dataset: "client.dataset",
  "datasets.list": "client.datasets.list",
  metadata: "dataset.metadata",
  sample: "dataset.sample",
  to_geojson: "dataset.toGeoJSON",
  download: "node.download",
  to_geodataframe: "n/a",
  items: "dataset.items",
  iter_items: "dataset.iterItems",
  "datasets.owned": "client.datasets.owned",
  iter_owned: "client.datasets.iterOwned",
  archives: "dataset.archives",
  // Writes a file, so it lives in the node subpath alongside download().
  archive: "node.downloadArchive",
  coordinates: "dataset.coordinates",
  sql: "client.sql",
};

function lookup(path: string, client: Client): unknown {
  const [root, ...rest] = path.split(".");
  const base: any = root === "node" ? node : root === "dataset" ? Dataset.prototype : client;
  return rest.reduce((acc: any, key) => acc?.[key], base);
}

describe("conventions", () => {
  const client = new Client({ apiKey: "k", baseUrl: "https://x" });

  it("maps every canonical method to a TypeScript spelling", () => {
    for (const m of conv.methods) expect(SURFACE[m.name], `no TS spelling mapped for ${m.name}`).toBeDefined();
  });

  it("exposes every canonical method", () => {
    for (const m of conv.methods) {
      const path = SURFACE[m.name];
      if (path === "n/a") continue;
      expect(typeof lookup(path, client), `${m.name} -> ${path}`).toBe("function");
    }
  });

  it("dataset exposes canonical methods (TS names)", () => {
    const ds = Object.getOwnPropertyNames(Dataset.prototype);
    for (const m of ["metadata", "sample", "toGeoJSON", "items", "iterItems", "archives", "coordinates"])
      expect(ds).toContain(m);
  });

  it("keeps filesystem writers out of the browser entry point", () => {
    for (const name of ["download", "downloadArchive"]) {
      expect((node as any)[name]).toBeTypeOf("function");
      expect((sdk as any)[name]).toBeUndefined();
    }
  });

  it("exports every error class", () => {
    for (const e of conv.errors) expect((sdk as any)[e.name]).toBeTypeOf("function");
  });

  it("client has dataset(), datasets.list(), datasets.owned() and sql()", () => {
    expect(typeof client.dataset).toBe("function");
    expect(typeof client.datasets.list).toBe("function");
    expect(typeof client.datasets.owned).toBe("function");
    expect(typeof client.datasets.iterOwned).toBe("function");
    expect(typeof client.sql).toBe("function");
  });
});
