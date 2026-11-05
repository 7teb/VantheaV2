import assert from "node:assert/strict";
import { test } from "node:test";
import { split_pipelines_posix, split_statements_posix, statement_parts_posix } from "../electron/permissions/statements-posix.ts";

test("splits on every control operator and newline", () => {
  assert.deepEqual(split_statements_posix("a; b && c || d | e"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(split_statements_posix("a\nb\r\nc"), ["a", "b", "c"]);
  assert.deepEqual(split_statements_posix("x & y"), ["x", "y"]);
  assert.deepEqual(split_statements_posix("x |& y"), ["x", "y"]);
});

test("separators inside quoting stay inside one statement", () => {
  assert.deepEqual(split_statements_posix("echo 'a; b | c'"), ["echo 'a; b | c'"]);
  assert.deepEqual(split_statements_posix('echo "a && b"'), ['echo "a && b"']);
  assert.deepEqual(split_statements_posix("echo $'a;b'"), ["echo $'a;b'"]);
  assert.deepEqual(split_statements_posix("echo ${x:-a;b}"), ["echo ${x:-a;b}"]);
});

test("a backslash escapes the next character and continues a line", () => {
  assert.deepEqual(split_statements_posix("echo a\\; b"), ["echo a\\; b"]);
  assert.deepEqual(split_statements_posix("echo one \\\ntwo"), ["echo one \\\ntwo"]);
});

test("a separator inside a comment does not split the line", () => {
  const statements = split_statements_posix("ls # drop; rm\npwd");
  assert.equal(statements.length, 2);
  assert.ok(!statements.includes("rm"));
  assert.ok(statements.includes("pwd"));
});

test("recurses into command substitutions and process substitutions", () => {
  assert.ok(split_statements_posix("echo $(id)").includes("id"));
  assert.ok(split_statements_posix("echo `id`").includes("id"));
  assert.ok(split_statements_posix('echo "value $(id) tail"').includes("id"));
  assert.ok(split_statements_posix("diff <(sort a) <(sort b)").some((s) => s.includes("sort a")));
});

test("recurses into subshells and brace groups", () => {
  const sub = split_statements_posix("(one; two)");
  assert.ok(sub.includes("one") && sub.includes("two"));
  const group = split_statements_posix("{ one; two; }");
  assert.ok(group.includes("one") && group.includes("two"));
});

test("recurses into bash/sh -c and eval payloads", () => {
  assert.ok(split_statements_posix("bash -c 'inner cmd'").includes("inner cmd"));
  assert.ok(split_statements_posix("sh -lc 'inner cmd'").includes("inner cmd"));
  assert.ok(split_statements_posix("eval 'inner cmd'").includes("inner cmd"));
});

test("a here-doc body is data unless it feeds a shell", () => {
  const data = split_statements_posix("cat <<EOF\ninner line\nEOF\npwd");
  assert.ok(!data.includes("inner line"));
  assert.ok(data.includes("pwd"));
  const dashed = split_statements_posix("cat <<-END\n\tinner line\n\tEND\npwd");
  assert.ok(!dashed.includes("inner line") && dashed.includes("pwd"));
  const fed = split_statements_posix("bash <<EOF\ninner line\nEOF");
  assert.ok(fed.includes("inner line"));
});

test("pipelines keep their stages together while statements split them", () => {
  assert.deepEqual(split_pipelines_posix("a | b && c"), ["a | b", "c"]);
  assert.deepEqual(split_statements_posix("a | b && c"), ["a", "b", "c"]);
});

test("statement parts carry pipeline elements and the joining operator", () => {
  const parts = statement_parts_posix("a | b && c");
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0]?.elements.map((e) => e.text), ["a", "b"]);
  assert.equal(parts[0]?.joiner, "");
  assert.deepEqual(parts[1]?.elements.map((e) => e.text), ["c"]);
  assert.equal(parts[1]?.joiner, "&&");
});

test("empty and blank input yield no statements", () => {
  assert.deepEqual(split_statements_posix(""), []);
  assert.deepEqual(split_statements_posix("   \n  "), []);
});

test("a redirection ampersand is not a background separator", () => {
  assert.deepEqual(split_statements_posix("a 2>&1 | b"), ["a 2>&1", "b"]);
  assert.deepEqual(split_statements_posix("a >&2"), ["a >&2"]);
  assert.deepEqual(split_statements_posix("a &> log"), ["a &> log"]);
  const parts = statement_parts_posix("a 2>&1 | b");
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0]?.elements.map((e) => e.text), ["a 2>&1", "b"]);
});

test("statement parts keep offsets into the original text past a here-doc", () => {
  const text = "cat <<EOF\nbody\nEOF\nrm x | y";
  const parts = statement_parts_posix(text);
  assert.equal(parts[0]?.text, "cat <<EOF");
  const tail = parts.at(-1);
  assert.deepEqual(tail?.elements.map((e) => e.text), ["rm x", "y"]);
  assert.equal(tail?.text, "rm x | y");
  for (const element of tail?.elements ?? []) {
    assert.equal(text.slice(element.start, element.start + element.text.length), element.text);
  }
});
