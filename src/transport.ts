import { errorFromResponse, ConnectionError, TimeoutError } from "./errors";

const VERSION = "0.1.0";
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
      try {
        const b = await resp.clone().json();
        if (b?.retryAfter != null) return Number(b.retryAfter) * 1000;
      } catch {
        /* ignore */
      }
      const hdr = resp.headers.get("retry-after");
      if (hdr) return Number(hdr) * 1000;
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
            : new ConnectionError((e as Error).message);
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
      if (resp.status >= 400) throw await errorFromResponse(resp);
      return resp;
    }
    throw await errorFromResponse(last as Response);
  }
}
