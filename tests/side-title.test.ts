import assert from "node:assert/strict";
import { test } from "node:test";
import { clean_title, generate_title } from "../electron/side/title.ts";
import type { SideModelCall } from "../electron/tools/types.ts";

test("clean_title strips prefixes, quotes, markdown and trailing punctuation", () => {
  assert.equal(clean_title("Title: Coding request"), "Coding request");
  assert.equal(clean_title('"Coding request".'), "Coding request");
  assert.equal(clean_title("  Fix the bug  "), "Fix the bug");
  assert.equal(clean_title("**Bold plan**"), "Bold plan");
  assert.equal(clean_title("Name - Memory store"), "Memory store");
});

test("clean_title takes the first non-empty line and collapses whitespace", () => {
  assert.equal(clean_title("\n\n  Chat about   refactors\nsecond line"), "Chat about refactors");
});

test("clean_title caps the length and tolerates empty input", () => {
  assert.equal(clean_title(""), "");
  assert.equal(clean_title("x".repeat(80)).length, 48);
});

test("generate_title runs the title side model and cleans the result", async () => {
  const seen: { role: string; max: number | null } = { role: "", max: null };
  const side: SideModelCall = async (role, _messages, max_tokens) => {
    seen.role = role;
    seen.max = max_tokens;
    return 'Title: "Fix streaming"\n';
  };
  const title = await generate_title("the stream keeps breaking", side);
  assert.equal(title, "Fix streaming");
  assert.equal(seen.role, "title");
  assert.ok(seen.max !== null && seen.max > 0);
});
