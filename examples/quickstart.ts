import { Client } from "@topolab/sdk";

const tl = new Client({ apiKey: process.env.TOPOLAB_API_KEY });
const fc = await tl.dataset("nl-domino-poi").items({ limit: 100, bbox: [4.7, 52.2, 5.1, 52.5] });
console.log(`${fc.features.length} Domino's locations in the bbox`);
