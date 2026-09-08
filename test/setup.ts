import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, "../../topolab-sdk-spec/fixtures/nl-domino-poi");
const OWNED = resolve(here, "../../topolab-sdk-spec/fixtures/owned");

export const fx = (name: string) => JSON.parse(readFileSync(resolve(FIX, name), "utf8"));
/** Golden fixtures for the owned/archives/coordinates/sql surface. */
export const ownedFx = (name: string) => JSON.parse(readFileSync(resolve(OWNED, name), "utf8"));
export const BASE = "https://api.topolab.nl";
// The OGC collectionId is the dataset slug (no slug->uuid resolution).
export const COLL = "nl-domino-poi";
