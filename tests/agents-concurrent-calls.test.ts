import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { live_run } from "../electron/agents/live.ts";
import { cancel_agent, continue_agent, deploy_agent } from "../electron/agents/runner.ts";
import { get_agent } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { completed, events, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

test("a cancelled agent keeps its answered and unanswered calls of one batch in tool_calls order for the next run", async () => {
  const continued: ApiMessage[][] = [];
  let calls = 0;
  scripts.set("read both", async (messages) => {
    calls += 1;
    if (calls === 1) {
      return completed({
        tool_calls: [
          { index: 0, id: "p0", name: "slow_read", arguments: "{}" },
          { index: 1, id: "p1", name: "fast_read", arguments: "{}" },
        ],
        finish_reason: "tool_calls",
      });
    }
    continued.push(structuredClone(messages));
    return completed({ content: "Report: done." });
  });
  tools.push(
    {
      spec: { name: "slow_read", description: "", parameters: { type: "object", properties: {} } },
      profiles: ["worker"],
      concurrent: true,
      available: () => true,
      execute: (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    },
    {
      spec: { name: "fast_read", description: "", parameters: { type: "object", properties: {} } },
      profiles: ["worker"],
      concurrent: true,
      available: () => true,
      execute: async () => ({ status: "done", text: "fast result", view: null }),
    },
  );
  const started = deploy_agent(request("read both"));
  const run_id = started.run.run_id;
  await wait_for(() => events.some((event) => event.run_id === run_id && event.type === "tool_end" && event.call_id === "c0_1"));
  assert.equal(events.some((event) => event.run_id === run_id && event.type === "tool_end" && event.call_id === "c0_0"), false);
  const agent = get_agent(started.agent.agent_id);
  assert.ok(agent);
  assert.equal(cancel_agent(agent), true);
  await wait_for(() => live_run(run_id) === null);

  const next = await continue_agent(agent, request("go on"));
  await wait_for(() => reports.some((report) => report.run_id === next.run.run_id));
  const messages = continued[0];
  assert.ok(messages);
  const at = messages.findIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
  const assistant = messages[at];
  assert.ok(assistant?.role === "assistant" && assistant.tool_calls);
  const [slow, fast] = assistant.tool_calls;
  assert.deepEqual(messages.slice(at + 1, at + 3), [
    { role: "tool", tool_call_id: slow?.id, content: "[not executed: the run stopped before this call ran]" },
    { role: "tool", tool_call_id: fast?.id, content: "fast result" },
  ]);
});
