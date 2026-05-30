import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Client } from "../src/client";
import { Dataset } from "../src/dataset";
import * as sdk from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const conv = parse(readFileSync(resolve(here, "../../topolab-sdk-spec/conventions.yaml"), "utf8"));

describe("conventions", () => {
  it("dataset exposes canonical methods (TS names)", () => {
    const ds = Object.getOwnPropertyNames(Dataset.prototype);
    for (const m of ["metadata", "sample", "toGeoJSON", "items", "iterItems"]) expect(ds).toContain(m);
  });
  it("exports every error class", () => {
    for (const e of conv.errors) expect((sdk as any)[e.name]).toBeTypeOf("function");
  });
  it("client has dataset() and datasets.list()", () => {
    const c = new Client({ apiKey: "k", baseUrl: "https://x" });
    expect(typeof c.dataset).toBe("function");
    expect(typeof c.datasets.list).toBe("function");
  });
});
