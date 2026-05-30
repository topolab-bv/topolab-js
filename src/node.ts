import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Dataset } from "./dataset";

const BULK = new Set(["csv", "json", "geojson", "kml", "shp"]);

/**
 * Stream a dataset bulk export to a file path. Node-only.
 *
 * Creates the destination directory if it does not exist. Pass `opts.signal`
 * to cancel an in-flight download (e.g. on user abort or a wrapping timeout).
 */
export async function download(
  ds: Dataset,
  path: string,
  opts: { format?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const format = opts.format ?? "geojson";
  if (!BULK.has(format)) throw new Error(`download format must be one of ${[...BULK].join(", ")}`);
  await mkdir(dirname(path), { recursive: true });
  const resp = await ds.t.request(`/v1/dataset/${ds.slug}/files/${format}`, undefined, opts.signal);
  if (!resp.body) throw new Error("empty response body");
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(path));
  return path;
}
