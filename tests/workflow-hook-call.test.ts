import assert from "node:assert/strict";
import { test } from "node:test";
import { parse_hook_call, RefusedCall } from "../electron/workflows/hook-call.ts";

const json = (value: unknown) => JSON.stringify(value);

test("well-formed hook calls cross the sandbox boundary with exactly their fields", () => {
  assert.deepEqual(parse_hook_call("agent", json({ prompt: "scan", opts: { label: "a", phase: null, schema: { type: "object" }, role: { profile: "explore" }, model: "m", effort: "high", isolation: "worktree" } })), {
    kind: "agent",
    prompt: "scan",
    opts: { label: "a", phase: null, schema: { type: "object" }, role: { profile: "explore" }, model: "m", effort: "high", isolation: "worktree" },
  });
  assert.deepEqual(parse_hook_call("agent", json({ prompt: "scan", opts: { phase: "Scan", role: "judge" }, extra: 1 })), { kind: "agent", prompt: "scan", opts: { phase: "Scan", role: "judge" } });
  assert.deepEqual(parse_hook_call("workflow", json({ ref: { name: "child" }, args: [1], has_args: true })), { kind: "workflow", ref: { name: "child" }, args: [1], has_args: true });
  assert.deepEqual(parse_hook_call("workflow", json({ ref: { script_path: "a.js" }, has_args: false })), { kind: "workflow", ref: { script_path: "a.js" }, args: null, has_args: false });
  assert.deepEqual(parse_hook_call("phase", json({ title: "Scan" })), { kind: "phase", title: "Scan" });
  assert.deepEqual(parse_hook_call("log", json({ text: "" })), { kind: "log", text: "" });
  assert.deepEqual(parse_hook_call("caught", json({ where: "parallel", text: "x" })), { kind: "caught", where: "parallel", text: "x" });
  assert.deepEqual(parse_hook_call("done", json({ value_json: '{"a":[1,"b"]}' })), { kind: "done", value_json: '{"a":[1,"b"]}' });
  assert.deepEqual(parse_hook_call("failed", json({ message: "boom" })), { kind: "failed", message: "boom" });
});

test("malformed hook calls are refused with the field that is wrong", () => {
  const refused: [string, string, RegExp][] = [
    ["agent", json({ prompt: { forged: true }, opts: {} }), /prompt must be a string, the sandbox got object/],
    ["agent", json({ prompt: "  ", opts: {} }), /prompt must not be empty/],
    ["agent", json({ opts: {} }), /prompt must be a string, the sandbox got undefined/],
    ["agent", json({ prompt: "x", opts: [] }), /opts must be an object/],
    ["agent", json({ prompt: "x", opts: { label: 7 } }), /label must be a string, the sandbox got number/],
    ["agent", json({ prompt: "x", opts: { phase: 8 } }), /phase must be a string/],
    ["agent", json({ prompt: "x", opts: { model: null } }), /model must be a string, the sandbox got null/],
    ["agent", json({ prompt: "x", opts: { schema: "object" } }), /opts.schema must be a JSON Schema object/],
    ["agent", json({ prompt: "x", opts: { role: 3 } }), /opts.role must be a role name or a role object/],
    ["agent", json({ prompt: "x", opts: { isolation: "process" } }), /opts.isolation can only be 'worktree'/],
    ["agent", '{"prompt":"x","opts":{"__proto__":{"label":1}}}', /unknown option __proto__/],
    ["agent", json({ prompt: "x", opts: { timeout: 1 } }), /unknown option timeout/],
    ["workflow", json({ ref: { name: "a", script_path: "b" }, has_args: false }), /ref must be \{ name \} or \{ script_path \}/],
    ["workflow", json({ ref: { name: "" }, has_args: false }), /name must not be empty/],
    ["workflow", json({ ref: { name: "a" } }), /has_args must be a boolean/],
    ["phase", json({ title: ["forged"] }), /title must be a string, the sandbox got object/],
    ["phase", json({ title: " " }), /title must not be empty/],
    ["log", json({ text: { forged: true } }), /text must be a string/],
    ["caught", json({ text: "x" }), /where must be a string/],
    ["done", json({ value_json: 5 }), /value_json must be a string, the sandbox got number/],
    ["done", json({ value_json: "not json" }), /value_json is not valid JSON/],
    ["failed", json({ message: 1 }), /message must be a string/],
    ["teleport", json({}), /the sandbox has no teleport call/],
    ["log", "{ not json", /the log call is not valid JSON/],
    ["log", "[1]", /the log call must be an object/],
  ];
  for (const [kind, payload, expected] of refused) {
    assert.throws(() => parse_hook_call(kind, payload), (error: unknown) => error instanceof RefusedCall && expected.test(error.message), `${kind} ${payload}`);
  }
});
