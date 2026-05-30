import type { Transport } from "./transport";
import type { DatasetSummary, FeatureCollection, Feature, ItemsQuery } from "./types";

function itemsParams(q: ItemsQuery): Record<string, unknown> {
  const p: Record<string, unknown> = {
    limit: q.limit,
    offset: q.offset,
    category: q.category,
    city: q.city,
    country: q.country,
  };
  if (q.bbox) p.bbox = q.bbox.join(",");
  return p;
}

export class Dataset {
  private collectionId?: string;
  constructor(readonly t: Transport, public readonly slug: string) {}

  metadata(locale?: string): Promise<DatasetSummary> {
    return this.t.getJson<DatasetSummary>(`/v1/dataset/${this.slug}`, locale ? { locale } : undefined);
  }

  toGeoJSON(): Promise<FeatureCollection> {
    return this.t.getJson<FeatureCollection>(`/v1/dataset/${this.slug}/files/geojson`);
  }

  async sample(opts: { format?: string } = {}): Promise<unknown> {
    const format = opts.format ?? "geojson";
    const resp = await this.t.request(`/v1/dataset/${this.slug}/sample/${format}`);
    return format === "json" || format === "geojson" ? resp.json() : resp.text();
  }

  private async cid(): Promise<string> {
    if (!this.collectionId) this.collectionId = "dataset-" + (await this.metadata()).id;
    return this.collectionId;
  }

  async items(q: ItemsQuery = {}): Promise<FeatureCollection> {
    return this.t.getJson<FeatureCollection>(
      `/v1/ogc/collections/${await this.cid()}/items`,
      itemsParams({ limit: 100, ...q }),
    );
  }

  async *iterItems(
    q: { pageSize?: number; totalLimit?: number } & Omit<ItemsQuery, "limit" | "offset"> = {},
  ): AsyncGenerator<Feature> {
    const pageSize = q.pageSize ?? 100;
    const cid = await this.cid();
    let yielded = 0;
    let offset = 0;
    const ctrl = new AbortController();
    try {
      while (true) {
        const fc = await this.t.getJson<FeatureCollection>(
          `/v1/ogc/collections/${cid}/items`,
          itemsParams({ ...q, limit: pageSize, offset }),
          ctrl.signal,
        );
        const feats = fc.features ?? [];
        if (feats.length === 0) return;
        for (const f of feats) {
          yield f;
          yielded++;
          if (q.totalLimit != null && yielded >= q.totalLimit) return;
        }
        if (feats.length < pageSize) return;
        offset += pageSize;
      }
    } finally {
      ctrl.abort(); // cancel any in-flight request if the caller breaks early
    }
  }
}
