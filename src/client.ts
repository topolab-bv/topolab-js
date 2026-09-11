import { Transport } from "./transport";
import { Dataset } from "./dataset";
import { ConfigurationError } from "./errors";
import type {
  ClientOptions,
  DatasetPage,
  IterOwnedQuery,
  ListQuery,
  OwnedDataset,
  OwnedDatasets,
  OwnedQuery,
  SqlResult,
} from "./types";

const MAX_OWNED_LIMIT = 200;

// Named API environments. Production is the shipped default; staging is one
// keyword away. Self-hosting / tests can still pass an explicit baseUrl.
export const ENVIRONMENTS = {
  production: "https://api.topolab.nl",
  staging: "https://api-staging.topolab.nl",
} as const;
export type Environment = keyof typeof ENVIRONMENTS;
const DEFAULT_BASE_URL = ENVIRONMENTS.production;

function environmentUrl(name: string): string {
  const url = (ENVIRONMENTS as Record<string, string>)[name.toLowerCase()];
  if (!url) {
    throw new ConfigurationError(
      `Unknown environment "${name}". Use one of ${Object.keys(ENVIRONMENTS).join(", ")}.`,
    );
  }
  return url;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Reject base URLs that could exfiltrate the API key to an attacker-controlled
 *  host: require https (http only for loopback), and forbid embedded credentials. */
function validateBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigurationError(`baseUrl is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ConfigurationError(`baseUrl must use http(s); got ${raw}`);
  }
  if (parsed.username || parsed.password) {
    throw new ConfigurationError("baseUrl must not contain credentials (userinfo)");
  }
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new ConfigurationError(`baseUrl must use https for non-loopback host ${parsed.hostname}`);
  }
  return raw.replace(/\/$/, "");
}

/** Resolve the API base URL. Precedence (most specific first):
 *  explicit baseUrl > environment opt > TOPOLAB_BASE_URL > TOPOLAB_ENV > production.
 *  User-supplied URLs (baseUrl, TOPOLAB_BASE_URL) are validated; the named
 *  environments and the production default are trusted https constants. */
function resolveBaseUrl(
  opts: { baseUrl?: string; environment?: string },
  env: NodeJS.ProcessEnv | undefined,
): string {
  if (opts.baseUrl) return validateBaseUrl(opts.baseUrl);
  if (opts.environment) return environmentUrl(opts.environment);
  if (env?.TOPOLAB_BASE_URL) return validateBaseUrl(env.TOPOLAB_BASE_URL);
  if (env?.TOPOLAB_ENV) return environmentUrl(env.TOPOLAB_ENV);
  return DEFAULT_BASE_URL;
}

function clean(q: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v != null));
}

function boundedInt(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}; got ${value}`);
  return value;
}

/** Page `/v1/dataset/owned` by offset until the reported total is reached,
 *  yielding each dataset once. Advances by the number of rows actually returned
 *  so a short page leaves no gap, and stops on a short page, an empty page, or
 *  once the offset has caught up with `total`. */
async function* iterOwned(t: Transport, q: IterOwnedQuery): AsyncGenerator<OwnedDataset> {
  const pageSize = q.pageSize == null ? 50 : boundedInt("pageSize", q.pageSize, 1, MAX_OWNED_LIMIT);
  let yielded = 0;
  let offset = 0;
  const ctrl = new AbortController();
  try {
    while (true) {
      const page = await t.getJson<OwnedDatasets>(
        "/v1/dataset/owned",
        { limit: pageSize, offset },
        ctrl.signal,
      );
      const items = page?.items ?? [];
      if (items.length === 0) return;
      for (const item of items) {
        yield item;
        yielded++;
        if (q.totalLimit != null && yielded >= q.totalLimit) return;
      }
      offset += items.length;
      if (items.length < pageSize) return;
      if (typeof page.total === "number" && offset >= page.total) return;
    }
  } finally {
    ctrl.abort(); // cancel any in-flight request if the caller breaks early
  }
}

export class Client {
  readonly apiKey: string;
  readonly baseUrl: string;
  private t: Transport;
  readonly datasets: {
    list: (q?: ListQuery) => Promise<DatasetPage>;
    owned: (q?: OwnedQuery) => Promise<OwnedDatasets>;
    iterOwned: (q?: IterOwnedQuery) => AsyncGenerator<OwnedDataset>;
  };

  constructor(opts: ClientOptions = {}) {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const key = opts.apiKey ?? env?.TOPOLAB_API_KEY;
    if (!key) throw new ConfigurationError("No API key. Pass apiKey or set TOPOLAB_API_KEY.");
    this.apiKey = key;
    this.baseUrl = resolveBaseUrl(opts, env);
    this.t = new Transport({
      apiKey: key,
      baseUrl: this.baseUrl,
      timeout: opts.timeout ?? 60000,
      maxRetries: opts.maxRetries ?? 3,
      userAgent: opts.userAgent,
    });
    const t = this.t;
    this.datasets = {
      list: (q: ListQuery = {}) =>
        t.getJson<DatasetPage>(
          "/v1/dataset/all",
          clean({
            page: q.page,
            limit: q.limit,
            search: q.search,
            theme: q.theme,
            country: q.country,
            sortBy: q.sortBy,
            sortOrder: q.sortOrder,
          }),
        ),
      /** One page of the datasets this organization licences. `total` counts
       *  every licensed dataset, not the rows on this page. Requires an
       *  organization-scoped key and the `api-access` add-on. */
      // async so an out-of-range argument rejects rather than throwing
      // synchronously — every other data call is awaited the same way.
      owned: async (q: OwnedQuery = {}) => {
        if (q.limit != null) boundedInt("limit", q.limit, 1, MAX_OWNED_LIMIT);
        if (q.offset != null) boundedInt("offset", q.offset, 0, Number.MAX_SAFE_INTEGER);
        return t.getJson<OwnedDatasets>("/v1/dataset/owned", clean({ limit: q.limit, offset: q.offset }));
      },
      /** Stream every licensed dataset, paging transparently. Cancels the
       *  in-flight request if the caller `break`s early. */
      iterOwned: (q: IterOwnedQuery = {}) => iterOwned(t, q),
    };
  }

  dataset(slug: string): Dataset {
    return new Dataset(this.t, slug);
  }

  /** Run one read-only SQL query across the datasets this organization licences.
   *  Client-level rather than dataset-level because a query may join several.
   *
   *  Requires the `sql-access` entitlement, which is part of the Enterprise plan
   *  and is not sold separately; without it the call fails with
   *  `AddonRequiredError`. A single `SELECT` (or `WITH`) only — no DDL/DML, no
   *  system catalogues — and every relation the planner resolves must be a
   *  dataset the organization holds an active licence for. A query that outruns
   *  the server statement timeout fails with `QueryTimeoutError`. */
  sql(query: string, opts: { maxRows?: number } = {}): Promise<SqlResult> {
    const body: { sql: string; maxRows?: number } = { sql: query };
    if (opts.maxRows !== undefined) body.maxRows = opts.maxRows;
    return this.t.postJson<SqlResult>("/v1/sql/query", body);
  }
}
