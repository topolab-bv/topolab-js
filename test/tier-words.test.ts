// The SDK says what the Advanced tier is (columns marked Advanced on the
// dataset page) and never which plans hold it: who gets Advanced changes with
// the plans and the Advanced add-on, and the dataset page is where that is
// stated. A sentence that names the tier names no plan. The sibling spec's
// texts (openapi.json, conventions.md) are held to the same rule.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const spec = resolve(here, "../../topolab-sdk-spec");

const TIER = /\badvanced\b/i;
const PLAN = /\b(Hobbyist|Lite|Team|Enterprise)\b/;

function sentences(text: string): string[] {
  return text
    .replace(/^\s*(\/\/+|\/\*\*?|\*\/|\*)\s?/gm, "")
    .split(/[.!?](?:\s+|$)|\n\s*\n/)
    .map((s) => s.split(/\s+/).join(" ").trim())
    .filter(Boolean);
}

function offending(text: string): string[] {
  return sentences(text).filter((s) => TIER.test(s) && PLAN.test(s));
}

const files = (dir: string, ext: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f)) : [];

/** Every description and summary in an OpenAPI document. */
function openapiTexts(doc: unknown, out: string[] = []): string[] {
  if (Array.isArray(doc)) doc.forEach((d) => openapiTexts(d, out));
  else if (doc && typeof doc === "object") {
    for (const [k, v] of Object.entries(doc)) {
      if ((k === "description" || k === "summary") && typeof v === "string") out.push(v);
      else openapiTexts(v, out);
    }
  }
  return out;
}

describe("tier words", () => {
  it("no sentence about the Advanced tier in this SDK names a plan", () => {
    const found = [...files(join(root, "src"), ".ts"), ...files(join(root, "docs"), ".md"), join(root, "README.md")]
      .flatMap((f) => offending(readFileSync(f, "utf8")).map((s) => `${f}: ${s}`));
    expect(found).toEqual([]);
  });

  it.skipIf(!existsSync(join(spec, "openapi.json")))("nor in the spec's openapi.json and conventions.md", () => {
    const doc = JSON.parse(readFileSync(join(spec, "openapi.json"), "utf8"));
    const found = [
      ...openapiTexts(doc).flatMap((t) => offending(t).map((s) => `openapi.json: ${s}`)),
      ...offending(readFileSync(join(spec, "conventions.md"), "utf8")).map((s) => `conventions.md: ${s}`),
    ];
    expect(found).toEqual([]);
  });
});
