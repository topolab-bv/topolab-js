import { Transport } from "./transport";
import { Dataset } from "./dataset";
import { ConfigurationError } from "./errors";
import type { ClientOptions, DatasetPage, ListQuery } from "./types";

const DEFAULT_BASE_URL = "https://api.topolab.nl";

function clean(q: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v != null));
}

export class Client {
  readonly apiKey: string;
  readonly baseUrl: string;
  private t: Transport;
  readonly datasets: { list: (q?: ListQuery) => Promise<DatasetPage> };

  constructor(opts: ClientOptions = {}) {
    const key = opts.apiKey ?? (typeof process !== "undefined" ? process.env?.TOPOLAB_API_KEY : undefined);
    if (!key) throw new ConfigurationError("No API key. Pass apiKey or set TOPOLAB_API_KEY.");
    this.apiKey = key;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
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
