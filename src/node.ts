import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Dataset } from "./dataset";

const BULK = new Set(["csv", "json", "geojson", "kml", "shp"]);

/** Stream a dataset bulk export to a file path. Node-only. */
export async function download(ds: Dataset, path: string, opts: { format?: string } = {}): Promise<string> {
  const format = opts.format ?? "geojson";
  if (!BULK.has(format)) throw new Error(`download format must be one of ${[...BULK].join(", ")}`);
  const resp = await ds.t.request(`/v1/dataset/${ds.slug}/files/${format}`);
  if (!resp.body) throw new Error("empty response body");
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(path));
  return path;
}
