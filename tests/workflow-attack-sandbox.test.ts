import assert from "node:assert/strict";
import { test } from "node:test";
import { read_script } from "../electron/workflows/meta.ts";
import { agent_items, done_value, run_script, type Reply } from "./workflow-sandbox-kit.ts";

const ecmascript_globals = new Set([
  "AggregateError", "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "DataView", "Date", "Error", "EvalError",
  "FinalizationRegistry", "Float16Array", "Float32Array", "Float64Array", "Function", "Infinity", "Int16Array", "Int32Array", "Int8Array",
  "InternalError", "Iterator", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect",
  "RegExp", "Set", "SharedArrayBuffer", "String", "Symbol", "SyntaxError", "TypeError", "URIError", "Uint16Array", "Uint32Array", "Uint8Array",
  "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "eval",
  "globalThis", "isFinite", "isNaN", "parseFloat", "parseInt", "undefined", "unescape",
]);

test("the global object of the sandbox holds only ECMAScript built-ins", async () => {
  const names = done_value(await run_script("return Object.getOwnPropertyNames(globalThis)")) as string[];
  assert.deepEqual(names.filter((name) => !ecmascript_globals.has(name)), []);
});

test("the constructor of every function kind reaches only the sandbox global", async () => {
  const outcome = await run_script(`
const kinds = [function () {}, async function () {}, function* () {}, async function* () {}, () => {}, agent, parallel, log, Date, Math.max]
const probes = kinds.map((fn) => {
  try {
    const make = Object.getPrototypeOf(fn).constructor
    const body = 'return [typeof process, typeof require, typeof __vx_host, typeof console, typeof globalThis.host]'
    const made = make(body)
    const out = made()
    return typeof out?.next === 'function' ? 'iterator' : typeof out?.then === 'function' ? 'promise' : out.join(',')
  } catch (error) {
    return 'threw ' + error.name
  }
})
const sync = Function('return [typeof process, typeof require, typeof __vx_host].join(",")')()
const generated = await (async function* () {}).constructor('yield [typeof process, typeof require].join(",")')().next()
return { probes, sync, generated: generated.value }
`);
  const value = done_value(outcome) as { probes: string[]; sync: string; generated: string };
  assert.ok(value.probes.every((probe) => probe === "undefined,undefined,undefined,undefined,undefined" || probe === "iterator" || probe === "promise"), JSON.stringify(value.probes));
  assert.equal(value.sync, "undefined,undefined,undefined");
  assert.equal(value.generated, "undefined,undefined");
});

test("polluting prototypes inside the sandbox leaves the host untouched", async () => {
  const outcome = await run_script(`
Object.prototype.polluted = 'yes'
Array.prototype.includes = () => true
Object.defineProperty(Object.prototype, 'then', { get() { return undefined }, configurable: true })
return JSON.parse('{"__proto__": {"injected": true}, "plain": 1}')
`);
  const value = done_value(outcome) as Record<string, unknown>;
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).injected, undefined);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(value.plain, 1);
});

test("cyclic and BigInt values fail inside the script while a 5 MB string crosses intact", async () => {
  const cyclic = await run_script("const s = { type: 'object', properties: {} }\ns.self = s\ntry { agent('cyclic', { schema: s }); return 'no throw' } catch (error) { return error.name }");
  assert.equal(done_value(cyclic), "TypeError");
  assert.equal(agent_items(cyclic).length, 0);
  const bigint = await run_script("return { n: 1n }");
  assert.equal(bigint.ended.kind, "failed");
  assert.match(bigint.ended.kind === "failed" ? bigint.ended.message : "", /cannot be converted to JSON/);
  const big = await run_script("return 'y'.repeat(5 * 1024 * 1024)");
  assert.equal((done_value(big) as string).length, 5 * 1024 * 1024);
});

test("a deeply nested value is a catchable error inside the script, not a broken sandbox", async () => {
  const outcome = await run_script("let a = []\nfor (let i = 0; i < 200000; i += 1) a = [a]\ntry { JSON.stringify(a); return 'serialized' } catch (error) { return 'caught ' + error.name }");
  assert.equal(outcome.ended.kind, "done", JSON.stringify(outcome.ended));
  assert.match(String(done_value(outcome)), /^(caught|serialized)/);
});

test("parallel never rejects, even when a thunk throws a value that cannot be described", async () => {
  const outcome = await run_script(`
class Odd extends Error { get name() { throw new Error('name getter') } }
const opaque = { toJSON() { throw new Error('no json') }, toString() { throw new Error('no string') } }
try {
  return ['resolved', await parallel([() => { throw new Odd('x') }, () => { throw opaque }, () => 'kept'])]
} catch (error) {
  return ['rejected', String(error.message)]
}
`);
  assert.deepEqual(done_value(outcome), ["resolved", [null, null, "kept"]]);
});

test("a pipeline stage that throws a value that cannot be described drops only its item", async () => {
  const outcome = await run_script(`
const opaque = { toJSON() { throw new Error('no json') }, toString() { throw new Error('no string') } }
try {
  return ['resolved', await pipeline([1, 2], (item) => { if (item === 1) throw opaque; return item * 10 })]
} catch (error) {
  return ['rejected', String(error.message)]
}
`);
  assert.deepEqual(done_value(outcome), ["resolved", [null, 20]]);
});

test("pipeline has no barrier: item A reaches stage 3 while item B still waits in stage 1", async () => {
  let release_b: (reply: Reply) => void = () => undefined;
  const b_waits = new Promise<Reply>((resolve) => {
    release_b = resolve;
  });
  const order: string[] = [];
  const outcome = await run_script(
    "return await pipeline(['A', 'B'], (item) => agent('s1 ' + item), (prev, item) => agent('s2 ' + item), (prev, item, index) => agent('s3 ' + item + ' ' + index + ' ' + prev))",
    undefined,
    {
      agent: (item) => {
        order.push(item.prompt);
        if (item.prompt === "s1 B") {
          return b_waits;
        }
        if (item.prompt.startsWith("s3 A")) {
          release_b({ ok: true, value: "s1 B done" });
        }
        return { ok: true, value: `${item.prompt.split(" ").slice(0, 2).join(" ")} done` };
      },
    },
  );
  assert.deepEqual(done_value(outcome), ["s3 A done", "s3 B done"]);
  assert.deepEqual(order, ["s1 A", "s1 B", "s2 A", "s3 A 0 s2 A done", "s2 B", "s3 B 1 s2 B done"]);
});

test("agents started inside parallel stages keep opts.phase, the others take the phase current at their call", async () => {
  const outcome = await run_script(`
phase('Scan')
await parallel([
  () => agent('a', { phase: 'Own' }),
  async () => { const first = await agent('b'); return agent('c ' + first) },
  () => { phase('Switched'); return agent('d') },
])
return 1
`);
  assert.deepEqual(agent_items(outcome).map((item) => [item.prompt, item.opts.phase]), [
    ["a", "Own"],
    ["b", "Scan"],
    ["d", "Switched"],
    ["c result of b", "Switched"],
  ]);
});

test("clock guards hold against subclassing, Reflect.construct, spread arguments and borrowed constructors", async () => {
  const outcome = await run_script(`
const attempt = (fn) => { try { fn(); return 'ran' } catch (error) { return 'threw' } }
return [
  attempt(() => { class Later extends Date {}; return new Later() }),
  attempt(() => Reflect.construct(Date, [])),
  attempt(() => new Date(...[])),
  attempt(() => new (Object.getPrototypeOf(new Date(0)).constructor)()),
  attempt(() => Object.getOwnPropertyDescriptor(Date.prototype, 'constructor').value()),
  attempt(() => Date.prototype.constructor.now()),
  attempt(() => Object.getPrototypeOf(Math).constructor.random?.() ?? Math.random()),
  [typeof performance, typeof crypto, typeof Intl].join(','),
  String(Date.UTC()),
  String(new Date(undefined).getTime()),
]
`);
  assert.deepEqual(done_value(outcome), ["threw", "threw", "threw", "threw", "threw", "threw", "threw", "undefined,undefined,undefined", "NaN", "NaN"]);
});

test("meta parsing rejects every non-literal form and keeps the body runnable", () => {
  for (const meta of ["{ name: NAME, description: 'b' }", "{ name: 'a', description: `b ${1}` }", "{ ...base, name: 'a', description: 'b' }", "{ name: 'a', description: 'b', phases: [,] }", "{ ['name']: 'a', description: 'b' }", "{ name: 'a', description: 'b', run() {} }", "{ name: 'a', description: 'b', n: 1 + 1 }", "{ name: 'a', name: 'b', description: 'c' }", "Object.freeze({ name: 'a', description: 'b' })"]) {
    assert.throws(() => read_script(`export const meta = ${meta}\nreturn 1`), /meta/, meta);
  }
  const read = read_script("// leading comment\n/* block */\nexport const meta = { name: 'a', description: 'b', }\nreturn 1");
  assert.equal(read.meta.name, "a");
  assert.match(read.body, /^\/\/ leading comment\n\/\* block \*\/\n {6} const meta = /);
});
