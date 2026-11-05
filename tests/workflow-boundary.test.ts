import assert from "node:assert/strict";
import { test } from "node:test";
import { agent_items, done_value, run_script } from "./workflow-sandbox-kit.ts";

test("a call forged through overridden built-ins is refused at the boundary and throws a TypeError in the script", async () => {
  const outcome = await run_script(`
const outcome = {}
const real_join = Array.prototype.join
Array.prototype.join = function () { return { forged: true } }
try { log('a line') } catch (error) { outcome.log = [error.name, error.message] }
Array.prototype.join = real_join
const real_assign = Object.assign
Object.assign = () => ({ label: 7, phase: 8 })
try { agent('forged opts') } catch (error) { outcome.agent = [error.name, error.message] }
Object.assign = real_assign
log('after')
outcome.real = await agent('real call', { label: 'kept' })
return outcome
`);
  const value = done_value(outcome) as { log: [string, string]; agent: [string, string]; real: string };
  assert.equal(value.log[0], "TypeError");
  assert.match(value.log[1], /^the sandbox refused this call: log\(\): text must be a string, the sandbox got object$/);
  assert.equal(value.agent[0], "TypeError");
  assert.match(value.agent[1], /^the sandbox refused this call: agent\(\) opts: label must be a string, the sandbox got number$/);
  assert.equal(value.real, "result of real call");
  assert.deepEqual(outcome.items.filter((item) => item.kind === "log"), [{ kind: "log", text: "after" }]);
  assert.deepEqual(agent_items(outcome).map((item) => [item.prompt, item.opts.label]), [["real call", "kept"]]);
});

test("overriding JSON.stringify or Object.prototype.toJSON changes neither the return value nor the caught reports", async () => {
  const outcome = await run_script(`
JSON.stringify = () => { throw new Error('sabotaged stringify') }
Object.defineProperty(Object.prototype, 'toJSON', { value: function () { throw new Error('sabotaged toJSON') }, configurable: true, writable: true })
const out = await parallel([() => { throw new Error('thunk failed') }, () => 'kept'])
const piped = await pipeline([1, 2], (item) => { if (item === 1) throw new Error('stage failed'); return item })
delete Object.prototype.toJSON
return [out, piped, 'end']
`);
  assert.deepEqual(done_value(outcome), [[null, "kept"], [null, 2], "end"]);
  const caught = outcome.items.filter((item) => item.kind === "caught");
  assert.equal(caught.length, 2);
  assert.match(caught[0]?.kind === "caught" ? caught[0].text : "", /^parallel item 0: Error: thunk failed/);
  assert.match(caught[1]?.kind === "caught" ? caught[1].text : "", /^pipeline item 0, stage 1: Error: stage failed/);
});

test("a return value whose toJSON throws fails the run with the reason instead of leaving it running", async () => {
  const outcome = await run_script("return { toJSON() { throw new Error('no json for you') } }");
  assert.equal(outcome.ended.kind, "failed");
  assert.match(outcome.ended.kind === "failed" ? outcome.ended.message : "", /^the return value cannot be converted to JSON: Error: no json for you/);
});

test("a thrown value that cannot be described still reaches the host as a failed run", async () => {
  const outcome = await run_script("await Promise.resolve()\nthrow { toJSON() { throw 1 }, toString() { throw 2 } }");
  assert.equal(outcome.ended.kind, "failed");
  assert.equal(outcome.ended.kind === "failed" ? outcome.ended.message : "", "thrown value (a value that converts neither to JSON nor to a string)");
});
