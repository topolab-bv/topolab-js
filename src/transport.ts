import { errorFromResponse, ConnectionError } from "./errors";

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

  async request(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    let last: Response | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      let resp: Response;
      try {
        resp = await fetch(url, { headers: this.headers, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        if (attempt >= this.maxRetries) throw new ConnectionError((e as Error).message);
        await sleep(await this.delay(attempt));
        continue;
      } finally {
        clearTimeout(timer);
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
