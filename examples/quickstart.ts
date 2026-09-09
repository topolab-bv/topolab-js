import { Client } from "@topolab/sdk";
import { downloadArchive } from "@topolab/sdk/node";

const tl = new Client({ apiKey: process.env.TOPOLAB_API_KEY });

// The integration loop: discover what the organization licences, then pull each
// dataset's newest snapshot. No hard-coded slugs — iterOwned() is filtered by
// the same licence check the download routes enforce.
for await (const ds of tl.datasets.iterOwned()) {
  await downloadArchive(tl.dataset(ds.table), `${ds.table}.zip`, { month: "latest", format: "geojson" });
  console.log(`${ds.name}: ${ds.archiveMonthsAvailable} archive months, latest ${ds.latestArchiveMonth}`);
}

// One page at a time, if you would rather drive the paging yourself.
const page = await tl.datasets.owned({ limit: 10 });
console.log(`${page.items.length} of ${page.total} licensed datasets`);

// Spatial query against one dataset.
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
console.log(`${fc.features.length} Domino's locations in the bbox`);
