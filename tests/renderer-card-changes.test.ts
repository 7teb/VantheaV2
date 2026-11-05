import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffSummary } from "../shared/turn-diff.ts";
import { card_changes } from "../src/features/chat/card-changes.ts";
import { diff_entry, edit_step, ready } from "./turn-diff-ui-kit.ts";

const edits = [edit_step("e1", "src/a.ts", 4, 1), edit_step("e2", "src/a.ts", 2, 0), edit_step("e3", "src/b.ts", 1, 1)];

test("a ready git summary with entries replaces the edit rows", () => {
  const summary = ready([
    diff_entry("src/a.ts", "modified", { added: 6, removed: 1 }),
    diff_entry("build/out.js", "added", { added: 40, removed: 0 }),
    diff_entry("old.txt", "deleted", { added: 0, removed: 3 }),
    diff_entry("logo.png", "modified", { added: null, removed: null, binary: true }),
    diff_entry("vendor/lib", "submodule", { commits: { from: "a", to: "b" } }),
  ]);
  const card = card_changes(summary, edits);
  assert.equal(card.source, "snapshot");
  assert.deepEqual(card.rows, [
    { path: "src/a.ts", added: 6, removed: 1, created: false, deleted: false, binary: false, submodule: false },
    { path: "build/out.js", added: 40, removed: 0, created: true, deleted: false, binary: false, submodule: false },
    { path: "old.txt", added: 0, removed: 3, created: false, deleted: true, binary: false, submodule: false },
    { path: "logo.png", added: 0, removed: 0, created: false, deleted: false, binary: true, submodule: false },
    { path: "vendor/lib", added: 0, removed: 0, created: false, deleted: false, binary: false, submodule: true },
  ]);
});

test("recorded, none, failed, loading and an empty git summary fall back to the edit rows", () => {
  const fallbacks: (DiffSummary | null)[] = [
    null,
    { kind: "none" },
    { kind: "failed", error: "fatal: bad object" },
    ready([diff_entry("src/a.ts")], { source: "recorded" }),
    ready([]),
  ];
  for (const summary of fallbacks) {
    const card = card_changes(summary, edits);
    assert.equal(card.source, "edits");
    assert.deepEqual(card.rows, [
      { path: "src/a.ts", added: 6, removed: 1, created: false, deleted: false, binary: false, submodule: false },
      { path: "src/b.ts", added: 1, removed: 1, created: false, deleted: false, binary: false, submodule: false },
    ]);
  }
});

test("a command-only turn gets rows only from a ready git summary that has entries", () => {
  for (const summary of [null, { kind: "none" } as const, { kind: "failed", error: "x" } as const, ready([]), ready([diff_entry("a.txt")], { source: "recorded" })]) {
    assert.deepEqual(card_changes(summary, []).rows, []);
  }
  const card = card_changes(ready([diff_entry("dist/app.js", "added")]), []);
  assert.equal(card.source, "snapshot");
  assert.deepEqual(
    card.rows.map((row) => row.path),
    ["dist/app.js"],
  );
});
