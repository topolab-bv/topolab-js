/**
 * The error envelope's `code`: a string such as `"SPENDING_LIMIT_EXCEEDED"` when
 * the engine throws a named code, otherwise the numeric HTTP status.
 */
export type ErrorCode = string | number;

export interface TopolabErrorOptions {
  /** HTTP status of the response. */
  status?: number;
  /** Alias of `status`, accepted for code written against 0.1. */
  statusCode?: number;
  code?: ErrorCode;
  details?: Record<string, unknown>;
  requestId?: string;
  body?: unknown;
}

export class TopolabError extends Error {
  /** HTTP status of the response; `undefined` when no response exists. */
  status?: number;
  /** Alias of `status`, kept for code written against 0.1. It is an enumerable
   *  own accessor, so loggers and `JSON.stringify` still see it, and it always
   *  reads and writes `status`. */
  declare statusCode?: number;
  /** The envelope's `code`: a string code, or the numeric HTTP status. Compare
   *  string codes by equality and read `status` for the HTTP status. */
  code?: ErrorCode;
  /** The envelope's allow-listed `details`, when present. */
  details?: Record<string, unknown>;
  requestId?: string;
  body?: unknown;
  constructor(message: string, opts: TopolabErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? opts.statusCode;
    Object.defineProperty(this, "statusCode", {
      get: () => this.status,
      set: (value: number | undefined) => {
        this.status = value;
      },
      enumerable: true,
      configurable: true,
    });
    this.code = opts.code;
    this.details = opts.details;
    this.requestId = opts.requestId;
    this.body = opts.body;
  }
}
export class ConnectionError extends TopolabError {}
/** Request exceeded the client timeout. Subclass of ConnectionError so existing
 *  `instanceof ConnectionError` handling keeps working while callers can also
 *  catch timeouts specifically. */
export class TimeoutError extends ConnectionError {}
export class AuthenticationError extends TopolabError {}
export class ConfigurationError extends TopolabError {}
export class NotFoundError extends TopolabError {}
export class ValidationError extends TopolabError {}
export class ServerError extends TopolabError {}
export class AccessDeniedError extends TopolabError {}
/** A SQL query exceeded the server's statement timeout (408). Narrow the scan
 *  (filter, LIMIT) or run it against fewer rows. */
export class QueryTimeoutError extends TopolabError {}

export class AddonRequiredError extends TopolabError {
  addon?: string;
  constructor(message: string, opts: any = {}) {
    super(message, opts);
    this.addon = opts.addon;
  }
}
export class InsufficientCreditsError extends TopolabError {
  required?: number;
  available?: number;
  constructor(message: string, opts: any = {}) {
    super(message, opts);
    this.required = opts.required;
    this.available = opts.available;
  }
}
export class RateLimitError extends TopolabError {
  retryAfter?: number;
  constructor(message: string, opts: any = {}) {
    super(message, opts);
    this.retryAfter = opts.retryAfter;
  }
}

// Add-on identifiers are hyphenated slugs (api-access, gis-access,
// archived-data, high-value-data, sql-access) and the two real message shapes
// spell them differently:
//   "This endpoint requires the api-access add-on"
//   "Archive access requires the Archived Data add-on. Please upgrade to ..."
// A \w+ capture stops at the hyphen and matches neither, so match lazily up to
// the "add-on"/"addon" literal and normalise the capture to the slug.
const ADDON_RE = /requires the (.+?) add-?on/i;

function addonSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

/** The envelope's `code` (a non-empty string or a finite number), else the HTTP
 *  status, so a proxy's error page still yields a usable code. */
function envelopeCode(body: any, status: number): ErrorCode {
  const code = body?.code;
  if (typeof code === "string" && code !== "") return code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  return status;
}

/** A finite number, or `undefined`. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A non-negative, finite number of seconds from a number or a numeric string. */
function seconds(value: unknown): number | undefined {
  let n: number | undefined;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "" && /^\s*[0-9.eE+-]+\s*$/.test(value)) n = Number(value);
  return n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** A `Retry-After` header as seconds: delay-seconds or an HTTP-date
 *  (RFC 9110, section 10.2.3). */
function headerSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const direct = seconds(value);
  if (direct !== undefined) return direct;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, (when - Date.now()) / 1000);
}

/**
 * How long the server asked the client to wait, in seconds, or `undefined`.
 * The `Retry-After` header comes first (the engine sends it on every 429 that
 * carries a wait, rounded up), then `details.retryAfter` (engine #650 and
 * later), then a top-level `retryAfter` from older engines.
 */
export function retryAfterSeconds(headers: Headers, body: any): number | undefined {
  return (
    headerSeconds(headers.get("retry-after")) ?? seconds(body?.details?.retryAfter) ?? seconds(body?.retryAfter)
  );
}

function envelopeDetails(body: any): Record<string, unknown> | undefined {
  const details = body?.details;
  return details !== null && typeof details === "object" && !Array.isArray(details) ? details : undefined;
}

export async function errorFromResponse(resp: Response): Promise<TopolabError> {
  let body: any = {};
  try {
    body = await resp.clone().json();
  } catch {
    body = { message: await resp.clone().text().catch(() => "") };
  }
  const msg = body?.message || body?.error || "request failed";
  // The engine returns the id both as a header and as `requestId` in the error
  // envelope; fall back to the body when the header is stripped by a proxy.
  const requestId = resp.headers.get("x-request-id") ?? (typeof body?.requestId === "string" ? body.requestId : undefined);
  // The class is chosen from the HTTP status; `code` only refines it (a 403
  // with SPENDING_LIMIT_EXCEEDED is still an AccessDeniedError).
  const base: TopolabErrorOptions = {
    status: resp.status,
    code: envelopeCode(body, resp.status),
    details: envelopeDetails(body),
    requestId,
    body,
  };
  switch (resp.status) {
    case 401:
      return new AuthenticationError(msg, base);
    case 402:
      return new InsufficientCreditsError(msg, {
        ...base,
        required: finiteNumber(base.details?.required),
        available: finiteNumber(base.details?.available),
      });
    case 403: {
      const m = ADDON_RE.exec(msg);
      return m ? new AddonRequiredError(msg, { ...base, addon: addonSlug(m[1]) }) : new AccessDeniedError(msg, base);
    }
    case 404:
      return new NotFoundError(msg, base);
    case 408:
      return new QueryTimeoutError(msg, base);
    case 429:
      return new RateLimitError(msg, { ...base, retryAfter: retryAfterSeconds(resp.headers, body) });
    case 400:
      return /organization/i.test(msg) ? new ConfigurationError(msg, base) : new ValidationError(msg, base);
    default:
      if (resp.status >= 400 && resp.status < 500) return new ValidationError(msg, base);
      return new ServerError(msg, base);
  }
}
