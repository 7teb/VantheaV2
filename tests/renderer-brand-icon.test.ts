import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/components/icons-brand.tsx", import.meta.url), "utf8");

test("the OpenAI mark keeps the brand path unchanged and draws it filled without an outline", () => {
  const paths = [...source.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(paths.length, 1);
  assert.equal(createHash("sha256").update(paths[0] ?? "").digest("hex"), "5461b39df06235bd3d257d041086f901bf2c5965c2fd172e657e372a3f77be02");
  assert.match(source, /viewBox="769\.694 228\.635 267\.196 264\.812"/);
  assert.match(source, /fill="currentColor"/);
  assert.match(source, /stroke="none"/);
  assert.match(source, /\{\.\.\.props\} plain>/);
});
