import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ARCHIVE_FORMATS, archivePath } from "./dataset";
import type { Dataset } from "./dataset";

async function stream(resp: Response, path: string): Promise<string> {
  if (!resp.body) throw new Error("empty response body");
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(path));
  return path;
}

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
  if (!ARCHIVE_FORMATS.has(format))
    throw new Error(`download format must be one of ${[...ARCHIVE_FORMATS].join(", ")}`);
  await mkdir(dirname(path), { recursive: true });
  const resp = await ds.t.request(`/v1/dataset/${ds.slug}/files/${format}`, undefined, opts.signal);
  return stream(resp, path);
}

/**
 * Stream one monthly archive of a dataset to a file path. Node-only.
 *
 * `month` accepts three forms: `"latest"` (newest archive inside the plan's
 * retention window), `"YYYY-MM"` (that month) and `"YYYY-MM-DD"` (the month
 * containing that date). Both `month` and `format` are validated here — an
 * impossible month such as `2026-13`, `2026-07-99` or `2026-02-29` throws
 * before the request is sent, which is what the server would answer with a 400.
 *
 * A well-formed month with no archive available is a 404 (`NotFoundError`) —
 * as are months outside the retention window and months that have not started,
 * which the API deliberately does not distinguish.
 *
 * Creates the destination directory if it does not exist. Pass `opts.signal` to
 * cancel an in-flight download. The archive arrives as a zip (or gzip when the
 * stored object is gzipped), so name the destination accordingly.
 */
export async function downloadArchive(
  ds: Dataset,
  path: string,
  opts: { month?: string; format?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const route = archivePath(ds.slug, opts.month ?? "latest", opts.format ?? "geojson");
  await mkdir(dirname(path), { recursive: true });
  const resp = await ds.t.request(route, undefined, opts.signal);
  return stream(resp, path);
}
