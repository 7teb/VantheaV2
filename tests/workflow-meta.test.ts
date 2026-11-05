import assert from "node:assert/strict";
import { test } from "node:test";
import { LiteralError, line_column, parse_literal } from "../electron/workflows/literal.ts";
import { read_script, ScriptError, wrap_body } from "../electron/workflows/meta.ts";

const literal = (text: string) => parse_literal(text, 0).value;

test("pure literals parse to plain values", () => {
  assert.deepEqual(literal("{ a: 1, 'b': \"two\", c: [true, false, null], d: -2.5e3, e: 0x1f, f: 1_000, g: .5, }"), {
    a: 1,
    b: "two",
    c: [true, false, null],
    d: -2500,
    e: 31,
    f: 1000,
    g: 0.5,
  });
  assert.equal(literal("`multi\nline`"), "multi\nline");
  assert.equal(literal("'esc\\n\\t\\u0041\\x42\\u{1F600}'"), "esc\n\tAB\u{1F600}");
  assert.deepEqual(literal("[/* c */ 1, // line\n 2]"), [1, 2]);
  assert.deepEqual(literal("{ 1: 'x' }"), { "1": "x" });
});

test("every non-literal construct is rejected with its position", () => {
  const cases: [string, RegExp][] = [
    ["{ a: b }", /identifier b/],
    ["{ a: f(1) }", /call f\(\.\.\.\)/],
    ["{ ...x }", /spreads/],
    ["[...x]", /spreads/],
    ["{ [k]: 1 }", /computed keys/],
    ["{ a: `x${y}` }", /interpolation/],
    ["{ a }", /needs a ":"/],
    ["{ a() {} }", /methods/],
    ["[1,,2]", /holes/],
    ["{ a: 1, a: 2 }", /appears twice/],
    ["'open", /never closed/],
    ["{ a: Infinity }", /identifier Infinity/],
    ["{ a: 1 b: 2 }", /expected "," or "}"/],
    ["'\\1'", /octal/],
  ];
  for (const [text, pattern] of cases) {
    assert.throws(() => literal(text), (error: unknown) => error instanceof LiteralError && pattern.test(error.message), text);
  }
  assert.equal(line_column("a\nbc\nd", 4), "line 2, column 3");
});

test("meta is read without running the script and the body keeps its line numbers", () => {
  const source = [
    "// a leading comment",
    "export const meta = {",
    "  name: 'scan',",
    "  description: 'Scan things',",
    "  whenToUse: 'often',",
    "  phases: [{ title: 'Scan', detail: 'one per folder' }, { title: 'Fix', model: 'x/y' }],",
    "  roles: { skeptic: { profile: 'explore', instructions: 'refute', effort: 'high' } },",
    "}",
    "const x = 1",
    "return x",
  ].join("\r\n");
  const read = read_script(source);
  assert.deepEqual(read.meta, {
    name: "scan",
    description: "Scan things",
    when_to_use: "often",
    phases: [
      { title: "Scan", detail: "one per folder", model: "" },
      { title: "Fix", detail: "", model: "x/y" },
    ],
    roles: { skeptic: { profile: "explore", instructions: "refute", model: "", effort: "high", description: "" } },
  });
  const lines = read.body.split("\n");
  assert.equal(lines.length, 10);
  assert.equal(lines[1], "       const meta = {");
  assert.equal(lines[9], "return x");
  assert.equal(wrap_body(read.body).split("\n").length, 11);
  assert.match(wrap_body(read.body), /^\(async \(agent, parallel, pipeline, phase, log, args, workflow\) => \{ "use strict"; \/\/ a leading comment\n/);
});

test("meta problems are reported as script errors", () => {
  const cases: [string, RegExp][] = [
    ["const x = 1", /must start with export const meta/],
    ["export const meta = { name: 'a' }", /meta\.description must be a non-empty string/],
    ["export const meta = { description: 'd' }", /meta\.name must be a non-empty string/],
    ["export const meta = { name: 'a', description: 'line\\nbreak' }", /one line/],
    ["export const meta = { name: 'a', description: 'd', descripton: 'x' }", /unknown key descripton/],
    ["export const meta = { name: 'a', description: 'd', phases: { title: 'x' } }", /meta\.phases must be an array/],
    ["export const meta = { name: 'a', description: 'd', phases: [{ name: 'x' }] }", /meta\.phases\[0\] has unknown key name/],
    ["export const meta = { name: 'a', description: 'd', roles: { worker: { profile: 'explore' } } }", /cannot be redefined/],
    ["export const meta = { name: 'a', description: 'd', roles: { r: { profile: 'admin' } } }", /profile must be explore or worker/],
    ["export const meta = { name: 'a', description: 'd', roles: { 'bad name': {} } }", /role names use letters/],
    ["export const meta = { name: NAME, description: 'd' }", /line 1, column 29: meta must be a pure literal, found the identifier NAME/],
    ["/* open", /never closed/],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(() => read_script(source), (error: unknown) => error instanceof ScriptError && pattern.test(error.message), source);
  }
});
