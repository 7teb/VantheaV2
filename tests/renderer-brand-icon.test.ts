import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/components/icons-brand.tsx", import.meta.url), "utf8");

const path_hashes = [...source.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)].map((match) => createHash("sha256").update(match[1] ?? "").digest("hex"));

test("the brand file holds exactly the OpenAI mark and the Claude mark", () => {
  assert.equal(path_hashes.length, 2);
});

test("the OpenAI mark keeps the brand path unchanged and draws it filled without an outline", () => {
  assert.ok(path_hashes.includes("5461b39df06235bd3d257d041086f901bf2c5965c2fd172e657e372a3f77be02"));
  assert.match(source, /viewBox="769\.694 228\.635 267\.196 264\.812"/);
  assert.match(source, /fill="currentColor"/);
  assert.match(source, /stroke="none"/);
  assert.match(source, /\{\.\.\.props\} plain>/);
});

test("the Claude mark keeps the path of claude.ai's favicon unchanged and takes its colour from the claude-logo class", () => {
  assert.ok(path_hashes.includes("ec2b47eb6d93adab36c75f061c6cf7970fa634dad5672491ce907046dc161db7"));
  assert.match(source, /viewBox="0 0 248 248"/);
  assert.match(source, /class_names\("claude-logo", className\)/);
});
