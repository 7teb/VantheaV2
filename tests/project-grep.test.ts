import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { grep_project, grep_target, type GrepQuery } from "../electron/project/grep.ts";

let root = "";

const put = (relative: string, content: string | Buffer) => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

const run = async (query: Partial<GrepQuery> & { query: string }) =>
  grep_project(await grep_target(root, query.path ?? ""), { path: "", regex: false, case_sensitive: false, ...query }, new AbortController().signal);

const lines = (count: number, text: (index: number) => string) => [...Array(count).keys()].map(text).join("\n");

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vx-grep-"));
  put("src/features/a.cpp", ['#include "core.hpp"', "class GameManager {", "static auto get_instance -> game_manager*", "GameManager::get_instance;", "}"].join("\n"));
  put("src/other/b.cpp", ["auto x = gamemanager_ref;", "int y = 0;"].join("\n"));
  put("lib/c.txt", ["foo.bar value", "fooXbar value", "a+b = c", "Controller::Get() called", "open ( paren"].join("\n"));
  put("cap/exact.txt", lines(200, (index) => `caphit ${index}`));
  put("cap/over.txt", lines(201, (index) => `caphit ${index}`));
  const big = [...Array(22000).keys()].map((index) => `filler line ${index} ${"x".repeat(90)}`);
  big[4] = "has streamneedle marker";
  big[11110] = "has streamneedle marker";
  big[21998] = "has streamneedle marker";
  put("cap/streambig.txt", big.join("\n"));
  put("long/longline.txt", `${"y".repeat(400)} longmark ${"y".repeat(400)}`);
  put("notes.log", "loghit here");
  put("bin/skipped.txt", "loghit in an ignored folder");
  put("data.bin", Buffer.concat([Buffer.from("loghit"), Buffer.from([0, 1, 2])]));
  put(".env", "loghit secret");
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("default search is a literal, case-insensitive substring match", async () => {
  const result = await run({ query: "GameManager" });
  assert.equal(result.matches.length, 3);
  assert.equal(result.mode, "literal");
  assert.equal(result.capped, false);
  assert.ok(result.matches.every((match) => !path.isAbsolute(match.path) && !match.path.includes("\\")));
  assert.equal((await run({ query: "gamemanager" })).matches.length, 3);
});

test("case_sensitive excludes other casings", async () => {
  const result = await run({ query: "GameManager", case_sensitive: true });
  assert.equal(result.matches.length, 2);
  assert.ok(result.matches.every((match) => match.path === "src/features/a.cpp"));
});

test("literal queries keep regex characters literal", async () => {
  assert.deepEqual((await run({ query: "foo.bar" })).matches.map((match) => match.line), [1]);
  assert.deepEqual((await run({ query: "a+b", path: "lib/c.txt" })).matches.map((match) => match.line), [3]);
  assert.equal((await run({ query: "Controller::Get()" })).matches.length, 1);
});

test("regex queries use ripgrep syntax and fall back to literal when invalid", async () => {
  const dot = await run({ query: "foo.bar", regex: true });
  assert.equal(dot.matches.length, 2);
  assert.equal(dot.mode, "regex");
  const plus = await run({ query: "a+b", regex: true, path: "lib/c.txt" });
  assert.equal(plus.matches.length, 0);
  assert.equal(plus.regex_error, null);
  const invalid = await run({ query: "(", regex: true, path: "lib/" });
  assert.equal(invalid.mode, "literal");
  assert.notEqual(invalid.regex_error, null);
  assert.equal(invalid.matches.length, 2);
  const words = await run({ query: "\\b(?:game_?manager|get_?instance)\\b", regex: true });
  assert.equal(words.matches.length, 3);
  const definition = await run({ query: "\\bauto\\s+get_instance\\b", regex: true, case_sensitive: true, path: "src/" });
  assert.deepEqual(definition.matches.map((match) => match.line), [3]);
});

test("path restricts the search to a folder or a file", async () => {
  const folder = await run({ query: "GameManager", path: "src/features/" });
  assert.deepEqual(folder.matches.map((match) => match.line), [2, 4]);
  const file = await run({ query: "gamemanager", path: "src/other/b.cpp" });
  assert.deepEqual(file.matches.map((match) => match.path), ["src/other/b.cpp"]);
  await assert.rejects(run({ query: "x", path: "../" }), /outside the project/);
  assert.deepEqual((await run({ query: "loghit", path: ".env" })).matches.map((match) => match.path), [".env"]);
});

test("results cap at 200 lines and say so", async () => {
  const exact = await run({ query: "caphit", path: "cap/exact.txt" });
  assert.deepEqual([exact.matches.length, exact.capped], [200, false]);
  const over = await run({ query: "caphit", path: "cap/over.txt" });
  assert.deepEqual([over.matches.length, over.capped], [200, true]);
  const project = await run({ query: "caphit" });
  assert.deepEqual([project.matches.length, project.capped], [200, true]);
});

test("large files are streamed and long lines are bounded", async () => {
  const streamed = await run({ query: "streamneedle", path: "cap/streambig.txt" });
  assert.deepEqual(streamed.matches.map((match) => match.line), [5, 11111, 21999]);
  const long = await run({ query: "longmark" });
  assert.equal(long.matches.length, 1);
  assert.ok((long.matches[0]?.text.length ?? 0) <= 300);
});

test("the walk covers every text file but skips binaries, ignored folders and secrets", async () => {
  const result = await run({ query: "loghit" });
  assert.deepEqual(result.matches.map((match) => match.path), ["notes.log"]);
  assert.equal((await run({ query: "loghit", path: "notes.log" })).matches.length, 1);
});

test("a blank query returns an empty result", async () => {
  const result = await run({ query: "   " });
  assert.deepEqual([result.matches.length, result.capped], [0, false]);
});

test("files listed in .gitignore are skipped", async () => {
  put("ignored/.gitignore", "secret-out/\n");
  put("ignored/secret-out/note.txt", "gitignoredhit");
  put("ignored/kept.txt", "gitignoredhit");
  const result = await run({ query: "gitignoredhit" });
  assert.deepEqual(result.matches.map((match) => match.path), ["ignored/kept.txt"]);
});

test("a file ripgrep fails to search makes the result incomplete instead of complete", async () => {
  put("pcre/a.txt", `limithit one\n${"a".repeat(60000)}\nlimithit two\n`);
  put("pcre/b.txt", "limithit three\n");
  const result = await run({ query: "(a|aa)+(?=b)|limithit", regex: true, path: "pcre/" });
  assert.equal(result.mode, "regex");
  assert.deepEqual(result.matches.map((match) => match.path), ["pcre/b.txt"]);
  assert.match(result.incomplete ?? "", /match limit exceeded/);
  assert.ok(!(result.incomplete ?? "").includes(fs.realpathSync(root)));
  assert.equal((await run({ query: "limithit", path: "pcre/" })).incomplete, null);
});

const reported = async (query: Partial<GrepQuery> & { query: string }, signal = new AbortController().signal, on_report?: (count: number) => void) => {
  const reports: number[] = [];
  const result = await grep_project(await grep_target(root, query.path ?? ""), { path: "", regex: false, case_sensitive: false, ...query }, signal, (count) => {
    reports.push(count);
    on_report?.(count);
  });
  return { reports, result };
};

test("progress reports the growing match count and does not change the result", async () => {
  const { reports, result } = await reported({ query: "GameManager" });
  assert.deepEqual(reports, [1, 2, 3]);
  assert.deepEqual(result, await run({ query: "GameManager" }));
});

test("a capped search stops reporting after the cap", async () => {
  const { reports, result } = await reported({ query: "caphit" });
  assert.equal(result.capped, true);
  assert.equal(reports.at(-1), 201);
});

test("an abort during the search throws", async () => {
  const controller = new AbortController();
  await assert.rejects(
    reported({ query: "caphit" }, controller.signal, (count) => {
      if (count === 1) {
        controller.abort(new Error("stop"));
      }
    }),
  );
});

const utf16 = (text: string, big_endian = false, bom = false): Buffer => {
  const body = Buffer.from(text, "utf16le");
  if (big_endian) {
    body.swap16();
  }
  return bom ? Buffer.concat([Buffer.from(big_endian ? [254, 255] : [255, 254]), body]) : body;
};

test("UTF-16 without BOM is searched in both byte orders with correct line numbers", async () => {
  put("encoding/le.txt", utf16("first\r\nEncodingNeedle value\r\nlast\r\n"));
  put("encoding/be.txt", utf16("first\nEncodingNeedle value\nlast\n", true));
  for (const file of ["encoding/le.txt", "encoding/be.txt"]) {
    const result = await run({ query: "encodingneedle", path: file });
    assert.deepEqual(result.matches, [{ path: file, line: 2, text: "EncodingNeedle value" }]);
    assert.equal(result.incomplete, null);
  }
  const directory = await run({ query: "EncodingNeedle", path: "encoding" });
  assert.deepEqual(directory.matches.map(match => [match.path, match.line]), [["encoding/be.txt", 2], ["encoding/le.txt", 2]]);
});

test("encoding searches preserve native regex, case sensitivity and invalid-pattern fallback", async () => {
  put("encoding/regex.txt", utf16("foo.bar\nfooXbar\nController::Get()\n"));
  assert.deepEqual((await run({ query: "foo.bar", path: "encoding/regex.txt" })).matches.map(m => m.line), [1]);
  assert.deepEqual((await run({ query: "foo.bar", path: "encoding/regex.txt", regex: true })).matches.map(m => m.line), [1, 2]);
  assert.equal((await run({ query: "FOO", path: "encoding/regex.txt", case_sensitive: true })).matches.length, 0);
  assert.deepEqual((await run({ query: "foo(?=X)", path: "encoding/regex.txt", regex: true })).matches.map(m => m.line), [2]);
  const invalid = await run({ query: "(", path: "encoding/regex.txt", regex: true });
  assert.equal(invalid.mode, "literal");
  assert.notEqual(invalid.regex_error, null);
  assert.deepEqual(invalid.matches.map(m => m.line), [3]);
});

test("mixed UTF-8 and UTF-16 files have one result per matching line", async () => {
  put("mixed/normal.txt", "MixedNeedle\n");
  put("mixed/le.txt", utf16("MixedNeedle\n"));
  put("mixed/be.txt", utf16("MixedNeedle\n", true));
  put("mixed/bom-le.txt", utf16("MixedNeedle\n", false, true));
  put("mixed/bom-be.txt", utf16("MixedNeedle\n", true, true));
  const result = await run({ query: "MixedNeedle", path: "mixed" });
  assert.deepEqual(result.matches.map(m => m.path), ["mixed/be.txt", "mixed/bom-be.txt", "mixed/bom-le.txt", "mixed/le.txt", "mixed/normal.txt"]);
  assert.ok(result.matches.every(m => m.line === 1 && m.text === "MixedNeedle"));
  assert.equal(result.incomplete, null);
});

test("encoding discovery respects ignore rules, secret paths and binary files", async () => {
  put("utf-protected/.gitignore", "ignored/\n");
  put("utf-protected/ignored/a.txt", utf16("ProtectedNeedle\n"));
  put("utf-protected/node_modules/a.txt", utf16("ProtectedNeedle\n"));
  put("utf-protected/.env", utf16("ProtectedNeedle\n"));
  put("utf-protected/.ssh/a.txt", utf16("ProtectedNeedle\n"));
  put("utf-protected/data.bin", Buffer.from([0, 1, 2, 3, 4, 5, 0]));
  put("utf-protected/kept.txt", utf16("ProtectedNeedle\n"));
  const result = await run({ query: "ProtectedNeedle", path: "utf-protected" });
  assert.deepEqual(result.matches.map(m => m.path), ["utf-protected/kept.txt"]);
  assert.equal(result.incomplete, null);
});

test("UTF-16 result caps and aborts behave like normal searches", async () => {
  put("utf-cap/le.txt", utf16(lines(201, i => `widecaphit ${i}`)));
  const capped = await run({ query: "widecaphit", path: "utf-cap/le.txt" });
  assert.equal(capped.matches.length, 200);
  assert.equal(capped.capped, true);
  const controller = new AbortController();
  await assert.rejects(reported({ query: "widecaphit", path: "utf-cap/le.txt" }, controller.signal, () => controller.abort(new Error("wide stop"))), /wide stop/);
});

test("a search over the cap is marked capped and one that ends exactly at the cap is not", async () => {
  const capped = await run({ query: "caphit", path: "cap/over.txt" });
  assert.equal(capped.capped, true);
  const complete = await run({ query: "caphit", path: "cap/exact.txt" });
  assert.equal(complete.capped, false);
});

test("raw UTF-16 matches do not duplicate decoded lines or consume the result cap", async () => {
  put("utf-raw/le.txt", utf16(lines(220, i => `wide-${i}`)));
  const result = await run({ query: "w", path: "utf-raw" });
  assert.equal(result.capped, true);
  assert.equal(result.matches.length, 200);
  assert.deepEqual(result.matches.map(m => m.line), [...Array(200).keys()].map(i => i + 1));
  assert.ok(result.matches.every(m => m.text.startsWith("wide-") && !m.text.includes("\0")));
  const literal = await run({ query: "w", path: "utf-raw/le.txt" });
  assert.deepEqual(literal.matches, result.matches);
});

test("UTF-16 batches preserve long Unicode filenames and their complete result set", async () => {
  const files = Array.from({ length: 150 }, (_, i) => `utf-batch/wide [${i}] ü-${"x".repeat(80)}.txt`);
  for (const file of files) {
    put(file, utf16("BatchNeedle\n"));
  }
  const result = await run({ query: "BatchNeedle", path: "utf-batch" });
  assert.equal(result.capped, false);
  assert.equal(result.incomplete, null);
  assert.deepEqual(result.matches.map(m => m.path), [...files].sort());
  assert.ok(result.matches.every(m => m.text === "BatchNeedle" && m.line === 1));
});

test("combined UTF-8 and UTF-16 searches share one global cap", async () => {
  put("utf-combined/normal.txt", lines(200, i => `CombinedNeedle ${i}`));
  put("utf-combined/wide.txt", utf16(lines(10, i => `CombinedNeedle wide ${i}`)));
  const { result, reports } = await reported({ query: "CombinedNeedle", path: "utf-combined" });
  assert.equal(result.matches.length, 200);
  assert.equal(result.capped, true);
  assert.equal(reports.at(-1), 201);
  assert.ok(reports.every(count => count <= 201));
});

test("a secret file or folder named as the search path is searched, a folder-wide search still skips secret content", async () => {
  put("secret-target/.env", "TargetedSecretNeedle=1\n");
  put("secret-target/.ssh/known.txt", "TargetedSecretNeedle in ssh\n");
  put("secret-target/plain.txt", "TargetedSecretNeedle plain\n");
  put("secret-target/wide/.env.local", utf16("TargetedSecretNeedle wide\n"));
  assert.deepEqual((await run({ query: "TargetedSecretNeedle", path: "secret-target" })).matches.map(m => m.path), ["secret-target/plain.txt"]);
  assert.deepEqual((await run({ query: "TargetedSecretNeedle", path: "secret-target/.env" })).matches.map(m => [m.path, m.text]), [["secret-target/.env", "TargetedSecretNeedle=1"]]);
  assert.deepEqual((await run({ query: "TargetedSecretNeedle", path: "secret-target/.ssh" })).matches.map(m => m.path), ["secret-target/.ssh/known.txt"]);
  assert.deepEqual((await run({ query: "TargetedSecretNeedle", path: "secret-target/wide/.env.local" })).matches.map(m => [m.path, m.text]), [["secret-target/wide/.env.local", "TargetedSecretNeedle wide"]]);
  assert.deepEqual((await run({ query: "TargetedSecretNeedle", path: "secret-target/wide" })).matches, []);
});
