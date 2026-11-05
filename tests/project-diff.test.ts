import assert from "node:assert/strict";
import { test } from "node:test";
import { line_diff } from "../electron/project/diff.ts";

const numbered = (count: number, change: (index: number) => string = (index) => `line ${index}`) =>
  [...Array(count).keys()].map((index) => change(index + 1)).join("\n");

test("a new file is all additions with new line numbers", () => {
  const diff = line_diff(null, "a\nb");
  assert.deepEqual([diff.added, diff.removed], [2, 0]);
  assert.deepEqual(diff.lines, [
    { kind: "add", text: "a", old_line: null, new_line: 1 },
    { kind: "add", text: "b", old_line: null, new_line: 2 },
  ]);
});

test("identical texts produce no lines", () => {
  assert.deepEqual(line_diff("same\ntext", "same\r\ntext"), { added: 0, removed: 0, lines: [] });
});

test("a single change keeps three context lines and marks skipped regions with gaps", () => {
  const before = numbered(20);
  const after = numbered(20, (index) => (index === 10 ? "changed" : `line ${index}`));
  const diff = line_diff(before, after);
  assert.deepEqual([diff.added, diff.removed], [1, 1]);
  assert.equal(diff.lines[0]?.kind, "gap");
  assert.equal(diff.lines.at(-1)?.kind, "gap");
  const body = diff.lines.slice(1, -1);
  assert.deepEqual(
    body.map((line) => line.kind),
    ["context", "context", "context", "remove", "add", "context", "context", "context"],
  );
  assert.deepEqual(body[3], { kind: "remove", text: "line 10", old_line: 10, new_line: null });
  assert.deepEqual(body[4], { kind: "add", text: "changed", old_line: null, new_line: 10 });
  assert.deepEqual(body[5], { kind: "context", text: "line 11", old_line: 11, new_line: 11 });
});

test("two distant changes become two hunks separated by a gap", () => {
  const before = numbered(40);
  const after = numbered(40, (index) => (index === 5 || index === 35 ? `edit ${index}` : `line ${index}`));
  const kinds = line_diff(before, after).lines.map((line) => line.kind);
  assert.equal(kinds.filter((kind) => kind === "gap").length, 3);
  assert.equal(kinds[0], "gap");
});

test("insertions keep old and new line numbers aligned", () => {
  const diff = line_diff("a\nb\nc", "a\nb\nnew\nc");
  assert.deepEqual([diff.added, diff.removed], [1, 0]);
  assert.deepEqual(diff.lines.find((line) => line.kind === "add"), { kind: "add", text: "new", old_line: null, new_line: 3 });
  assert.deepEqual(diff.lines.at(-1), { kind: "context", text: "c", old_line: 3, new_line: 4 });
});

test("large rewrites stay bounded", () => {
  const before = numbered(5000, (index) => `old ${index}`);
  const after = numbered(5000, (index) => `new ${index}`);
  const diff = line_diff(before, after);
  assert.deepEqual([diff.added, diff.removed], [5000, 5000]);
  assert.ok(diff.lines.length <= 2001);
  assert.equal(diff.lines.at(-1)?.kind, "gap");
});

test("a very large new file diffs without overflowing the call stack", () => {
  const diff = line_diff(null, numbered(400_000, (index) => `line ${index}`));
  assert.equal(diff.added, 400_000);
  assert.ok(diff.lines.length <= 2001);
});

test("max_lines null returns every hunk line, the default still stops at 2000 lines", () => {
  const before = numbered(3000);
  const after = numbered(3000, (index) => `changed ${index}`);
  const full = line_diff(before, after, null);
  assert.equal(full.lines.length, 6000);
  assert.equal(full.lines.some((line) => line.kind === "gap"), false);
  const capped = line_diff(before, after);
  assert.equal(capped.lines.length, 2001);
  assert.equal(capped.lines.at(-1)?.kind, "gap");
  assert.deepEqual([full.added, full.removed, capped.added, capped.removed], [3000, 3000, 3000, 3000]);
});
