import { Transport } from "./transport";
import { Dataset } from "./dataset";
import { ConfigurationError } from "./errors";
import type { ClientOptions, DatasetPage, ListQuery } from "./types";

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

export class Client {
  readonly apiKey: string;
  readonly baseUrl: string;
  private t: Transport;
  readonly datasets: { list: (q?: ListQuery) => Promise<DatasetPage> };

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
    };
  }

  dataset(slug: string): Dataset {
    return new Dataset(this.t, slug);
  }
}
