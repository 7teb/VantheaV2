import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_numstat, parse_raw } from "../shared/git/numstat-parse.ts";

test("numstat with -z gives added and removed per path, paths stay raw with spaces and umlauts", () => {
  const text = "3\t1\tsrc/app.ts\x0012\t0\tdocs/über uns.md\x000\t7\told.txt\x00";
  assert.deepEqual(parse_numstat(text), [
    { path: "src/app.ts", orig_path: null, added: 3, removed: 1 },
    { path: "docs/über uns.md", orig_path: null, added: 12, removed: 0 },
    { path: "old.txt", orig_path: null, added: 0, removed: 7 },
  ]);
});

test("a binary file has no counts", () => {
  assert.deepEqual(parse_numstat("-\t-\tlogo.png\x00"), [{ path: "logo.png", orig_path: null, added: null, removed: null }]);
});

test("a rename puts both paths after an empty path field", () => {
  const text = "2\t1\t\x00src/old name.ts\x00src/new name.ts\x001\t0\tnext.ts\x00";
  assert.deepEqual(parse_numstat(text), [
    { path: "src/new name.ts", orig_path: "src/old name.ts", added: 2, removed: 1 },
    { path: "next.ts", orig_path: null, added: 1, removed: 0 },
  ]);
});

test("raw records with -z carry the status letter and one or two paths", () => {
  const text = [
    ":100644 100644 aaaaaaa bbbbbbb M",
    "src/app.ts",
    ":000000 100644 0000000 ccccccc A",
    "src/new.ts",
    ":100644 100644 ddddddd eeeeeee R087",
    "src/before.ts",
    "src/after.ts",
    ":100644 000000 fffffff 0000000 D",
    "gone.txt",
    "",
  ].join("\x00");
  assert.deepEqual(parse_raw(text), [
    { status: "M", path: "src/app.ts", orig_path: null, old_mode: "100644", new_mode: "100644", old_oid: "aaaaaaa", new_oid: "bbbbbbb" },
    { status: "A", path: "src/new.ts", orig_path: null, old_mode: "000000", new_mode: "100644", old_oid: "0000000", new_oid: "ccccccc" },
    { status: "R", path: "src/after.ts", orig_path: "src/before.ts", old_mode: "100644", new_mode: "100644", old_oid: "ddddddd", new_oid: "eeeeeee" },
    { status: "D", path: "gone.txt", orig_path: null, old_mode: "100644", new_mode: "000000", old_oid: "fffffff", new_oid: "0000000" },
  ]);
});

test("raw and numstat records in one stream are told apart", () => {
  const text = [":100644 100644 aaaaaaa bbbbbbb R100", "a.txt", "b.txt", ":100644 100644 ccccccc ddddddd M", "c.txt", "0\t0\t", "a.txt", "b.txt", "4\t2\tc.txt", ""].join("\x00");
  assert.deepEqual(parse_raw(text), [
    { status: "R", path: "b.txt", orig_path: "a.txt", old_mode: "100644", new_mode: "100644", old_oid: "aaaaaaa", new_oid: "bbbbbbb" },
    { status: "M", path: "c.txt", orig_path: null, old_mode: "100644", new_mode: "100644", old_oid: "ccccccc", new_oid: "ddddddd" },
  ]);
  assert.deepEqual(parse_numstat(text), [
    { path: "b.txt", orig_path: "a.txt", added: 0, removed: 0 },
    { path: "c.txt", orig_path: null, added: 4, removed: 2 },
  ]);
});
