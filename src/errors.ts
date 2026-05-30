export class TopolabError extends Error {
  statusCode?: number;
  requestId?: string;
  body?: unknown;
  constructor(message: string, opts: { statusCode?: number; requestId?: string; body?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = opts.statusCode;
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

const ADDON_RE = /requires the (\w+) add-?on/i;

export async function errorFromResponse(resp: Response): Promise<TopolabError> {
  let body: any = {};
  try {
    body = await resp.clone().json();
  } catch {
    body = { message: await resp.clone().text().catch(() => "") };
  }
  const msg = body?.message || body?.error || "request failed";
  const requestId = resp.headers.get("x-request-id") ?? undefined;
  const base = { statusCode: resp.status, requestId, body };
  switch (resp.status) {
    case 401:
      return new AuthenticationError(msg, base);
    case 402:
      return new InsufficientCreditsError(msg, {
        ...base,
        required: body?.details?.required,
        available: body?.details?.available,
      });
    case 403: {
      const m = ADDON_RE.exec(msg);
      return m ? new AddonRequiredError(msg, { ...base, addon: m[1] }) : new AccessDeniedError(msg, base);
    }
    case 404:
      return new NotFoundError(msg, base);
    case 429: {
      const hdr = resp.headers.get("retry-after");
      const ra = body?.retryAfter ?? (hdr ? Number(hdr) : undefined);
      return new RateLimitError(msg, { ...base, retryAfter: ra });
    }
    case 400:
      return /organization/i.test(msg) ? new ConfigurationError(msg, base) : new ValidationError(msg, base);
    default:
      if (resp.status >= 400 && resp.status < 500) return new ValidationError(msg, base);
      return new ServerError(msg, base);
  }
}
