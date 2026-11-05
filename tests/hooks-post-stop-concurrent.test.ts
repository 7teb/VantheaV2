import assert from "node:assert/strict";
import { test } from "node:test";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { completed, ends, harness, make_tool, model, tool_call, transcript } from "./turn-loop-harness.ts";

test("post-hook Stop preserves both completed concurrent siblings and ends only after their results", async () => {
  let executed = 0;
  let streams = 0;
  const tools = ["first", "second"].map((name) => ({ ...make_tool(name, async () => {
    executed += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return { status: "done" as const, text: `${name} executed`, view: { kind: "text" as const, text: name } };
  }), concurrent: true }));
  const h = harness(async () => { streams += 1; return completed({ tool_calls: [tool_call("first"), { ...tool_call("second"), index: 1, id: "p1" }] }); }, tools);
  h.session.hooks = {
    pre_tool: async () => ({ kind: "run", runs: [] }),
    post_tool: async () => { h.controller.abort(); return { kind: "aborted" }; },
    stop: async () => ({ kind: "end" }), stop_failure: async () => {},
  };
  await run_turn_loop(h.session, h.messages);
  assert.equal(executed, 2);
  assert.equal(streams, 1);
  assert.deepEqual(h.events.filter((event) => event.type === "tool_end").map((event) => event.result_text).sort(), ["first executed", "second executed"]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "stopped", error: null }]);
  assert.equal(h.events.at(-1)?.type, "end");
  const replay = await build_api_messages({ system: "s", summary: null, messages: [transcript(h.events)], model, agent_tools: false });
  assert.deepEqual(replay.filter((message) => message.role === "tool").map((message) => message.content).sort(), ["first executed", "second executed"]);
});
