import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { RoundUsage } from "../electron/model/types.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { completed as agent_round, events as agent_events, reports, request, scripts, start_runner, stop_runner, wait_for } from "./agents-runner-harness.ts";
import { completed, ends, harness, make_tool, tool_call, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

before(start_runner);

after(stop_runner);

const first: RoundUsage = { prompt_tokens: 1200, completion_tokens: 80, reasoning_tokens: 30, cached_tokens: 1024, cache_write_tokens: 176 };

const second: RoundUsage = { prompt_tokens: 1400, completion_tokens: 40, reasoning_tokens: 0, cached_tokens: 1200, cache_write_tokens: 0 };

test("every round with provider usage emits one usage event before the end and the message sums them", async () => {
  let round = 0;
  const h = harness(async () => {
    round += 1;
    if (round === 1) {
      return completed({ tool_calls: [tool_call("look")], finish_reason: "tool_calls", usage: first });
    }
    if (round === 2) {
      return completed({ tool_calls: [tool_call("look")], finish_reason: "tool_calls" });
    }
    return completed({ content: "done", usage: second });
  }, [make_tool("look", async () => ({ status: "done", text: "seen", view: null }))]);
  await run_turn_loop(h.session, h.messages);
  const usage = h.events.filter((event) => event.type === "usage");
  assert.deepEqual(usage, [
    { type: "usage", round: 0, ...first },
    { type: "usage", round: 2, ...second },
  ]);
  assert.equal(ends(h.events).length, 1);
  assert.equal(h.events.at(-1)?.type, "end");
  assert.deepEqual(transcript(h.events).usage, { prompt_tokens: 2600, completion_tokens: 120, reasoning_tokens: 30, cached_tokens: 2224, cache_write_tokens: 176, rounds: 2 });
});

test("a round without usage emits no usage event", async () => {
  const h = harness(async () => completed({ content: "hello" }), []);
  await run_turn_loop(h.session, h.messages);
  assert.equal(h.events.some((event) => event.type === "usage"), false);
  assert.equal(transcript(h.events).usage, undefined);
});

test("a sub-agent round emits its usage on the agent's own events", async () => {
  scripts.set("count tokens", async () => agent_round({ content: "Report: counted.", usage: first }));
  const started = deploy_agent(request("count tokens"));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const own = agent_events.filter((event) => event.run_id === started.run.run_id);
  assert.deepEqual(
    own.flatMap((event) => (event.type === "usage" ? [{ round: event.round, prompt_tokens: event.prompt_tokens, completion_tokens: event.completion_tokens, reasoning_tokens: event.reasoning_tokens, cached_tokens: event.cached_tokens, cache_write_tokens: event.cache_write_tokens }] : [])),
    [{ round: 0, ...first }],
  );
  const end_at = own.findIndex((event) => event.type === "end");
  assert.ok(own.findIndex((event) => event.type === "usage") < end_at);
});
