// download() and downloadArchive() through the link route
// (POST /v1/dataset/:table/exports).
//
// The link route answers 200 with a 10-minute signed URL, or 202 while the file
// is being prepared. The SDK fetches the signed URL with a plain fetch that
// sends neither X-API-Key nor Accept. A server without the route (404, or 405)
// gets today's call to the old route instead, decided on every call. 402, 403
// and 5xx are raised.
//
// Two real local servers play the API and the storage host, so the signed
// fetch crosses hosts as it does in production. The 404 body is what staging
// answered on 2026-11-24 for POST /v1/dataset/dining_drinking_mcdonalds/exports.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { Client } from "../src/client";
import { download, downloadArchive } from "../src/node";
import { clock } from "../src/links";
import {
  AccessDeniedError,
  ConnectionError,
  InsufficientCreditsError,
  NotFoundError,
  ServerError,
  TimeoutError,
  TopolabError,
} from "../src/errors";

const TABLE = "dining_drinking_mcdonalds";
const LINK = `POST /v1/dataset/${TABLE}/exports`;
const FILES_CSV = `GET /v1/dataset/${TABLE}/files/csv`;
const ARCHIVE_CSV = `GET /v1/dataset/${TABLE}/archives/2026-11/csv`;
const BUILD = "7d3f6c2a-1b4e-4c8d-9a0f-5e6b7c8d9e0f";
const SIGNED_PATH = `/platform-staging-datasets/exports/${TABLE}/2026-12/standard/20261202T020000Z-a1b2c3d4-w1/${TABLE}_2026-12.csv`;
const SIGNED_QUERY =
  "X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=engine%40example.iam.gserviceaccount.com%2F20261203%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20261203T100000Z&X-Goog-Expires=600&X-Goog-SignedHeaders=host&X-Goog-Signature=5f2d0c9e";
const LINK_CSV = "id,location_name,city\n1,McDonald's Amsterdam Centraal,Amsterdam\n";
const OLD_CSV = "id,location_name,city\n1,McDonald's Utrecht Centraal,Utrecht\n";
const ZIP = "PK\u0003\u0004dining_drinking_mcdonalds_2026-11.csv";

interface Reply {
  status: number;
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
}
interface Seen {
  route: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}
interface Mock {
  url: string;
  seen: Seen[];
  count(route: string): number;
  close(): Promise<void>;
}

/** A local HTTP server answering "METHOD /path" routes. A list answers in turn
 *  and repeats its last reply; an unknown route is a 599 so a stray call fails
 *  loudly instead of looking like a fallback. */
function mockServer(routes: Record<string, Reply | Reply[]>): Promise<Mock> {
  const seen: Seen[] = [];
  const served: Record<string, number> = {};
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const url = req.url ?? "";
        const route = `${req.method} ${url.split("?")[0]}`;
        seen.push({ route, url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        const entry = routes[route];
        const list = entry === undefined ? [] : Array.isArray(entry) ? entry : [entry];
        const n = served[route] ?? 0;
        served[route] = n + 1;
        const reply = list[Math.min(n, list.length - 1)] ?? { status: 599, body: `unmocked ${route}` };
        const headers = { ...(reply.headers ?? {}) };
        let payload = reply.body ?? "";
        if (reply.json !== undefined) {
          headers["content-type"] = "application/json";
          payload = JSON.stringify(reply.json);
        }
        res.writeHead(reply.status, headers);
        res.end(payload);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        count: (route) => seen.filter((s) => s.route === route).length,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const ready = (storage: Mock, over: Record<string, unknown> = {}): Reply => ({
  status: 200,
  json: {
    state: "ready",
    url: `${storage.url}${SIGNED_PATH}?${SIGNED_QUERY}`,
    expiresAt: "2026-12-03T10:10:00.000Z",
    filename: `${TABLE}_2026-12.csv`,
    bytes: LINK_CSV.length,
    sha256: "9b2f6a0c".repeat(8),
    tier: "standard",
    month: "2026-12",
    build: BUILD,
    ...over,
  },
});
const preparing = (seconds?: number, headers?: Record<string, string>): Reply => ({
  status: 202,
  headers,
  json: {
    state: "preparing",
    build: BUILD,
    statusUrl: `/v1/dataset/exports/${BUILD}`,
    ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
  },
});
const noRoute: Reply = {
  status: 404,
  json: {
    path: `/v1/dataset/${TABLE}/exports`,
    method: "POST",
    code: 404,
    message: `Cannot POST /v1/dataset/${TABLE}/exports`,
    time: "2026-11-23T23:43:35.228Z",
    requestId: "2b12c5708156347fdeffee2d7be873a7",
  },
};
const buildFailed: Reply = {
  status: 503,
  headers: { "retry-after": "0" },
  json: {
    code: "FILE_BUILD_FAILED",
    message: "This file could not be built.",
    details: { retryAfter: 0, linkRoute: `/v1/dataset/${TABLE}/exports` },
  },
};

let api: Mock | undefined;
let storage: Mock | undefined;
let dir: string;
let waits: number[];
let now: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "topolab-links-"));
  waits = [];
  now = 1_000_000;
  // Record the poll waits instead of sleeping; the clock moves with them.
  vi.spyOn(clock, "sleep").mockImplementation(async (ms: number) => {
    waits.push(ms / 1000);
    now += ms;
  });
  vi.spyOn(clock, "now").mockImplementation(() => now);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await api?.close();
  await storage?.close();
  api = undefined;
  storage = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function servers(apiRoutes: (storage: Mock) => Record<string, Reply | Reply[]>, storageRoutes = {}) {
  storage = await mockServer(storageRoutes);
  api = await mockServer(apiRoutes(storage));
  // Every retried reply below carries Retry-After: 0, so no test waits on backoff.
  const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url }).dataset(TABLE);
  return { ds, api, storage };
}

const signedRoute = `GET ${SIGNED_PATH}`;
const out = (name: string) => join(dir, name);

describe("link route: ready", () => {
  it("download() posts the link route and fetches the signed URL without the key or Accept", async () => {
    const { ds, api, storage } = await servers(
      (s) => ({ [LINK]: ready(s), [FILES_CSV]: { status: 200, body: OLD_CSV } }),
      { [signedRoute]: { status: 200, body: LINK_CSV } },
    );

    expect(await download(ds, out("mcdonalds.csv"), { format: "csv" })).toBe(out("mcdonalds.csv"));

    expect(readFileSync(out("mcdonalds.csv"), "utf8")).toBe(LINK_CSV);
    const posted = api.seen.find((s) => s.route === LINK)!;
    expect(posted.headers["x-api-key"]).toBe("tlb_test_key");
    expect(posted.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(posted.body)).toEqual({ format: "csv", bundle: "file" });
    const fetched = storage.seen.find((s) => s.route === signedRoute)!;
    expect(fetched.headers["x-api-key"]).toBeUndefined();
    expect(fetched.headers.authorization).toBeUndefined();
    expect(fetched.headers.accept).not.toBe("application/json");
    expect(fetched.url).toBe(`${SIGNED_PATH}?${SIGNED_QUERY}`); // the signed query, byte for byte
    expect(api.count(FILES_CSV)).toBe(0);
    expect(waits).toEqual([]);
  });

  it("downloadArchive() sends the month and asks for the zip", async () => {
    const { ds, api } = await servers(
      (s) => ({ [LINK]: ready(s, { month: "2026-11" }), [ARCHIVE_CSV]: { status: 200, body: ZIP } }),
      { [signedRoute]: { status: 200, body: ZIP } },
    );

    await downloadArchive(ds, out("november.zip"), { month: "2026-11", format: "csv" });
    await downloadArchive(ds, out("latest.zip"), { month: "LATEST" });

    const bodies = api.seen.filter((s) => s.route === LINK).map((s) => JSON.parse(s.body));
    expect(bodies).toEqual([
      { format: "csv", month: "2026-11", bundle: "zip" },
      { format: "geojson", month: "latest", bundle: "zip" },
    ]);
    expect(readFileSync(out("november.zip"), "utf8")).toBe(ZIP);
    expect(api.count(ARCHIVE_CSV)).toBe(0);
  });
});

describe("link route: preparing", () => {
  it("polls the link route honouring retryAfterSeconds", async () => {
    const { ds, api, storage } = await servers(
      (s) => ({ [LINK]: [preparing(4), preparing(2), ready(s)] }),
      { [signedRoute]: { status: 200, body: LINK_CSV } },
    );

    await download(ds, out("x.csv"), { format: "csv" });

    expect(waits).toEqual([4, 2]);
    expect(api.count(LINK)).toBe(3);
    expect(storage.count(signedRoute)).toBe(1);
    expect(readFileSync(out("x.csv"), "utf8")).toBe(LINK_CSV);
  });

  it("reads the Retry-After header when the body names no wait, and never spins", async () => {
    const { ds } = await servers(
      (s) => ({ [LINK]: [preparing(undefined, { "retry-after": "7" }), preparing(), preparing(0), ready(s)] }),
      { [signedRoute]: { status: 200, body: LINK_CSV } },
    );

    await download(ds, out("x.csv"), { format: "csv" });

    // header 7 s; nothing at all: 5 s; a zero: the 1 s floor.
    expect(waits).toEqual([7, 5, 1]);
  });

  it("gives up after the wait budget with FILE_PREPARING and the build id", async () => {
    const { ds, api, storage } = await servers(() => ({ [LINK]: preparing(700) }), {
      [signedRoute]: { status: 200, body: LINK_CSV },
    });

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ServerError);
    expect(err.code).toBe("FILE_PREPARING");
    expect(err.status).toBe(202);
    expect(err.details).toEqual({ build: BUILD, retryAfter: 700 });
    expect(waits).toEqual([700, 700]); // a third wait would end at 2,100 s, past the 1,800 s limit
    expect(api.count(LINK)).toBe(3);
    expect(storage.count(signedRoute)).toBe(0);
    expect(existsSync(out("x.csv"))).toBe(false);
  });

  it("stops waiting when the caller aborts", async () => {
    const { ds } = await servers(() => ({ [LINK]: preparing(4) }));
    const ctrl = new AbortController();
    vi.spyOn(clock, "sleep").mockImplementation(async () => {
      ctrl.abort();
    });

    const err = await download(ds, out("x.csv"), { format: "csv", signal: ctrl.signal }).catch((e) => e);

    expect(err).toBeInstanceOf(TopolabError);
    expect(err.message).toMatch(/aborted/);
  });
});

describe("link route: failed and unexpected answers", () => {
  it("raises a failed build and never falls back", async () => {
    const { ds, api } = await servers(() => ({ [LINK]: buildFailed, [FILES_CSV]: { status: 200, body: OLD_CSV } }));

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ServerError);
    expect(err.code).toBe("FILE_BUILD_FAILED");
    expect(err.status).toBe(503);
    expect(api.count(LINK)).toBe(4); // today's 503 retries: 1 try + 3 retries
    expect(api.count(FILES_CSV)).toBe(0);
    expect(existsSync(out("x.csv"))).toBe(false);
  });

  it("raises a server error from the link route and never falls back", async () => {
    const { ds, api } = await servers(() => ({
      [LINK]: { status: 500, headers: { "retry-after": "0" }, json: { code: 500, message: "Internal server error" } },
      [FILES_CSV]: { status: 200, body: OLD_CSV },
    }));

    await expect(download(ds, out("x.csv"), { format: "csv" })).rejects.toBeInstanceOf(ServerError);
    expect(api.count(LINK)).toBe(4);
    expect(api.count(FILES_CSV)).toBe(0);
  });

  it("treats a 200 without a link as a server error", async () => {
    const { ds } = await servers(() => ({ [LINK]: { status: 200, json: { state: "ready" } } }));

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.status).toBe(200);
  });
});

describe("link route: fallback on 404 and 405", () => {
  it("falls back to the files route on 404", async () => {
    const { ds, api, storage } = await servers(() => ({ [LINK]: noRoute, [FILES_CSV]: { status: 200, body: OLD_CSV } }), {
      [signedRoute]: { status: 200, body: LINK_CSV },
    });

    expect(await download(ds, out("x.csv"), { format: "csv" })).toBe(out("x.csv"));

    expect(readFileSync(out("x.csv"), "utf8")).toBe(OLD_CSV);
    expect(api.count(LINK)).toBe(1);
    expect(api.count(FILES_CSV)).toBe(1);
    expect(api.seen.find((s) => s.route === FILES_CSV)!.headers["x-api-key"]).toBe("tlb_test_key");
    expect(storage.count(signedRoute)).toBe(0);
  });

  it("falls back to the archive route on 405", async () => {
    const { ds, api } = await servers(() => ({
      [LINK]: { status: 405, json: { code: 405, message: "Method Not Allowed" } },
      [ARCHIVE_CSV]: { status: 200, body: ZIP },
    }));

    await downloadArchive(ds, out("x.zip"), { month: "2026-11", format: "csv" });

    expect(readFileSync(out("x.zip"), "utf8")).toBe(ZIP);
    expect(api.count(ARCHIVE_CSV)).toBe(1);
  });

  it("keeps the old route's retries and answer", async () => {
    const { ds, api } = await servers(() => ({
      [LINK]: noRoute,
      [FILES_CSV]: [
        {
          status: 503,
          headers: { "retry-after": "0" },
          json: { code: "FILE_PREPARING", message: "This file is being prepared.", details: { retryAfter: 0 } },
        },
        { status: 200, body: OLD_CSV },
      ],
    }));

    await download(ds, out("x.csv"), { format: "csv" });

    expect(api.count(FILES_CSV)).toBe(2);
    expect(readFileSync(out("x.csv"), "utf8")).toBe(OLD_CSV);
  });

  it("raises the old route's 404 after the fallback", async () => {
    const { ds } = await servers(() => ({
      [LINK]: noRoute,
      [ARCHIVE_CSV]: { status: 404, json: { code: 404, message: "No archive for 2026-11" } },
    }));

    await expect(downloadArchive(ds, out("x.zip"), { month: "2026-11", format: "csv" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("decides the fallback on every call", async () => {
    const { ds, api, storage } = await servers(
      (s) => ({ [LINK]: [noRoute, ready(s)], [FILES_CSV]: { status: 200, body: OLD_CSV } }),
      { [signedRoute]: { status: 200, body: LINK_CSV } },
    );

    await download(ds, out("first.csv"), { format: "csv" });
    await download(ds, out("second.csv"), { format: "csv" });

    expect(readFileSync(out("first.csv"), "utf8")).toBe(OLD_CSV);
    expect(readFileSync(out("second.csv"), "utf8")).toBe(LINK_CSV);
    expect([api.count(LINK), api.count(FILES_CSV), storage.count(signedRoute)]).toEqual([2, 1, 1]);
  });
});

describe("link route: 402 and 403 are raised", () => {
  it("raises a 403 without a fallback", async () => {
    const { ds, api } = await servers(() => ({
      [LINK]: { status: 403, json: { code: 403, message: "Your organization has no licence for this dataset" } },
      [FILES_CSV]: { status: 200, body: OLD_CSV },
    }));

    await expect(download(ds, out("x.csv"), { format: "csv" })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(api.count(FILES_CSV)).toBe(0);
    expect(existsSync(out("x.csv"))).toBe(false);
  });

  it("raises a 402 without a fallback", async () => {
    const { ds, api } = await servers(() => ({
      [LINK]: {
        status: 402,
        json: { code: 402, message: "Insufficient credits", details: { required: 20, available: 3 } },
      },
      [ARCHIVE_CSV]: { status: 200, body: ZIP },
    }));

    const err = await downloadArchive(ds, out("x.zip"), { month: "2026-11", format: "csv" }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err.required).toBe(20);
    expect(api.count(ARCHIVE_CSV)).toBe(0);
  });
});

describe("the signed URL", () => {
  it("raises an error without repeating the storage host's body and leaves no file", async () => {
    const { ds } = await servers((s) => ({ [LINK]: ready(s) }), {
      [signedRoute]: {
        status: 400,
        headers: { "content-type": "application/xml" },
        body: "<?xml version='1.0' encoding='UTF-8'?><Error><Code>ExpiredToken</Code><Message>Invalid argument.</Message><Details>X-Goog-Signature=5f2d0c9e</Details></Error>",
      },
    });

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(TopolabError);
    expect(err.status).toBe(400);
    expect(String(err.message)).not.toContain("X-Goog-Signature");
    expect(JSON.stringify(err)).not.toContain("X-Goog-Signature");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("retries a transient answer from the storage host", async () => {
    const { ds, storage } = await servers((s) => ({ [LINK]: ready(s) }), {
      [signedRoute]: [
        { status: 503, headers: { "retry-after": "0" }, body: "<Error/>" },
        { status: 200, body: LINK_CSV },
      ],
    });

    await download(ds, out("x.csv"), { format: "csv" });

    expect(storage.count(signedRoute)).toBe(2);
    expect(readFileSync(out("x.csv"), "utf8")).toBe(LINK_CSV);
  });
});

describe("the signed query never reaches an error", () => {
  // The query of a signed link is its signature: a working bearer link to the
  // file for ten minutes. No text of an error raised on the signed fetch (its
  // message, stack, inspected or JSON form) may carry it.
  const QUERY_PARTS = ["X-Goog-Signature", "5f2d0c9e", "X-Goog-Credential", SIGNED_QUERY];
  const expectNoQuery = (err: unknown) => {
    const e = err as Error;
    for (const text of [String(e?.message), String(e?.stack), inspect(err, { depth: 10 }), JSON.stringify(err)]) {
      for (const part of QUERY_PARTS) expect(text).not.toContain(part);
    }
  };
  const readyAt = (url: string): Reply => ({ status: 200, json: { state: "ready", url, build: BUILD } });

  it("a refused connection to the storage host", async () => {
    const closed = await mockServer({});
    await closed.close();
    api = await mockServer({ [LINK]: readyAt(`${closed.url}${SIGNED_PATH}?${SIGNED_QUERY}`) });
    const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url, maxRetries: 0 }).dataset(TABLE);

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expectNoQuery(err);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a storage host that never answers", async () => {
    const hang = createServer(() => {});
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const port = (hang.address() as { port: number }).port;
    try {
      api = await mockServer({ [LINK]: readyAt(`http://127.0.0.1:${port}${SIGNED_PATH}?${SIGNED_QUERY}`) });
      const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url, maxRetries: 0, timeout: 100 }).dataset(TABLE);

      const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

      expect(err).toBeInstanceOf(TimeoutError);
      expectNoQuery(err);
    } finally {
      hang.closeAllConnections();
      await new Promise<void>((r) => hang.close(() => r()));
    }
  });

  it("a fetch whose own error quotes the URL, as some runtimes' fetch does", async () => {
    const { ds } = await servers((s) => ({ [LINK]: ready(s) }));
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(SIGNED_PATH)) {
        throw new TypeError(`fetch failed: unable to connect to ${url}`, { cause: new Error(`ECONNREFUSED ${url}`) });
      }
      return realFetch(input, init);
    });

    const err = await downloadArchive(ds, out("x.zip"), { month: "2026-11", format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expectNoQuery(err);
    // It still says where it failed: the host and the path.
    expect(err.message).toContain(SIGNED_PATH);
  });

  it("an API request's error is left as fetch wrote it", async () => {
    const { ds } = await servers(() => ({}));
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/exports")) throw new TypeError(`fetch failed: ${url}?probe=1`);
      return realFetch(input, init);
    });
    const tl = new Client({ apiKey: "tlb_test_key", baseUrl: api!.url, maxRetries: 0 });

    const err = await download(tl.dataset(TABLE), out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.message).toContain("/exports?probe=1");
    void ds;
  });

  // A storage host can redirect to a second signed link (a mirror, another
  // bucket). Its query is a signature too, and must not reach an error either.
  const SECOND_QUERY = "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=R2KEY%2F20261203&X-Amz-Signature=c0ffee77";
  const expectNoQueryAtAll = (err: unknown) => {
    expectNoQuery(err);
    const e = err as Error;
    for (const text of [String(e?.message), String(e?.stack), inspect(err, { depth: 10 }), JSON.stringify(err)]) {
      for (const part of ["X-Amz-Signature", "c0ffee77", "R2KEY", "?X-"]) expect(text).not.toContain(part);
    }
  };

  it("a redirect to a second signed link on a host that cannot be reached", async () => {
    const closed = await mockServer({});
    await closed.close();
    const storage = createServer((_req, res) => {
      res.writeHead(302, { location: `${closed.url}/mirror/x.csv?${SECOND_QUERY}` });
      res.end();
    });
    await new Promise<void>((r) => storage.listen(0, "127.0.0.1", () => r()));
    const port = (storage.address() as { port: number }).port;
    try {
      api = await mockServer({ [LINK]: readyAt(`http://127.0.0.1:${port}${SIGNED_PATH}?${SIGNED_QUERY}`) });
      const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url, maxRetries: 0 }).dataset(TABLE);

      const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

      expect(err).toBeInstanceOf(ConnectionError);
      expectNoQueryAtAll(err);
    } finally {
      await new Promise<void>((r) => storage.close(() => r()));
    }
  });

  it("a fetch whose own error quotes the redirect's signed link, as some runtimes' fetch does", async () => {
    api = await mockServer({ [LINK]: readyAt(`https://storage.example${SIGNED_PATH}?${SIGNED_QUERY}`) });
    const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url, maxRetries: 0 }).dataset(TABLE);
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes(SIGNED_PATH)) {
        const mirror = `https://mirror.example/x.csv?${SECOND_QUERY}`;
        throw new TypeError(`error sending request for url (${mirror}): connection refused`);
      }
      return realFetch(input, init);
    });

    const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConnectionError);
    expectNoQueryAtAll(err);
    // It still says where it failed: the host and the path.
    expect(err.message).toContain("https://mirror.example/x.csv");
  });

  it("a storage host that drops the connection in the middle of the file", async () => {
    const storage = createServer((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write("id,location_name\n");
      setTimeout(() => res.socket?.destroy(), 20);
    });
    await new Promise<void>((r) => storage.listen(0, "127.0.0.1", () => r()));
    const port = (storage.address() as { port: number }).port;
    try {
      api = await mockServer({ [LINK]: readyAt(`http://127.0.0.1:${port}${SIGNED_PATH}?${SIGNED_QUERY}`) });
      const ds = new Client({ apiKey: "tlb_test_key", baseUrl: api.url, maxRetries: 0 }).dataset(TABLE);

      const err = await download(ds, out("x.csv"), { format: "csv" }).catch((e) => e);

      expect(err).toBeInstanceOf(Error);
      expectNoQuery(err);
    } finally {
      storage.closeAllConnections();
      await new Promise<void>((r) => storage.close(() => r()));
    }
  });
});

describe("sample() is unchanged", () => {
  it("reads the sample route and never the link route", async () => {
    const { ds, api } = await servers(() => ({
      [`GET /v1/dataset/${TABLE}/sample/geojson`]: { status: 200, json: { type: "FeatureCollection", features: [] } },
    }));

    expect(await ds.sample()).toEqual({ type: "FeatureCollection", features: [] });
    expect(api.seen.map((s) => s.route)).toEqual([`GET /v1/dataset/${TABLE}/sample/geojson`]);
  });
});
