import assert from "node:assert/strict";
import { test } from "node:test";
import type { GrepMatch } from "../shared/tool-view.ts";
import { search_header } from "../electron/tools/fs/search.ts";

const query = { query: "chat", path: "", regex: false, case_sensitive: false };

const match = (path: string, line: number): GrepMatch => ({ path, line, text: "chat" });

test("the search header counts the files that hold matches, not the files ripgrep searched", () => {
  const matches = [match("app.js", 3), match("app.js", 9), match("src/chat.ts", 1), match("src/main.ts", 4)];
  assert.equal(search_header(query, matches, false, "literal"), '4 matching lines for "chat" (literal, case-insensitive) in 3 files');
  assert.equal(search_header(query, [match("app.js", 3)], false, "literal"), '1 matching lines for "chat" (literal, case-insensitive) in 1 file');
});

test("a capped search names a lower bound of files instead of saying the count is unavailable", () => {
  const matches = Array.from({ length: 200 }, (_, index) => match(index < 150 ? "a.ts" : "b.ts", index + 1));
  assert.equal(search_header({ ...query, path: "src" }, matches, true, "literal"), '200 matching lines for "chat" (literal, case-insensitive) in at least 2 files under src');
});

test("a search without matches names no file count", () => {
  assert.equal(search_header(query, [], false, "regex"), '0 matching lines for "chat" (regex, case-insensitive)');
});
