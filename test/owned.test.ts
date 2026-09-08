import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "../src/client";
import { normalizeArchiveMonth } from "../src/dataset";
import { AddonRequiredError, NotFoundError, QueryTimeoutError, ValidationError } from "../src/errors";
import { ownedFx, BASE } from "./setup";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TABLE = "business_professional_services_autocrew";
const tl = () => new Client({ apiKey: "k", baseUrl: BASE });

/** Serve `total` synthetic owned datasets, honouring limit/offset the way the
 *  API does, and record what each request asked for. */
function ownedCatalog(total: number, seen: { limit: number; offset: number }[]) {
  return http.get(`${BASE}/v1/dataset/owned`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const limit = Number(q.get("limit") ?? 50);
    const offset = Number(q.get("offset") ?? 0);
    seen.push({ limit, offset });
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      table: `t${offset + i}`,
      name: `Dataset ${offset + i}`,
      recordCount: 1,
      latestArchiveMonth: "2026-07",
      latestArchiveFormats: ["geojson"],
      archiveMonthsAvailable: 11,
      links: {
        current: `${BASE}/v1/dataset/t${offset + i}/files/{format}`,
        archives: `${BASE}/v1/dataset/t${offset + i}/archives/list`,
        latestArchive: `${BASE}/v1/dataset/t${offset + i}/archives/latest/{format}`,
      },
    }));
    return HttpResponse.json({ items, total, limit, offset });
  });
}

describe("datasets.owned", () => {
  it("returns a page and the full licensed total (not the page size)", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(`${BASE}/v1/dataset/owned`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(ownedFx("owned.json"));
      }),
    );
    const page = await tl().datasets.owned({ limit: 2, offset: 0 });
    expect(page.items.length).toBe(2);
    expect(page.total).toBe(193); // all licensed datasets, not this page
    expect(page.items[0].table).toBe(TABLE);
    expect(page.items[0].links.current).toContain("{format}");
    expect(page.items[0].links.latestArchive).toContain("{format}");
    expect(seen[0].searchParams.get("limit")).toBe("2");
    expect(seen[0].searchParams.get("offset")).toBe("0");
  });

  it("omits unset paging params", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(`${BASE}/v1/dataset/owned`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(ownedFx("owned.json"));
      }),
    );
    await tl().datasets.owned();
    expect(seen[0].searchParams.get("limit")).toBeNull();
    expect(seen[0].searchParams.get("offset")).toBeNull();
  });

  it("rejects an out-of-range limit client-side", async () => {
    await expect(tl().datasets.owned({ limit: 201 })).rejects.toThrow(/between 1 and 200/);
    await expect(tl().datasets.owned({ offset: -1 })).rejects.toThrow(/offset/);
  });
});

describe("datasets.iterOwned", () => {
  it("pages by offset with no repeats and no gaps, and terminates", async () => {
    const seen: { limit: number; offset: number }[] = [];
    server.use(ownedCatalog(7, seen));
    const tables: string[] = [];
    for await (const ds of tl().datasets.iterOwned({ pageSize: 3 })) tables.push(ds.table);
    expect(tables).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(new Set(tables).size).toBe(tables.length); // no repeats
    expect(seen.map((s) => s.offset)).toEqual([0, 3, 6]); // last page is short -> stop
  });

  it("stops once the reported total is reached, without an extra empty page", async () => {
    const seen: { limit: number; offset: number }[] = [];
    server.use(ownedCatalog(6, seen));
    const tables: string[] = [];
    for await (const ds of tl().datasets.iterOwned({ pageSize: 3 })) tables.push(ds.table);
    expect(tables.length).toBe(6);
    expect(seen.map((s) => s.offset)).toEqual([0, 3]); // total reached; no third call
  });

  it("honours totalLimit and stops requesting", async () => {
    const seen: { limit: number; offset: number }[] = [];
    server.use(ownedCatalog(100, seen));
    const tables: string[] = [];
    for await (const ds of tl().datasets.iterOwned({ pageSize: 3, totalLimit: 4 })) tables.push(ds.table);
    expect(tables).toEqual(["t0", "t1", "t2", "t3"]);
    expect(seen.length).toBe(2);
  });

  it("terminates on an empty first page", async () => {
    const seen: { limit: number; offset: number }[] = [];
    server.use(ownedCatalog(0, seen));
    const tables: string[] = [];
    for await (const ds of tl().datasets.iterOwned()) tables.push(ds.table);
    expect(tables).toEqual([]);
    expect(seen.length).toBe(1);
  });
});

describe("archives", () => {
  it("returns the bare array, newest month first", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/archives/list`, () =>
        HttpResponse.json(ownedFx("archives.json")),
      ),
    );
    const list = await tl().dataset(TABLE).archives();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(11);
    expect(list[0].month).toBe("2026-07");
    expect(list[list.length - 1].month).toBe("2025-09");
    expect(list.map((a) => a.month)).toEqual([...list.map((a) => a.month)].sort().reverse());
    expect(list[0].formats).toContain("shp");
    expect(list[0].archiveDate).toBe("2026-07-01");
  });

  it("surfaces the archived-data add-on requirement", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/archives/list`, () =>
        HttpResponse.json(
          {
            message: "Archive access requires the Archived Data add-on. Please upgrade to access historical data.",
          },
          { status: 403 },
        ),
      ),
    );
    await expect(tl().dataset(TABLE).archives()).rejects.toBeInstanceOf(AddonRequiredError);
  });
});

describe("archive month validation", () => {
  it("accepts latest in any case, YYYY-MM and YYYY-MM-DD", () => {
    expect(normalizeArchiveMonth("latest")).toBe("latest");
    expect(normalizeArchiveMonth("LATEST")).toBe("latest");
    expect(normalizeArchiveMonth("Latest")).toBe("latest");
    expect(normalizeArchiveMonth("2026-07")).toBe("2026-07");
    expect(normalizeArchiveMonth("2026-07-15")).toBe("2026-07-15");
    expect(normalizeArchiveMonth("2026-01-01")).toBe("2026-01-01");
    expect(normalizeArchiveMonth("2026-12-31")).toBe("2026-12-31");
  });

  it("rejects impossible calendar values, not just malformed shapes", () => {
    for (const bad of [
      "julyish",
      "2026",
      "2026-13", // month 13 is well-shaped but not a real month
      "2026-00",
      "2026-07-99",
      "2026-07-00",
      "2026-04-31", // April has 30 days
      "2026-7",
      "26-07",
      "2026-07-15T00:00:00Z",
      "",
      "latest ",
    ])
      expect(() => normalizeArchiveMonth(bad)).toThrow(/archive month/);
  });

  it("handles leap years", () => {
    expect(normalizeArchiveMonth("2024-02-29")).toBe("2024-02-29"); // leap year
    expect(() => normalizeArchiveMonth("2026-02-29")).toThrow(/archive month/); // not a leap year
    expect(normalizeArchiveMonth("2000-02-29")).toBe("2000-02-29"); // century leap year
    expect(() => normalizeArchiveMonth("1900-02-29")).toThrow(/archive month/); // century non-leap
  });
});

describe("coordinates", () => {
  const rows = () => ownedFx("coordinates.json");

  it("reads the paging facts from response headers", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/coordinates`, () =>
        HttpResponse.json(rows(), {
          headers: { "X-Total-Count": "119", "X-Returned-Count": "2", "X-Offset": "10" },
        }),
      ),
    );
    const page = await tl().dataset(TABLE).coordinates({ limit: 2, offset: 10 });
    expect(page.total).toBe(119);
    expect(page.returned).toBe(2);
    expect(page.offset).toBe(10);
    expect(page.rows.length).toBe(2);
  });

  it("keeps latitude/longitude as the strings the API sends", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/coordinates`, () => HttpResponse.json(rows())),
    );
    const page = await tl().dataset(TABLE).coordinates();
    expect(page.rows[0].latitude).toBe("51.49638600");
    expect(page.rows[0].longitude).toBe("3.65532100");
    expect(page.rows[0].location.type).toBe("Point");
    expect(page.rows[0].location.coordinates).toEqual([3.655321, 51.496386]);
    expect(page.rows[0].metadata.city).toBe("Middelburg");
  });

  it("falls back to the row count when the headers are missing", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/coordinates`, () => HttpResponse.json(rows())),
    );
    const page = await tl().dataset(TABLE).coordinates();
    expect(page.total).toBe(2);
    expect(page.returned).toBe(2);
    expect(page.offset).toBe(0);
  });

  it("falls back when the headers are unparseable rather than throwing", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/coordinates`, () =>
        HttpResponse.json(rows(), {
          headers: { "X-Total-Count": "many", "X-Returned-Count": "  ", "X-Offset": "n/a" },
        }),
      ),
    );
    const page = await tl().dataset(TABLE).coordinates();
    expect(page.total).toBe(2);
    expect(page.returned).toBe(2);
    expect(page.offset).toBe(0);
  });

  it("omits unset paging params and validates the bounds client-side", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/coordinates`, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(rows());
      }),
    );
    await tl().dataset(TABLE).coordinates();
    expect(seen[0].searchParams.get("limit")).toBeNull();
    expect(seen[0].searchParams.get("offset")).toBeNull();
    await expect(tl().dataset(TABLE).coordinates({ limit: 50001 })).rejects.toThrow(/between 1 and 50000/);
    await expect(tl().dataset(TABLE).coordinates({ offset: -1 })).rejects.toThrow(/offset/);
  });
});

describe("sql", () => {
  it("posts the query and decodes the result", async () => {
    let body: any;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v1/sql/query`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.json();
        return HttpResponse.json(ownedFx("sql-result.json"));
      }),
    );
    const res = await tl().sql("SELECT city, count(*) AS n FROM t GROUP BY 1", { maxRows: 100 });
    expect(body).toEqual({ sql: "SELECT city, count(*) AS n FROM t GROUP BY 1", maxRows: 100 });
    expect(contentType).toContain("application/json");
    expect(res.columns).toEqual(["city", "n"]);
    expect(res.rowCount).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.elapsedMs).toBeCloseTo(41.7);
    expect(res.datasets).toEqual([TABLE]);
  });

  it("omits maxRows when it is not given", async () => {
    let body: any;
    server.use(
      http.post(`${BASE}/v1/sql/query`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ownedFx("sql-result.json"));
      }),
    );
    await tl().sql("SELECT 1");
    expect(body).toEqual({ sql: "SELECT 1" });
    expect("maxRows" in body).toBe(false);
  });

  it("maps the sql-access 403 to AddonRequiredError with the slug", async () => {
    server.use(
      http.post(`${BASE}/v1/sql/query`, () =>
        HttpResponse.json(ownedFx("error-403-sql-access.json"), { status: 403 }),
      ),
    );
    const err = await tl()
      .sql("SELECT 1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(AddonRequiredError);
    expect((err as AddonRequiredError).addon).toBe("sql-access");
    expect((err as AddonRequiredError).requestId).toBe("e600e461a1bedacc6a48cb2bd3ffee07");
  });

  it("maps a 408 to QueryTimeoutError", async () => {
    server.use(
      http.post(`${BASE}/v1/sql/query`, () =>
        HttpResponse.json({ code: 408, message: "Query exceeded the time limit" }, { status: 408 }),
      ),
    );
    await expect(tl().sql("SELECT pg_sleep(60)")).rejects.toBeInstanceOf(QueryTimeoutError);
  });
});

describe("archive error envelope", () => {
  it("maps a malformed month rejected server-side to ValidationError", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/archives/latest/csv`, () =>
        HttpResponse.json(ownedFx("error-400-month.json"), { status: 400 }),
      ),
    );
    const err = await tl()
      .dataset(TABLE)
      .t.request(`/v1/dataset/${TABLE}/archives/latest/csv`)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    // No X-Request-Id header here: the id comes from the body envelope.
    expect(err.requestId).toBe("20dd1c40c296014ac5d6cd8ac153d5e8");
  });

  it("maps a missing archive to NotFoundError", async () => {
    server.use(
      http.get(`${BASE}/v1/dataset/${TABLE}/archives/2026-06/csv`, () =>
        HttpResponse.json(ownedFx("error-404-archive.json"), { status: 404 }),
      ),
    );
    await expect(
      tl().dataset(TABLE).t.request(`/v1/dataset/${TABLE}/archives/2026-06/csv`),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
