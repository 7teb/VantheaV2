import assert from "node:assert/strict";
import { test } from "node:test";
import { agent_items, done_value, run_script, type AgentItem } from "./workflow-sandbox-kit.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const caught = (outcome: Awaited<ReturnType<typeof run_script>>) => outcome.items.flatMap((item) => (item.kind === "caught" ? [item.text] : []));

test("parallel waits for every thunk, turns throws into null and accepts promises", async () => {
  const outcome = await run_script(
    `
return await parallel([
  () => agent('slow'),
  () => agent('fast'),
  () => { throw new Error('thunk broke') },
  agent('as a promise'),
  42,
  () => agent('rejected'),
])
`,
    undefined,
    {
      agent: async (item) => {
        if (item.prompt === "slow") {
          await sleep(80);
        }
        return item.prompt === "rejected" ? { ok: false, text: "no such model" } : { ok: true, value: item.prompt.toUpperCase() };
      },
    },
  );
  assert.deepEqual(done_value(outcome), ["SLOW", "FAST", null, "AS A PROMISE", null, null]);
  const lines = caught(outcome);
  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? "", /^parallel item 2: Error: thunk broke/);
  assert.match(lines[1] ?? "", /^parallel item 4: TypeError: it is not a function or a promise/);
  assert.match(lines[2] ?? "", /^parallel item 5: Error: no such model/);
  assert.deepEqual(agent_items(outcome).map((item) => item.prompt), ["as a promise", "slow", "fast", "rejected"]);
});

test("parallel of a non-array rejects", async () => {
  assert.equal(done_value(await run_script("try { await parallel('x') } catch (error) { return error.message }")), "parallel(thunks) takes an array of functions");
});

test("pipeline has no barrier between stages", async () => {
  const seen: string[] = [];
  const outcome = await run_script(
    "return await pipeline(['A', 'B'], (item) => agent('one:' + item), (prev, item) => agent('two:' + item + ' after ' + prev))",
    undefined,
    {
      agent: async (item) => {
        seen.push(item.prompt);
        if (item.prompt === "one:B") {
          for (let tries = 0; tries < 200 && !seen.some((prompt) => prompt.startsWith("two:A")); tries += 1) {
            await sleep(10);
          }
          seen.push("answered one:B");
        }
        return { ok: true, value: item.prompt };
      },
    },
  );
  assert.deepEqual(done_value(outcome), ["two:A after one:A", "two:B after one:B"]);
  assert.ok(seen.indexOf("two:A after one:A") < seen.indexOf("answered one:B"), seen.join(" | "));
});

test("pipeline stages get (prev, item, index) and a throwing stage drops its item", async () => {
  const outcome = await run_script(`
return await pipeline(
  [{ n: 1 }, { n: 2 }, { n: 3 }],
  (prev, item, index) => {
    if (item.n === 2) throw new Error('bad item')
    return agent('one ' + JSON.stringify({ same: prev === item, index }))
  },
  (prev, item, index) => agent('two ' + JSON.stringify({ prev, n: item.n, index })),
)
`);
  assert.deepEqual(done_value(outcome), [
    'result of two {"prev":"result of one {\\"same\\":true,\\"index\\":0}","n":1,"index":0}',
    null,
    'result of two {"prev":"result of one {\\"same\\":true,\\"index\\":2}","n":3,"index":2}',
  ]);
  assert.equal(agent_items(outcome).length, 4);
  assert.match(caught(outcome)[0] ?? "", /^pipeline item 1, stage 1: Error: bad item/);
});

test("phase groups later agents, opts.phase wins and log joins its values", async () => {
  const outcome = await run_script(`
phase('One')
await agent('a')
await agent('b', { phase: 'Two' })
phase('Three')
await agent('c')
log('done', { count: 3 }, 7)
return 'ok'
`);
  assert.deepEqual(agent_items(outcome).map((item) => [item.prompt, item.opts.phase]), [
    ["a", "One"],
    ["b", "Two"],
    ["c", "Three"],
  ]);
  assert.deepEqual(outcome.items.flatMap((item) => (item.kind === "phase" ? [item.title] : item.kind === "log" ? [`log:${item.text}`] : [])), ["One", "Three", 'log:done {"count":3} 7']);
});

test("a child workflow runs inline with its own args and groups, and cannot nest again", async () => {
  const child = [
    "export const meta = { name: 'child', description: 'the child' }",
    "phase('Inner')",
    "const r = await agent('inside')",
    "const top = await agent('top level of child', { phase: 'Own' })",
    "let nested = 'none'",
    "try { workflow('again') } catch (error) { nested = error.message }",
    "return { r, top, args, nested }",
  ].join("\n");
  const refs: unknown[] = [];
  const outcome = await run_script("const out = await workflow('child', { x: 1 })\nconst second = await workflow({ scriptPath: 'C:/x/child.js' })\nreturn { out, second: second.args === undefined }", undefined, {
    child: (item) => {
      refs.push(item.ref);
      return { source: child, name: "child" };
    },
  });
  assert.deepEqual(refs, [{ name: "child" }, { script_path: "C:/x/child.js" }]);
  const value = done_value(outcome) as { out: Record<string, unknown>; second: boolean };
  assert.deepEqual(value.out, {
    r: "result of inside",
    top: "result of top level of child",
    args: { x: 1 },
    nested: "workflow() cannot be called inside a child workflow: nesting is one level deep",
  });
  assert.equal(value.second, true);
  const phases = agent_items(outcome).map((item: AgentItem) => item.opts.phase);
  assert.deepEqual(phases.slice(0, 2), ["\u25b8 child: Inner", "\u25b8 child: Own"]);
  assert.ok(outcome.items.some((item) => item.kind === "phase" && item.title === "\u25b8 child: Inner"));
});

test("a failing or broken child rejects workflow() in the parent", async () => {
  const missing = await run_script("try { await workflow('nope') } catch (error) { return error.message }", undefined, { child: () => ({ error: "No saved workflow nope." }) });
  assert.equal(done_value(missing), "No saved workflow nope.");
  const broken = await run_script("try { await workflow('bad') } catch (error) { return error.message }", undefined, {
    child: () => ({ source: "export const meta = { name: 'bad', description: 'd' }\nconst x: string = 1", name: "bad" }),
  });
  assert.match(String(done_value(broken)), /^the child workflow bad does not compile: SyntaxError/);
  const thrown = await run_script("try { await workflow('t') } catch (error) { return error.message }", undefined, {
    child: () => ({ source: "export const meta = { name: 't', description: 'd' }\nthrow new Error('child failed')", name: "t" }),
  });
  assert.equal(done_value(thrown), "child failed");
});
