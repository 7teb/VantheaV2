import assert from "node:assert/strict";
import { test } from "node:test";
import { diff_bars, diff_totals, parse_unified_diff } from "../shared/git/diff-parse.ts";
import type { DiffLine } from "../shared/tool-view.ts";

const add = (text: string, new_line: number): DiffLine => ({ kind: "add", text, old_line: null, new_line });
const remove = (text: string, old_line: number): DiffLine => ({ kind: "remove", text, old_line, new_line: null });
const context = (text: string, old_line: number, new_line: number): DiffLine => ({ kind: "context", text, old_line, new_line });
const gap: DiffLine = { kind: "gap", text: "", old_line: null, new_line: null };

const header = ["diff --git a/src/app.ts b/src/app.ts", "index 1111111..2222222 100644", "--- a/src/app.ts", "+++ b/src/app.ts"];

test("hunk heads set the line numbers, a skipped stretch before or between hunks becomes a gap", () => {
  const text = [...header, "@@ -5,3 +5,3 @@ export const run = () => {", " a", "-b", "+B", " c", "@@ -20,2 +20,3 @@", " x", "+y", " z", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text), {
    binary: false,
    lines: [gap, context("a", 5, 5), remove("b", 6), add("B", 6), context("c", 7, 7), gap, context("x", 20, 20), add("y", 21), context("z", 21, 22)],
  });
});

test("hunk heads without counts mean one line, and adjacent hunks get no gap between them", () => {
  const text = [...header, "@@ -1 +1 @@", "-old", "+new", "@@ -2,1 +2,1 @@", "-two", "+TWO", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text).lines, [remove("old", 1), add("new", 1), remove("two", 2), add("TWO", 2)]);
});

test("the no-newline marker belongs to the line before it and adds no row", () => {
  const text = [...header, "@@ -1,2 +1,2 @@", " keep", "-last", "\\ No newline at end of file", "+last", "\\ No newline at end of file", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text).lines, [context("keep", 1, 1), remove("last", 2), add("last", 2)]);
});

test("an empty line inside a hunk is a context line, and a trailing carriage return is dropped", () => {
  const text = [...header, "@@ -1,3 +1,3 @@", " first\r", "", "-third\r", "+THIRD\r", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text).lines, [context("first", 1, 1), context("", 2, 2), remove("third", 3), add("THIRD", 3)]);
});

test("removed or added lines that look like file headers stay rows of the hunk", () => {
  const text = [...header, "@@ -1,2 +1,2 @@", "--- not a header", "+++ not a header either", " end", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text).lines, [remove("-- not a header", 1), add("++ not a header either", 1), context("end", 2, 2)]);
});

test("a rename head with similarity and rename lines is skipped up to the first hunk", () => {
  const text = [
    "diff --git a/old name.txt b/new name.txt",
    "similarity index 80%",
    "rename from old name.txt",
    "rename to new name.txt",
    "index 3333333..4444444 100644",
    "--- a/old name.txt",
    "+++ b/new name.txt",
    "@@ -1,2 +1,2 @@",
    " same",
    "-gone",
    "+came",
    "",
  ].join("\n");
  assert.deepEqual(parse_unified_diff(text), { binary: false, lines: [context("same", 1, 1), remove("gone", 2), add("came", 2)] });
});

test("new and deleted files start at line one without a gap", () => {
  const created = ["diff --git a/n.txt b/n.txt", "new file mode 100644", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n");
  assert.deepEqual(parse_unified_diff(created).lines, [add("one", 1), add("two", 2)]);
  const deleted = ["diff --git a/d.txt b/d.txt", "deleted file mode 100644", "--- a/d.txt", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-one", "-two", ""].join("\n");
  assert.deepEqual(parse_unified_diff(deleted).lines, [remove("one", 1), remove("two", 2)]);
});

test("a binary notice marks the diff binary and has no rows", () => {
  const text = ["diff --git a/b.dat b/b.dat", "index 5555555..6666666 100644", "Binary files a/b.dat and b/b.dat differ", ""].join("\n");
  assert.deepEqual(parse_unified_diff(text), { binary: true, lines: [] });
});

test("totals count added and removed rows", () => {
  assert.deepEqual(diff_totals([context("a", 1, 1), remove("b", 2), add("B", 2), add("C", 3), gap]), { added: 2, removed: 1 });
});

test("bars mark added blocks, changed blocks and the place of a deletion on the new side", () => {
  const lines = [
    context("a", 1, 1),
    add("new", 2),
    add("new", 3),
    context("b", 2, 4),
    remove("old", 3),
    add("NEW", 5),
    context("c", 4, 6),
    remove("gone", 5),
    remove("gone", 6),
    context("d", 7, 7),
    gap,
    context("y", 40, 40),
    remove("tail", 41),
  ];
  assert.deepEqual(diff_bars(lines), [
    { kind: "added", line: 2, count: 2 },
    { kind: "modified", line: 5, count: 1 },
    { kind: "deleted", line: 7, count: 0 },
    { kind: "deleted", line: 41, count: 0 },
  ]);
});
