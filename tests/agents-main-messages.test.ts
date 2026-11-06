import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import { reminder_interval } from "../electron/agents/session.ts";
import { message_main_agent_tool } from "../electron/tools/agents/message-main.ts";
import { register_active, unregister_active } from "../electron/turn/active.ts";
import type { TurnNote } from "../electron/turn/session.ts";
import type { Tool } from "../electron/tools/types.ts";
import { completed, events, model, reports, request, scripts, start_runner, stop_runner, tools, updates, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const probe: Tool = {
  spec: { name: "probe", description: "", parameters: { type: "object", properties: {} } },
  profiles: ["worker"],
  available: () => true,
  execute: async () => ({ status: "done", text: "probed", view: null }),
};

const probes = (count: number, first = 0) => Array.from({ length: count }, (_, index) => ({ index: first + index, id: `q${first + index}`, name: "probe", arguments: "{}" }));

const updates_of = (count: number) => Array.from({ length: count }, (_, index) => ({ index, id: `p${index}`, name: "message_main_agent", arguments: JSON.stringify({ text: `finding ${index}` }) }));

test("message_main_agent has no per-run limit: twelve updates in one round all reach an active main turn", async () => {
  tools.push(message_main_agent_tool);
  register_active("chat-chatty", "main-chatty", () => undefined, model, "high");
  let round = 0;
  let taken: TurnNote[] = [];
  let results: string[] = [];
  scripts.set("chatty", async (messages) => {
    round += 1;
    if (round === 1) {
      return completed({ tool_calls: updates_of(12), finish_reason: "tool_calls" });
    }
    taken = take_agent_notes("chat-chatty");
    unregister_active("chat-chatty", "main-chatty");
    results = messages.flatMap((message) => (message.role === "tool" ? [message.content] : []));
    return completed({ content: "final report" });
  });
  const started = deploy_agent(request("chatty", { chat_id: "chat-chatty" }));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.equal(updates.some((entry) => entry.run_id === started.run.run_id), false);
  assert.equal(taken.length, 12);
  assert.ok(taken.every((note) => note.kind === "notice" && note.notice === "agent_update"));
  assert.equal(taken[0]?.text, `Reviewer (${started.agent.agent_id}) sent an update while still running.\n\nUPDATE:\nfinding 0`);
  assert.equal(taken[11]?.text, `Reviewer (${started.agent.agent_id}) sent an update while still running.\n\nUPDATE:\nfinding 11`);
  assert.equal(results.length, 12);
  assert.ok(results.every((text) => text.startsWith("Sent to the main agent.")));
  tools.pop();
});

test("ten tool calls without an update bring one reminder, and an update resets the count", async () => {
  assert.equal(reminder_interval, 10);
  tools.push(probe, message_main_agent_tool);
  const reminded: boolean[] = [];
  let round = 0;
  scripts.set("quiet worker", async (messages) => {
    round += 1;
    const last = messages.at(-1);
    reminded.push(last?.role === "user" && typeof last.content === "string" && last.content.includes("since the main agent last heard from you"));
    if (round === 1) {
      return completed({ tool_calls: probes(reminder_interval - 1), finish_reason: "tool_calls" });
    }
    if (round === 2) {
      return completed({ tool_calls: probes(1), finish_reason: "tool_calls" });
    }
    if (round === 3) {
      const update = { index: 0, id: "u0", name: "message_main_agent", arguments: JSON.stringify({ text: "cache.cpp holds the bug" }) };
      return completed({ tool_calls: [update, ...probes(reminder_interval - 1, 1)], finish_reason: "tool_calls" });
    }
    return completed({ content: "done" });
  });
  const started = deploy_agent(request("quiet worker", { chat_id: "chat-quiet-worker" }));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.deepEqual(reminded, [false, false, true, false]);
  assert.equal(events.filter((event) => event.run_id === started.run.run_id && event.type === "notice" && event.notice === "update_reminder").length, 1);
  tools.splice(-2, 2);
});

test("after more than ten updates the reminder still comes every twenty-five silent calls, also after 250 calls", async () => {
  tools.push(probe, message_main_agent_tool);
  const silent_rounds = 10;
  let round = 0;
  scripts.set("long worker", async () => {
    round += 1;
    if (round === 1) {
      return completed({ tool_calls: updates_of(11), finish_reason: "tool_calls" });
    }
    if (round <= 1 + silent_rounds) {
      return completed({ tool_calls: probes(reminder_interval, round * 100), finish_reason: "tool_calls" });
    }
    return completed({ content: "done" });
  });
  const started = deploy_agent(request("long worker", { chat_id: "chat-long-worker" }));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const reminders = events.filter((event) => event.run_id === started.run.run_id && event.type === "notice" && event.notice === "update_reminder");
  assert.equal(reminders.length, silent_rounds);
  const last = reminders.at(-1);
  assert.equal(last?.type === "notice" ? last.round : -1, 1 + silent_rounds);
  assert.equal(updates.filter((entry) => entry.run_id === started.run.run_id).length, 11);
  tools.splice(-2, 2);
});
