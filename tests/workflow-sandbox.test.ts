import assert from "node:assert/strict";
import { test } from "node:test";
import { read_script, wrap_body } from "../electron/workflows/meta.ts";
import { open_sandbox } from "../electron/workflows/sandbox.ts";
import { agent_items, done_value, meta_head, run_script } from "./workflow-sandbox-kit.ts";

test("script code reaches no Node, Electron or host object", async () => {
  const outcome = await run_script(`
const probe = (code) => { try { return String((0, eval)(code)) } catch (error) { return 'threw ' + error.name } }
const escape = (fn) => { try { return String(fn()) } catch (error) { return 'threw ' + error.name } }
return {
  globals: ['process', 'require', 'module', 'console', 'setTimeout', 'setImmediate', 'fetch', 'WebAssembly', 'Buffer', '__vx_host', 'std', 'os', 'performance'].map((name) => name + ':' + typeof globalThis[name]),
  ctor: escape(() => agent.constructor('return typeof process')()),
  async_ctor: escape(() => typeof (async () => {}).constructor),
  proto: escape(() => Object.getPrototypeOf(agent).constructor('return typeof require')()),
  eval_process: probe('typeof process'),
  this_value: escape(function () { return this === undefined }),
}
`);
  assert.deepEqual(done_value(outcome), {
    globals: ["process:undefined", "require:undefined", "module:undefined", "console:undefined", "setTimeout:undefined", "setImmediate:undefined", "fetch:undefined", "WebAssembly:undefined", "Buffer:undefined", "__vx_host:undefined", "std:undefined", "os:undefined", "performance:undefined"],
    ctor: "undefined",
    async_ctor: "function",
    proto: "undefined",
    eval_process: "undefined",
    this_value: "true",
  });
});

test("a dynamic import fails inside the sandbox", async () => {
  const outcome = await run_script("try { await import('node:fs'); return 'imported' } catch (error) { return 'blocked' }");
  assert.equal(done_value(outcome), "blocked");
});

test("clock and randomness throw, dates with arguments work", async () => {
  const outcome = await run_script(`
const attempt = (fn) => { try { fn(); return 'ran' } catch (error) { return error.message } }
return {
  now: attempt(() => Date.now()),
  random: attempt(() => Math.random()),
  bare: attempt(() => new Date()),
  call: attempt(() => Date()),
  via_ctor: attempt(() => new (new Date(0).constructor)()),
  fixed: new Date(0).toISOString(),
  utc: Date.UTC(2020, 0, 1),
  parse: Date.parse('2020-01-01T00:00:00Z'),
  instance: new Date(5) instanceof Date,
}
`);
  const value = done_value(outcome) as Record<string, unknown>;
  assert.match(String(value.now), /^Date\.now\(\) reads the clock/);
  assert.match(String(value.random), /^Math\.random\(\) makes the workflow non-deterministic/);
  assert.match(String(value.bare), /^new Date\(\) without arguments reads the clock/);
  assert.match(String(value.call), /^Date\(\) reads the clock/);
  assert.match(String(value.via_ctor), /without arguments reads the clock/);
  assert.equal(value.fixed, "1970-01-01T00:00:00.000Z");
  assert.equal(value.utc, 1577836800000);
  assert.equal(value.parse, 1577836800000);
  assert.equal(value.instance, true);
});

test("args arrive verbatim and undefined when none were passed", async () => {
  assert.deepEqual(done_value(await run_script("return { args }", { list: [1, "two", null], deep: { x: true } })), { args: { list: [1, "two", null], deep: { x: true } } });
  assert.deepEqual(done_value(await run_script("return typeof args")), "undefined");
  assert.deepEqual(done_value(await run_script("return args", "a string")), "a string");
});

test("calls of one synchronous slice cross as one batch and results come back as plain data", async () => {
  const outcome = await run_script(
    `
const a = agent('first', { label: 'A' })
const b = agent('second')
const c = agent('third', { phase: 'Own' })
return await Promise.all([a, b, c])
`,
    undefined,
    { agent: (item) => ({ ok: true, value: { prompt: item.prompt, nested: [item.id] } }) },
  );
  assert.deepEqual(done_value(outcome), [
    { prompt: "first", nested: [1] },
    { prompt: "second", nested: [2] },
    { prompt: "third", nested: [3] },
  ]);
  const agents = agent_items(outcome);
  assert.deepEqual(agents.map((item) => [item.id, item.prompt, item.opts]), [
    [1, "first", { label: "A", phase: null }],
    [2, "second", { phase: null }],
    [3, "third", { phase: "Own" }],
  ]);
});

test("a rejected host call throws at the await and the script can catch it", async () => {
  const outcome = await run_script("try { await agent('x', { role: 'nobody' }) } catch (error) { return error.message }", undefined, { agent: () => ({ ok: false, text: "Unknown role nobody" }) });
  assert.equal(done_value(outcome), "Unknown role nobody");
});

test("invalid agent arguments throw synchronously at the call", async () => {
  const outcome = await run_script(`
const attempt = (fn) => { try { fn(); return 'no throw' } catch (error) { return error.message } }
return [
  attempt(() => agent('')),
  attempt(() => agent(42)),
  attempt(() => agent('x', { lable: 'typo' })),
  attempt(() => agent('x', { isolation: 'container' })),
  attempt(() => agent('x', { label: 3 })),
  attempt(() => agent('x', { schema: 'object' })),
  attempt(() => agent('x', { role: 7 })),
  attempt(() => agent('x', [])),
  attempt(() => phase('')),
  attempt(() => workflow(5)),
]
`);
  assert.deepEqual(done_value(outcome), [
    "agent(prompt, opts): prompt must be a non-empty string",
    "agent(prompt, opts): prompt must be a non-empty string",
    "agent(): unknown option lable; the options are label, phase, schema, role, model, effort, isolation",
    "agent(): opts.isolation can only be 'worktree'",
    "agent(): opts.label must be a string",
    "agent(): opts.schema must be a JSON Schema object",
    "agent(): opts.role must be a role name or a role object",
    "agent(prompt, opts): opts must be an object",
    "phase(title): title must be a non-empty string",
    "workflow(ref, args): ref must be a saved workflow name or { script_path }",
  ]);
  assert.equal(agent_items(outcome).length, 0);
});

test("syntax errors fail the compile with a hint and runtime errors carry the script line", async () => {
  const compile = await run_script("const x: number = 1\nreturn x");
  assert.equal(compile.ended.kind, "compile");
  assert.match(compile.ended.kind === "compile" ? compile.ended.message : "", /^SyntaxError: .*\n[\s\S]*workflow\.js:2[\s\S]*no TypeScript annotations/);
  const runtime = await run_script("const a = 1\nconst b = null\nreturn b.field");
  assert.equal(runtime.ended.kind, "failed");
  assert.match(runtime.ended.kind === "failed" ? runtime.ended.message : "", /^TypeError: cannot read property 'field' of null\n.*workflow\.js:4/);
  assert.doesNotMatch(runtime.ended.kind === "failed" ? runtime.ended.message : "", /prelude\.js/);
});

test("a return value that is not JSON fails the workflow", async () => {
  const outcome = await run_script("return { big: 10n }");
  assert.equal(outcome.ended.kind, "failed");
  assert.match(outcome.ended.kind === "failed" ? outcome.ended.message : "", /return value cannot be converted to JSON/);
  assert.equal(done_value(await run_script("return undefined")), null);
});

test("a synchronous endless loop never posts calls and terminate stops it", async () => {
  const read = read_script(`${meta_head}phase('spin')\nwhile (true) { agent('never sent') }`);
  const batches: unknown[] = [];
  const sandbox = open_sandbox({ source: wrap_body(read.body), filename: "spin.js", args_text: "" }, { batch: (items) => batches.push(items), broken: () => undefined });
  assert.deepEqual(await sandbox.compiled, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const started = Date.now();
  await sandbox.terminate();
  assert.ok(Date.now() - started < 5000);
  assert.deepEqual(batches, []);
});
