import { errorFromResponse, retryAfterSeconds, ConnectionError, TimeoutError, type TopolabError } from "./errors";

const VERSION = "0.2.1";
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  userAgent?: string;
  backoffBase?: number;
}

export class Transport {
  private headers: Record<string, string>;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private backoffBase: number;

  constructor(o: TransportOptions) {
    this.headers = {
      "X-API-Key": o.apiKey,
      "User-Agent": o.userAgent ?? `topolab-js/${VERSION} (+https://docs.topolab.nl)`,
      Accept: "application/json",
    };
    this.baseUrl = o.baseUrl.replace(/\/$/, "");
    this.timeout = o.timeout;
    this.maxRetries = o.maxRetries;
    this.backoffBase = o.backoffBase ?? 500;
  }

  private async delay(attempt: number, resp?: Response): Promise<number> {
    if (resp) {
      let body: unknown;
      try {
        body = await resp.clone().json();
      } catch {
        body = undefined;
      }
      const wait = retryAfterSeconds(resp.headers, body);
      if (wait !== undefined) return wait * 1000;
    }
    return this.backoffBase * 2 ** attempt;
  }

  async getJson<T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const resp = await this.request(path, params, signal);
    return (await resp.json()) as T;
  }

  /** POST a JSON body and decode a JSON response. Retries follow the same rules
   *  as GET; the routes that use this are read-only, so replay is safe. */
  async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const resp = await this.request(path, undefined, signal, { method: "POST", json: body });
    return (await resp.json()) as T;
  }

  async request(
    path: string,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
    init: { method?: string; json?: unknown } = {},
  ): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    const method = init.method ?? "GET";
    const payload = init.json === undefined ? undefined : JSON.stringify(init.json);
    const headers =
      payload === undefined ? this.headers : { ...this.headers, "Content-Type": "application/json" };
    return this.send(url, { method, headers, body: payload }, signal, errorFromResponse);
  }

  /** GET a signed link. A signed link carries its own authorisation, so this is
   *  a plain fetch: no API key, no Accept, no header of ours. Retries, timeout
   *  and cancellation follow the same rules as every other request. */
  async fetchSigned(url: string, signal?: AbortSignal): Promise<Response> {
    const target = new URL(url, this.baseUrl + "/");
    const queries = [...new Set([target.search.slice(1), url.split("?").slice(1).join("?").split("#")[0]])]
      .filter((q) => q.length > 0)
      .sort((a, b) => b.length - a.length);
    return this.send(target, { method: "GET" }, signal, signedLinkError, (text) => withoutQuery(text, queries));
  }

  /** `describe` writes the message of an error raised before any answer from
   *  the error's own message. */
  private async send(
    url: URL,
    init: { method: string; headers?: Record<string, string>; body?: string },
    signal: AbortSignal | undefined,
    toError: (resp: Response) => Promise<TopolabError>,
    describe: (message: string) => string = (message) => message,
  ): Promise<Response> {
    const { method, headers, body: payload } = init;
    let last: Response | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, this.timeout);
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener("abort", onAbort);
      let resp: Response;
      try {
        resp = await fetch(url, { method, headers, body: payload, signal: ctrl.signal });
      } catch (e) {
        // Caller-initiated cancellation: surface immediately, never retry.
        if (signal?.aborted) throw new ConnectionError("request aborted by caller");
        // Timeout vs. network error. Both retry while attempts remain; on the
        // last attempt a timeout becomes a typed TimeoutError.
        if (attempt >= this.maxRetries) {
          throw timedOut
            ? new TimeoutError(`request timed out after ${this.timeout}ms`)
            : new ConnectionError(describe(String((e as Error)?.message)));
        }
        await sleep(await this.delay(attempt));
        continue;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }
      if (RETRY_STATUS.has(resp.status) && attempt < this.maxRetries) {
        last = resp;
        await sleep(await this.delay(attempt, resp));
        continue;
      }
      if (resp.status >= 400) throw await toError(resp);
      return resp;
    }
    throw await toError(last as Response);
  }
}

/** The error for a failed signed-link fetch. The class follows the status as
 *  everywhere else; the message never repeats the storage host's body, which
 *  can quote the link's signature. */
async function signedLinkError(resp: Response): Promise<TopolabError> {
  const err = await errorFromResponse(resp);
  err.message = `Fetching the file from its signed link failed with HTTP ${resp.status}. Call again for a new link.`;
  err.body = undefined;
  return err;
}

/** The query of any absolute URL quoted in a text: from the "?" up to the next
 *  space or quote, leaving punctuation that closes the sentence (a ")" after
 *  the URL) in place. */
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]*)\?[^\s"'<>]*?(?=[)\]}>,;.:!]*(?:[\s"'<>]|$))/gi;

/** `text` without any copy of a signed link's query, and without the query of
 *  any other URL it quotes (a redirect from the storage host can lead to a
 *  second signed link). The query is the link's signature, a working bearer
 *  link to the file for ten minutes, so it never goes into an error, which
 *  programs log; some runtimes' fetch quotes the URL in its error. */
function withoutQuery(text: string, queries: string[]): string {
  let out = text;
  for (const q of queries) out = out.split(`?${q}`).join("").split(q).join("[query removed]");
  return out.replace(URL_QUERY, "$1");
}
