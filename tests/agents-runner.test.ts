import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { live_run, read_agent_run, waiting_approvals } from "../electron/agents/live.ts";
import { cancel_agent, deploy_agent, find_agent_model, max_running_agents, message_agent } from "../electron/agents/runner.ts";
import { flex_id } from "../shared/models.ts";
import { agent_approval_key } from "../electron/agents/session.ts";
import { get_agent_status_tool } from "../electron/tools/agents/manage.ts";
import { get_agent, init_agent_store, list_agents, save_index_sync } from "../electron/agents/store.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import { resolve_decision } from "../electron/permissions/approvals.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { block_until_abort, completed, events, flex_model, project, reports, request, root, scripts, settings, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

before(start_runner);

after(stop_runner);

test("a run ends completed, reports its last text and survives a reload from disk", async () => {
  scripts.set("summarize", async () => completed({ content: "Report: nothing is broken." }));
  const started = deploy_agent(request("summarize"));
  assert.equal(started.run.status, "running");
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const report = reports.find((entry) => entry.run_id === started.run.run_id);
  assert.equal(report?.status, "completed");
  assert.ok(report?.report_path);
  assert.equal(await fs.readFile(report.report_path, "utf8"), "Report: nothing is broken.");
  assert.equal(events.filter((event) => event.run_id === started.run.run_id && event.type === "end").length, 1);

  const agent_dir = path.join(root, "agents", started.agent.agent_id);
  const lines = (await fs.readFile(path.join(agent_dir, `${started.run.run_id}.jsonl`), "utf8")).trim().split("\n");
  assert.ok(lines.length >= 2);
  const context = JSON.parse(await fs.readFile(path.join(agent_dir, "context.json"), "utf8")) as ApiMessage[];
  assert.deepEqual(
    context.map((message) => message.role),
    ["user", "user", "assistant"],
  );
  assert.match(String(context[1]?.content), /Agents in this chat at \d\d:\d\d\. The main agent leads the work/);

  await init_agent_store(path.join(root, "agents"));
  const agent = get_agent(started.agent.agent_id);
  const run = agent?.runs.find((entry) => entry.run_id === started.run.run_id);
  assert.ok(agent && run);
  assert.equal(run.status, "completed");
  const loaded = await read_agent_run(agent, run);
  const text_step = loaded.steps.find((step) => step.kind === "text");
  assert.equal(text_step?.kind === "text" ? text_step.text : "", "Report: nothing is broken.");
  assert.equal(loaded.report, "Report: nothing is broken.");
  assert.equal(loaded.last_seq, Number(JSON.parse(lines.at(-1) ?? "{}").seq));
});

test("an agent deployed on Flex keeps the Flex route when it is continued", async () => {
  scripts.set("flex once", async () => completed({ content: "done" }));
  const id = flex_id(flex_model.id);
  const started = deploy_agent(request("flex once", { model: await find_agent_model(id), model_id: id }));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.equal(get_agent(started.agent.agent_id)?.model, id);
  assert.deepEqual((await find_agent_model(started.agent.model)).provider_order, ["test/flex"]);
  const plain = deploy_agent(request("flex once", { model: flex_model }));
  assert.equal(plain.agent.model, flex_model.id);
  assert.deepEqual((await find_agent_model(plain.agent.model)).provider_order, ["test/default"]);
  await wait_for(() => reports.some((report) => report.run_id === plain.run.run_id));
});

test("cancel stops a running agent, keeps it cancelled and delivers no report", async () => {
  scripts.set("long job", block_until_abort);
  const started = deploy_agent(request("long job"));
  await wait_for(() => events.some((event) => event.run_id === started.run.run_id) || live_run(started.run.run_id) !== null);
  const agent = get_agent(started.agent.agent_id);
  assert.ok(agent);
  assert.equal(cancel_agent(agent), true);
  await wait_for(() => live_run(started.run.run_id) === null);
  assert.equal(list_agents("chat-runner").find((entry) => entry.agent_id === agent.agent_id)?.runs.at(-1)?.status, "cancelled");
  assert.equal(reports.some((report) => report.run_id === started.run.run_id), false);
  assert.equal(cancel_agent(agent), false);
});

test("an approval inside a run is keyed by agent:<run_id> and the tool context points at the parent turn", async () => {
  let seen: ToolContext | null = null;
  tools.push({
    spec: { name: "needs_ok", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async (ctx) => {
      seen = ctx;
      const decision = await ctx.approve({ kind: "memory", action: "remember", text: "x" });
      return { status: decision.approved ? "done" : "denied", text: decision.approved ? "ok" : "no", view: null };
    },
  });
  let round = 0;
  scripts.set("ask first", async () => {
    round += 1;
    return round === 1 ? completed({ tool_calls: [{ index: 0, id: "p0", name: "needs_ok", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "approved and done" });
  });
  const started = deploy_agent(request("ask first"));
  await wait_for(() => events.some((event) => event.run_id === started.run.run_id && event.type === "tool_approval"));
  const approval = events.find((event) => event.run_id === started.run.run_id && event.type === "tool_approval");
  const call_id = approval?.type === "tool_approval" ? approval.call_id : "";
  const decision = { approved: true, grant: "once", feedback: "" } as const;
  const waiting = waiting_approvals("chat-runner");
  assert.deepEqual(
    waiting.map((entry) => [entry.agent_id, entry.run_id, entry.call_id, entry.name, entry.request.kind]),
    [[started.agent.agent_id, started.run.run_id, call_id, started.agent.name, "memory"]],
  );
  assert.deepEqual(waiting_approvals("another-chat"), []);
  assert.equal(resolve_decision("chat-runner", call_id, { ...decision }), false);
  assert.equal(resolve_decision(agent_approval_key(started.run.run_id), call_id, { ...decision }), true);
  await wait_for(() => waiting_approvals("chat-runner").length === 0);
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.equal(await fs.readFile(reports.find((report) => report.run_id === started.run.run_id)?.report_path ?? "", "utf8"), "approved and done");
  const ctx = seen as ToolContext | null;
  assert.equal(ctx?.chat_id, "chat-runner");
  assert.equal(ctx?.turn_id, "parent-msg");
  assert.equal(ctx?.profile, "worker");
  assert.equal(ctx?.user_request, "the user's request");
  const own = (await ctx?.human_decisions?.()) ?? [];
  assert.ok(own.some((entry) => entry.tool === "memory_remember" && entry.approved && entry.actor !== "main"));
  tools.pop();
});

test("a sub-agent records its reviews as itself on agent events", async () => {
  tools.push({
    spec: { name: "records_review", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async (ctx) => {
      await ctx.review.record({ id: "rv-1", at: 1, actor: ctx.review.actor, tool: "run_command", subject: "npm test", cwd: project, verdict: "allow", source: "model", reason: "tests", rule_source: "none", rule: "", last_human_id: null });
      return { status: "done", text: "ok", view: null };
    },
  });
  let round = 0;
  scripts.set("review once", async () => {
    round += 1;
    return round === 1 ? completed({ tool_calls: [{ index: 0, id: "p0", name: "records_review", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "done" });
  });
  const started = deploy_agent(request("review once"));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const event = events.find((entry) => entry.run_id === started.run.run_id && entry.type === "tool_review");
  assert.equal(event?.type === "tool_review" ? event.review.actor.id : "", started.agent.agent_id);
  assert.equal(event?.type === "tool_review" ? event.review.actor.kind : "", "agent");
  tools.pop();
});

test("a finished run reports the finish reason of the model's last response", async () => {
  let round = 0;
  scripts.set("think then stop", async () => {
    round += 1;
    return round === 1
      ? completed({ tool_calls: [{ index: 0, id: "p0", name: "missing_tool", arguments: "{}" }], finish_reason: "tool_calls" })
      : completed({ reasoning: "Next I will trace the register.", finish_reason: "stop" });
  });
  const started = deploy_agent(request("think then stop"));
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  const report = reports.find((entry) => entry.run_id === started.run.run_id);
  assert.equal(report?.stop_reason, "stop");
  assert.equal(report?.status, "completed");
});

test("message_agent reaches the agent at its next round", async () => {
  let round = 0;
  let agent_id = "";
  tools.push({
    spec: { name: "slow_step", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async () => {
      const agent = get_agent(agent_id);
      assert.ok(agent);
      assert.equal(message_agent(agent, "stop and report now"), true);
      return { status: "done", text: "step done", view: null };
    },
  });
  scripts.set("steerable", async (messages) => {
    round += 1;
    if (round === 1) {
      return completed({ tool_calls: [{ index: 0, id: "p0", name: "slow_step", arguments: "{}" }], finish_reason: "tool_calls" });
    }
    const last = messages.at(-1);
    return completed({ content: typeof last?.content === "string" && last.content.includes("stop and report now") ? "stopped as asked" : "missed it" });
  });
  const started = deploy_agent(request("steerable"));
  agent_id = started.agent.agent_id;
  await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
  assert.equal(await fs.readFile(reports.find((report) => report.run_id === started.run.run_id)?.report_path ?? "", "utf8"), "stopped as asked");
  assert.ok(events.some((event) => event.run_id === started.run.run_id && event.type === "steer" && event.text === "stop and report now"));
  tools.pop();
});

test("at most eight agents run at once per chat", async () => {
  scripts.set("park", block_until_abort);
  const running = Array.from({ length: max_running_agents }, () => deploy_agent(request("park", { chat_id: "chat-cap" })));
  assert.throws(() => deploy_agent(request("park", { chat_id: "chat-cap" })), /At most 20 agents can run at once in this chat/);
  running.push(deploy_agent(request("park", { chat_id: "chat-cap-other" })));
  for (const started of running) {
    const agent = get_agent(started.agent.agent_id);
    assert.ok(agent);
    cancel_agent(agent);
  }
  await wait_for(() => running.every((started) => live_run(started.run.run_id) === null));
});

test("a long final report is saved whole and completion plus status expose only its file", async () => {
  const content = "REPORT_BODY_SENTINEL\n" + "complete finding\n".repeat(5000) + "FINAL_REPORT_TAIL";
  scripts.set("long report", async () => completed({ content }));
  const started = deploy_agent(request("long report"));
  await wait_for(() => reports.some((entry) => entry.run_id === started.run.run_id));
  const notification = reports.find((entry) => entry.run_id === started.run.run_id);
  assert.ok(notification?.report_path);
  assert.equal(await fs.readFile(notification.report_path, "utf8"), content);
  assert.doesNotMatch(JSON.stringify(notification), /REPORT_BODY_SENTINEL/);
  const result = await get_agent_status_tool.execute({
    chat_id: "chat-runner",
    turn_id: "parent-msg",
    call_id: "status",
    message_main: () => false, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
    project_root: project,
    user_request: "read status",
    mode: "ask",
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings,
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async () => ({ approved: true, grant: "once", feedback: "" }),
    side_model: async () => "",
    review: review_stub(),
  }, { agent_id: started.agent.agent_id });
  assert.match(result.text, /Get-Content -LiteralPath/);
  assert.ok(result.text.includes(notification.report_path));
  assert.doesNotMatch(result.text, /REPORT_BODY_SENTINEL|FINAL_REPORT_TAIL/);
  const agent = get_agent(started.agent.agent_id);
  const run = agent?.runs.find((entry) => entry.run_id === started.run.run_id);
  assert.equal(run?.report, content);
  save_index_sync();
  await init_agent_store(path.join(root, "agents"));
  assert.equal(get_agent(started.agent.agent_id)?.runs.find((entry) => entry.run_id === started.run.run_id)?.report, content);
});

test("a report continued after an output limit keeps both parts in the saved file", async () => {
  let calls = 0;
  scripts.set("continued report", async () => {
    calls += 1;
    return calls === 1 ? completed({ content: "REPORT_BEGIN\n", finish_reason: "length" }) : completed({ content: "REPORT_END" });
  });
  const started = deploy_agent(request("continued report"));
  await wait_for(() => reports.some((entry) => entry.run_id === started.run.run_id));
  const file = reports.find((entry) => entry.run_id === started.run.run_id)?.report_path;
  assert.ok(file);
  assert.equal(await fs.readFile(file, "utf8"), "REPORT_BEGIN\nREPORT_END");
});