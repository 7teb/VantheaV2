import assert from "node:assert/strict";
import { test } from "node:test";
import { skips_unanswered, type ApprovalRequest } from "../shared/approval.ts";
import { cancel_chat, hold_decision, open_chat_window, resolve_decision, wait_for_decision } from "../electron/permissions/approvals.ts";
import { close_full_window, effective_mode, full_window_until, on_full_window } from "../electron/permissions/full-window.ts";

const approve = { approved: true, grant: "chat", feedback: "" } as const;

const command: ApprovalRequest = { kind: "command", command: "npm run build", cwd: ".", background: false, review: null, grant_prefix: null };

const reviewer_down: ApprovalRequest = { ...command, review: { id: "r", source: "unavailable", reason: "", rule_source: "none", rule: "", failure: "timeout" } };

const mcp_shell: ApprovalRequest = { kind: "mcp", server: "ce", tool: "run", tier: "shell_system", args_preview: "{}", scope: null };

const memory: ApprovalRequest = { kind: "memory", action: "remember", text: "x" };

const wait = (key: string, call_id: string, signal: AbortSignal, request: ApprovalRequest = command, chat_id = key) =>
  wait_for_decision({ key, chat_id, call_id, request, signal });

test("resolve_decision settles a pending wait and only once", async () => {
  const controller = new AbortController();
  const pending = wait("chat-a", "call-1", controller.signal);
  assert.equal(resolve_decision("chat-a", "call-1", { ...approve }), true);
  assert.deepEqual(await pending, { approved: true, grant: "chat", feedback: "" });
  assert.equal(resolve_decision("chat-a", "call-1", { ...approve }), false);
});

test("aborting the signal resolves the wait as denied", async () => {
  const controller = new AbortController();
  const pending = wait("chat-b", "call-2", controller.signal);
  controller.abort();
  const decision = await pending;
  assert.equal(decision.approved, false);
});

test("an already-aborted signal resolves immediately as denied", async () => {
  const controller = new AbortController();
  controller.abort();
  const decision = await wait("chat-c", "call-3", controller.signal);
  assert.equal(decision.approved, false);
});

test("cancel_chat denies every pending wait of that chat", async () => {
  const first = new AbortController();
  const second = new AbortController();
  const one = wait("chat-d", "call-a", first.signal);
  const two = wait("chat-d", "call-b", second.signal);
  cancel_chat("chat-d");
  assert.equal((await one).approved, false);
  assert.equal((await two).approved, false);
  assert.equal(resolve_decision("chat-d", "call-a", { ...approve }), false);
});

test("opening the full window from the mode picker approves every covered wait of the chat, agents included", async () => {
  const signal = new AbortController().signal;
  const changes: (number | null)[] = [];
  const stop = on_full_window((chat_id, until) => chat_id === "chat-e" && changes.push(until));
  try {
    const main = wait("chat-e", "call-1", signal, reviewer_down);
    const agent = wait("agent:run-1", "c0_0", signal, command, "chat-e");
    const asks_anyway = wait("agent:run-1", "c0_1", signal, memory, "chat-e");
    const shell_tool = wait("agent:run-1", "c0_2", signal, mcp_shell, "chat-e");
    const plan_card = wait("chat-e", "call-2", signal, { ...command, plan: true });
    const other_chat = wait("chat-f", "call-1", signal);
    open_chat_window("chat-e");
    assert.deepEqual(await main, { approved: true, grant: "full_window", feedback: "" });
    assert.deepEqual(await agent, { approved: true, grant: "full_window", feedback: "" });
    assert.equal(effective_mode("chat-e", "auto"), "full");
    assert.equal(effective_mode("chat-f", "auto"), "auto");
    assert.equal(typeof full_window_until("chat-e"), "number");
    assert.equal(resolve_decision("agent:run-1", "c0_1", { approved: false, grant: "once", feedback: "" }), true);
    assert.equal((await asks_anyway).approved, false);
    assert.equal(resolve_decision("agent:run-1", "c0_2", { approved: false, grant: "once", feedback: "" }), true);
    assert.equal((await shell_tool).approved, false);
    assert.equal(resolve_decision("chat-e", "call-2", { approved: false, grant: "once", feedback: "" }), true);
    assert.equal((await plan_card).approved, false);
    assert.equal(resolve_decision("chat-f", "call-1", { ...approve }), true);
    assert.equal((await other_chat).approved, true);
    const later = await wait("agent:run-2", "c1_0", signal, command, "chat-e");
    assert.equal(later.grant, "full_window");
  } finally {
    close_full_window("chat-e");
    stop();
  }
  assert.equal(effective_mode("chat-e", "auto"), "auto");
  assert.equal(changes.length, 2);
  assert.equal(changes[1], null);
});

test("answering a card never opens the full window, also when the review was unavailable", async () => {
  const signal = new AbortController().signal;
  const unavailable = wait("chat-g", "call-1", signal, reviewer_down);
  assert.equal(resolve_decision("chat-g", "call-1", { approved: true, grant: "once", feedback: "" }), true);
  assert.deepEqual(await unavailable, { approved: true, grant: "once", feedback: "" });
  assert.equal(full_window_until("chat-g"), null);
  assert.equal(effective_mode("chat-g", "auto"), "auto");
});

test("a reviewed card without an answer is skipped as expired at its deadline", async () => {
  const signal = new AbortController().signal;
  const decision = await wait_for_decision({ key: "chat-x", chat_id: "chat-x", call_id: "call-1", request: { ...reviewer_down, expires_at: Date.now() + 20 }, signal });
  assert.deepEqual(decision, { approved: false, grant: "once", feedback: "", expired: true });
  assert.equal(resolve_decision("chat-x", "call-1", { ...approve }), false);
});

test("holding a card stops its deadline once and keeps it waiting for the human", async () => {
  const signal = new AbortController().signal;
  let holds = 0;
  const pending = wait_for_decision({ key: "chat-y", chat_id: "chat-y", call_id: "call-1", request: { ...reviewer_down, expires_at: Date.now() + 30 }, signal, on_hold: () => (holds += 1) });
  assert.equal(hold_decision("chat-y", "call-1"), true);
  assert.equal(hold_decision("chat-y", "call-1"), true);
  assert.equal(holds, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(resolve_decision("chat-y", "call-1", { ...approve }), true);
  assert.deepEqual(await pending, { approved: true, grant: "chat", feedback: "" });
  assert.equal(hold_decision("chat-y", "call-1"), false);
});

test("only cards the review raised skip themselves", () => {
  assert.equal(skips_unanswered(reviewer_down), true);
  assert.equal(skips_unanswered(command), false);
  assert.equal(skips_unanswered(memory), false);
  assert.equal(skips_unanswered({ kind: "write", path: "a.ts", created: false, added: 1, removed: 0, diff: [] }), false);
});
