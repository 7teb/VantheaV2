import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { StreamEventBody } from "../shared/events.ts";
import { live_run, waiting_approvals } from "../electron/agents/live.ts";
import { cancel_agent, continue_agent, deploy_agent, message_agent } from "../electron/agents/runner.ts";
import { agent_approval_key } from "../electron/agents/session.ts";
import { get_agent } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { resolve_decision } from "../electron/permissions/approvals.ts";
import type { Tool } from "../electron/tools/types.ts";
import { assert_tool_protocol, tool_contents } from "./concurrent-kit.ts";
import { completed, events, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const worker_tool = (name: string, execute: Tool["execute"]): Tool => ({
  spec: { name, description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  concurrent: true,
  available: () => true,
  execute,
});

const asks = (name: string) =>
  worker_tool(name, async (ctx) => {
    const decision = await ctx.approve({ kind: "memory", action: "remember", text: name });
    return decision.approved ? { status: "done", text: `${name} ran`, view: null } : { status: "denied", text: `${name} denied`, view: null };
  });

const hangs = (name: string) =>
  worker_tool(name, (ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));

const quick = (name: string, text: string) => worker_tool(name, async () => ({ status: "done", text, view: null }));

const run_event = (run_id: string, check: (event: StreamEventBody) => boolean) => () => events.some((event) => event.run_id === run_id && check(event));

const two_rounds = (prompt: string, names: string[], seen: ApiMessage[][]) => {
  let calls = 0;
  scripts.set(prompt, async (messages) => {
    calls += 1;
    if (calls === 1) {
      return completed({ tool_calls: names.map((name, index) => ({ index, id: `p${index}`, name, arguments: "{}" })), finish_reason: "tool_calls" });
    }
    seen.push(structuredClone(messages));
    return completed({ content: "Report: done." });
  });
};

const with_tools = async (added: Tool[], body: () => Promise<void>) => {
  tools.push(...added);
  try {
    await body();
  } finally {
    tools.splice(tools.length - added.length, added.length);
  }
};

test("an agent's denied approval in a batch answers both calls in tool_calls order and the run goes on", async () => {
  const seen: ApiMessage[][] = [];
  two_rounds("deny one", ["agent_asks", "agent_quick"], seen);
  await with_tools([asks("agent_asks"), quick("agent_quick", "quick result")], async () => {
    const started = deploy_agent(request("deny one"));
    const run_id = started.run.run_id;
    await wait_for(run_event(run_id, (event) => event.type === "tool_approval" && event.call_id === "c0_0"));
    await wait_for(run_event(run_id, (event) => event.type === "tool_end" && event.call_id === "c0_1"));
    assert.deepEqual(waiting_approvals("chat-runner").map((entry) => [entry.run_id, entry.call_id]), [[run_id, "c0_0"]]);
    assert.equal(resolve_decision(agent_approval_key(run_id), "c0_0", { approved: false, grant: "once", feedback: "" }), true);
    await wait_for(() => reports.some((report) => report.run_id === run_id));
    const next = seen[0];
    assert.ok(next);
    assert_tool_protocol(next);
    assert.deepEqual(tool_contents(next), ["agent_asks denied", "quick result"]);
    assert.deepEqual(waiting_approvals("chat-runner"), []);
    assert.equal(events.filter((event) => event.run_id === run_id && event.type === "end").length, 1);
  });
});

test("cancelling an agent while one call waits for approval and one still runs keeps a valid context for the next run", async () => {
  const seen: ApiMessage[][] = [];
  let first = 0;
  scripts.set("cancel mid batch", async (messages) => {
    first += 1;
    if (first > 1) {
      seen.push(structuredClone(messages));
      return completed({ content: "Report: continued." });
    }
    return completed({
      tool_calls: ["mid_asks", "mid_hangs", "mid_quick"].map((name, index) => ({ index, id: `p${index}`, name, arguments: "{}" })),
      finish_reason: "tool_calls",
    });
  });
  await with_tools([asks("mid_asks"), hangs("mid_hangs"), quick("mid_quick", "mid result")], async () => {
    const started = deploy_agent(request("cancel mid batch"));
    const run_id = started.run.run_id;
    await wait_for(run_event(run_id, (event) => event.type === "tool_approval" && event.call_id === "c0_0"));
    await wait_for(run_event(run_id, (event) => event.type === "tool_end" && event.call_id === "c0_2"));
    const agent = get_agent(started.agent.agent_id);
    assert.ok(agent);
    assert.equal(cancel_agent(agent), true);
    await wait_for(() => live_run(run_id) === null);
    assert.equal(first, 1);
    assert.deepEqual(waiting_approvals("chat-runner"), []);
    assert.equal(resolve_decision(agent_approval_key(run_id), "c0_0", { approved: true, grant: "once", feedback: "" }), false);
    const run_events = events.filter((event) => event.run_id === run_id);
    assert.equal(run_events.filter((event) => event.type === "end").length, 1);
    assert.equal(run_events.at(-1)?.type, "end");
    const next = await continue_agent(agent, request("go on after cancel"));
    await wait_for(() => reports.some((report) => report.run_id === next.run.run_id));
    const messages = seen[0];
    assert.ok(messages);
    assert_tool_protocol(messages);
    assert.deepEqual(tool_contents(messages), [
      "[not executed: the run stopped before this call ran]",
      "[not executed: the run stopped before this call ran]",
      "mid result",
    ]);
  });
});

test("a message to an agent that arrives during a batch reaches it after every tool message of that round", async () => {
  const seen: ApiMessage[][] = [];
  two_rounds("steer agent", ["steer_slow", "steer_fast"], seen);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await with_tools([worker_tool("steer_slow", async () => {
    await gate;
    return { status: "done", text: "slow result", view: null };
  }), quick("steer_fast", "fast result")], async () => {
    const started = deploy_agent(request("steer agent"));
    const run_id = started.run.run_id;
    await wait_for(run_event(run_id, (event) => event.type === "tool_end" && event.call_id === "c0_1"));
    const agent = get_agent(started.agent.agent_id);
    assert.ok(agent);
    assert.equal(message_agent(agent, "also check the parser"), true);
    release();
    await wait_for(() => reports.some((report) => report.run_id === run_id));
    const next = seen[0];
    assert.ok(next);
    assert_tool_protocol(next);
    const at = next.findIndex((message) => message.role === "assistant" && Boolean(message.tool_calls?.length));
    assert.deepEqual(next.slice(at + 1, at + 3).map((message) => message.role), ["tool", "tool"]);
    assert.deepEqual(tool_contents(next), ["slow result", "fast result"]);
    const steer_at = next.findIndex((message) => JSON.stringify(message).includes("also check the parser"));
    assert.ok(steer_at > at + 2);
  });
});
