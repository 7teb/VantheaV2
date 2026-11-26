import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ApprovalRequest, PendingApprovalRequest } from "../shared/approval.ts";
import { waiting_approvals } from "../electron/agents/live.ts";
import { deploy_agent } from "../electron/agents/runner.ts";
import { cancel_chat, open_chat_window, pending_approvals, resolve_decision, wait_for_decision } from "../electron/permissions/approvals.ts";
import { close_full_window } from "../electron/permissions/full-window.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { forget_run_options, reject_feedback, set_run_options } from "../electron/turn/run-options.ts";
import { completed, events, model, reports, request, scripts, start_runner, stop_runner, tools, wait_for } from "./agents-runner-harness.ts";

before(start_runner);

after(stop_runner);

const command: PendingApprovalRequest = { kind: "command", command: "npm run build", cwd: ".", background: false, review: null, grant_prefix: null, request_id: "command-approval" };

const memory: ApprovalRequest = { kind: "memory", action: "remember", text: "x" };

test("a reject feedback denies at once with that text and registers nothing", async () => {
  const signal = new AbortController().signal;
  const decision = await wait_for_decision({ key: "chat-r", chat_id: "chat-r", call_id: "c0_0", request: command, signal, reject_feedback });
  assert.deepEqual(decision, { approved: false, grant: "once", feedback: reject_feedback });
  assert.deepEqual(pending_approvals("chat-r"), []);
  assert.equal(resolve_decision("chat-r", command.request_id, { approved: true, grant: "once", feedback: "" }), false);
});

test("an aborted signal still answers before the reject feedback", async () => {
  const controller = new AbortController();
  controller.abort();
  const decision = await wait_for_decision({ key: "chat-s", chat_id: "chat-s", call_id: "c0_0", request: command, signal: controller.signal, reject_feedback });
  assert.deepEqual(decision, { approved: false, grant: "once", feedback: "" });
});

test("the reject feedback wins over an open full window", async () => {
  open_chat_window("chat-w");
  try {
    const decision = await wait_for_decision({ key: "chat-w", chat_id: "chat-w", call_id: "c0_0", request: command, signal: new AbortController().signal, reject_feedback });
    assert.equal(decision.approved, false);
    assert.equal(decision.feedback, reject_feedback);
    const plain = await wait_for_decision({ key: "chat-w", chat_id: "chat-w", call_id: "c0_1", request: command, signal: new AbortController().signal });
    assert.equal(plain.grant, "full_window");
  } finally {
    close_full_window("chat-w");
  }
});

test("pending_approvals lists the main and agent waits of one chat and drops answered ones", async () => {
  const signal = new AbortController().signal;
  const agent_request = { ...memory, request_id: "agent-approval" };
  const other_request = { ...command, request_id: "other-approval" };
  const main = wait_for_decision({ key: "chat-p", chat_id: "chat-p", call_id: "c0_0", request: command, signal });
  const agent = wait_for_decision({ key: "agent:run_1", chat_id: "chat-p", call_id: "c1_0", request: agent_request, signal });
  const other = wait_for_decision({ key: "chat-q", chat_id: "chat-q", call_id: "c0_0", request: other_request, signal });
  assert.deepEqual(pending_approvals("chat-p"), [
    { key: "chat-p", call_id: "c0_0", request: command },
    { key: "agent:run_1", call_id: "c1_0", request: agent_request },
  ]);
  assert.deepEqual(pending_approvals("chat-q"), [{ key: "chat-q", call_id: "c0_0", request: other_request }]);
  assert.deepEqual(pending_approvals("chat-none"), []);
  assert.equal(resolve_decision("agent:run_1", agent_request.request_id, { approved: true, grant: "once", feedback: "" }), true);
  assert.equal((await agent).approved, true);
  assert.deepEqual(pending_approvals("chat-p"), [{ key: "chat-p", call_id: "c0_0", request: command }]);
  cancel_chat("chat-p");
  cancel_chat("chat-q");
  assert.equal((await main).approved, false);
  assert.equal((await other).approved, false);
  assert.deepEqual(pending_approvals("chat-p"), []);
  assert.deepEqual(pending_approvals("chat-q"), []);
});

test("a late reply to an earlier approval with the same call id leaves the next approval pending", async () => {
  const first_controller = new AbortController();
  const first = wait_for_decision({ key: "chat-late", chat_id: "chat-late", call_id: "c0_0", request: { ...command, request_id: "turn-1" }, signal: first_controller.signal });
  first_controller.abort();
  assert.equal((await first).approved, false);
  const second_request = { ...command, command: "npm run deploy", request_id: "turn-2" };
  const second = wait_for_decision({ key: "chat-late", chat_id: "chat-late", call_id: "c0_0", request: second_request, signal: new AbortController().signal });
  assert.equal(resolve_decision("chat-late", "turn-1", { approved: true, grant: "once", feedback: "" }), false);
  assert.deepEqual(pending_approvals("chat-late"), [{ key: "chat-late", call_id: "c0_0", request: second_request }]);
  assert.equal(resolve_decision("chat-late", "turn-2", { approved: false, grant: "once", feedback: "no" }), true);
  assert.deepEqual(await second, { approved: false, grant: "once", feedback: "no" });
});

test("a sub-agent of a chat pinned to the reject policy gets its approvals denied without waiting", async () => {
  const chat_id = "chat-reject";
  const decisions: { approved: boolean; feedback: string }[] = [];
  set_run_options(chat_id, { mode: "auto", choice: { model: model.id, effort: "", pro: false }, approvals: "reject" });
  tools.push({
    spec: { name: "needs_ok", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async (ctx: ToolContext) => {
      const decision = await ctx.approve(memory);
      decisions.push({ approved: decision.approved, feedback: decision.feedback });
      return { status: decision.approved ? "done" : "denied", text: decision.approved ? "ok" : "no", view: null };
    },
  });
  try {
    let round = 0;
    scripts.set("reject ask", async () => {
      round += 1;
      return round === 1 ? completed({ tool_calls: [{ index: 0, id: "p0", name: "needs_ok", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "went on without it" });
    });
    const started = deploy_agent(request("reject ask", { chat_id }));
    await wait_for(() => reports.some((report) => report.run_id === started.run.run_id));
    assert.deepEqual(decisions, [{ approved: false, feedback: reject_feedback }]);
    const own = events.filter((event) => event.run_id === started.run.run_id);
    assert.ok(own.some((event) => event.type === "tool_approval"));
    const decided = own.find((event) => event.type === "tool_decision");
    assert.ok(decided?.type === "tool_decision" && !decided.decision.approved && decided.decision.feedback === reject_feedback);
    assert.deepEqual(waiting_approvals(chat_id), []);
    assert.deepEqual(pending_approvals(chat_id), []);
  } finally {
    tools.pop();
    forget_run_options(chat_id);
  }
});
