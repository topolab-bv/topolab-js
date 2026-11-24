// Downloads through the link route, with a per-call fallback to the old routes.
//
// POST /v1/dataset/{table}/exports answers 200 with a short-lived signed URL to
// a ready file, or 202 while the file is being prepared. The signed URL is
// fetched with a plain fetch that sends neither the API key nor Accept.
//
// A server without the link route answers it with 404 (or 405). The call then
// goes to the old route (GET .../files/{format} or
// GET .../archives/{month}/{format}) with today's behaviour and retries.
// Nothing is remembered between calls, so a script keeps working while servers
// gain or lose the route. Every other error (402, 403, 5xx, ...) is raised.
import { ConnectionError, ServerError, TopolabError, retryAfterSeconds } from "./errors";
import type { Transport } from "./transport";

/** Answers from the link route that mean "this server has no link route". */
const FALLBACK_STATUS = new Set([404, 405]);
/** Wait between polls when the server names no wait. */
const DEFAULT_POLL_SECONDS = 5;
/** Shortest wait between polls, whatever the server says. */
const MIN_POLL_SECONDS = 1;
/** How long one call waits for a file that is being prepared. The build keeps
 *  going on the server, so a later call finds the file ready. */
const MAX_WAIT_MS = 30 * 60 * 1000;

/** Time, behind an object the tests replace. Not part of the public API. */
export const clock = {
  now: (): number => Date.now(),
  sleep: (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done);
    }),
};

/** The JSON body sent to the link route. */
export interface LinkRequest {
  format: string;
  month?: string;
  bundle: "file" | "zip";
}

type Answer =
  | { state: "ready"; url: string }
  | { state: "preparing"; waitSeconds: number; build: unknown; status: number; body: unknown };

function seconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function unexpected(resp: Response, body: unknown): ServerError {
  return new ServerError(
    `The link route answered HTTP ${resp.status} without a ready link or a preparing state.`,
    { status: resp.status, code: resp.status, body },
  );
}

async function readAnswer(resp: Response): Promise<Answer> {
  let body: any;
  try {
    body = await resp.json();
  } catch {
    body = undefined;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw unexpected(resp, body);
  if (resp.status === 202 || body.state === "preparing") {
    const wait =
      seconds(body.retryAfterSeconds) ?? retryAfterSeconds(resp.headers, undefined) ?? DEFAULT_POLL_SECONDS;
    return {
      state: "preparing",
      waitSeconds: Math.max(wait, MIN_POLL_SECONDS),
      build: body.build,
      status: resp.status,
      body,
    };
  }
  if (resp.status === 200 && body.state === "ready" && typeof body.url === "string" && body.url !== "") {
    return { state: "ready", url: body.url };
  }
  throw unexpected(resp, body);
}

function stillPreparing(answer: Extract<Answer, { state: "preparing" }>): ServerError {
  const minutes = Math.round(MAX_WAIT_MS / 60000);
  return new ServerError(
    `The file is still being prepared, and the next wait would pass this call's ${minutes}-minute limit. ` +
      "It keeps building on the server; call again later.",
    {
      status: answer.status,
      code: "FILE_PREPARING",
      details: { build: answer.build, retryAfter: answer.waitSeconds },
      body: answer.body,
    },
  );
}

function aborted(): ConnectionError {
  return new ConnectionError("request aborted by caller");
}

/**
 * The response carrying the file the link route names (fetched from its signed
 * URL without the API key), or the old route's response on a server without the
 * link route. The caller streams the body to disk.
 */
export async function fetchViaLink(
  t: Transport,
  slug: string,
  body: LinkRequest,
  fallbackRoute: string,
  signal?: AbortSignal,
): Promise<Response> {
  const started = clock.now();
  for (;;) {
    let resp: Response;
    try {
      resp = await t.request(`/v1/dataset/${slug}/exports`, undefined, signal, { method: "POST", json: body });
    } catch (e) {
      if (e instanceof TopolabError && e.status !== undefined && FALLBACK_STATUS.has(e.status)) {
        return t.request(fallbackRoute, undefined, signal);
      }
      throw e;
    }
    const answer = await readAnswer(resp);
    if (answer.state === "ready") return t.fetchSigned(answer.url, signal);
    if (clock.now() - started + answer.waitSeconds * 1000 > MAX_WAIT_MS) throw stillPreparing(answer);
    await clock.sleep(answer.waitSeconds * 1000, signal);
    if (signal?.aborted) throw aborted();
  }
}
