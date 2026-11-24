import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ARCHIVE_FORMATS, archivePath, normalizeArchiveMonth } from "./dataset";
import type { Dataset } from "./dataset";
import { fetchViaLink } from "./links";

async function stream(resp: Response, path: string): Promise<string> {
  if (!resp.body) throw new Error("empty response body");
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(path));
  return path;
}

/**
 * Stream the current month's file of a dataset to a file path. Node-only.
 *
 * Asks the link route (`POST /v1/dataset/{table}/exports`) for a signed link to
 * the file and fetches it with a plain `fetch` that sends neither the API key
 * nor `Accept`. While the file is being prepared (202) it waits the
 * `retryAfterSeconds` the server names and asks again, for at most 30 minutes,
 * then throws a `ServerError` with `code === "FILE_PREPARING"`. A server
 * without the link route (404 or 405) gets today's `GET .../files/{format}`
 * instead, decided on every call. Other errors (402, 403, 5xx) are thrown.
 *
 * Creates the destination directory if it does not exist. Pass `opts.signal`
 * to cancel an in-flight download or a wait (e.g. on user abort or a wrapping
 * timeout).
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
  const resp = await fetchViaLink(
    ds.t,
    ds.slug,
    { format, bundle: "file" },
    `/v1/dataset/${ds.slug}/files/${format}`,
    opts.signal,
  );
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
 * The zip comes through the link route, like {@link download}: a signed link
 * fetched without the API key, waiting while the file is prepared, and today's
 * `GET .../archives/{month}/{format}` on a server without the link route.
 *
 * Creates the destination directory if it does not exist. Pass `opts.signal` to
 * cancel an in-flight download or a wait. The archive arrives as a zip, so name
 * the destination accordingly.
 */
export async function downloadArchive(
  ds: Dataset,
  path: string,
  opts: { month?: string; format?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const format = opts.format ?? "geojson";
  // Validates month and format before anything is sent.
  const route = archivePath(ds.slug, opts.month ?? "latest", format);
  const month = normalizeArchiveMonth(opts.month ?? "latest");
  await mkdir(dirname(path), { recursive: true });
  const resp = await fetchViaLink(ds.t, ds.slug, { format, month, bundle: "zip" }, route, opts.signal);
  return stream(resp, path);
}
