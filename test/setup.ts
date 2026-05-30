import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, "../../topolab-sdk-spec/fixtures/nl-domino-poi");

export const fx = (name: string) => JSON.parse(readFileSync(resolve(FIX, name), "utf8"));
export const BASE = "https://api.topolab.nl";
export const COLL = "dataset-3f9a2c7e-8b1d-4056-a1c2-e3f4a5b6c7d8";
