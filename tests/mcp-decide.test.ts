import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalDecision, HumanDecision, McpTier } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import type { CommandDecision } from "../electron/permissions/decide.ts";
import { clear_mcp_chat, decide, record_grant, set_command_gate, type McpCall } from "../electron/tools/mcp/decide.ts";
import { mcp_review } from "../electron/tools/mcp/overseer.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { answer, review_stub, type ReviewStub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

const context = (mode: PermissionMode, chat_id = "chat-a", stub: ReviewStub = review_stub()): ToolContext => ({
  chat_id,
  turn_id: "turn",
  call_id: "call",
  project_root: "",
  user_request: "look at the binary",
  mode,
  profile: "main",
  model: tool_model,
  image_fit: [],
  settings: { custom_instructions: "" } as ToolContext["settings"],
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async (): Promise<ApprovalDecision> => ({ approved: true, grant: "once", feedback: "" }),
  side_model: async () => "",
  review: stub,
  message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

const call = (tier: McpTier, extra: Partial<McpCall> = {}): McpCall => ({ server: "ce", tool: `${tier}_tool`, tier, args: {}, scope: null, trusted: false, ...extra });

const gate_decision = (action: CommandDecision["action"], reason = ""): CommandDecision => ({
  action, reason, record: null, note: null, grant_prefix: null, plan: false, pins: [], source_hash: "", seen: new Set(),
});

test("readonly tools ask in ask mode, run in full mode and are reviewed in auto mode", async () => {
  assert.equal((await decide(call("readonly"), context("ask"), mcp_review)).kind, "ask");
  assert.equal((await decide(call("readonly"), context("full"), mcp_review)).kind, "run");
  const stub = review_stub([answer("allow")]);
  assert.equal((await decide(call("readonly"), context("auto", "chat-ro", stub), mcp_review)).kind, "run");
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.records[0]?.tool, "mcp:ce/readonly_tool");
});

test("state changes run in full, ask in ask, and follow the classifier in auto", async () => {
  assert.equal((await decide(call("state_change"), context("full"), mcp_review)).kind, "run");
  assert.equal((await decide(call("state_change"), context("ask"), mcp_review)).kind, "ask");
  assert.equal((await decide(call("state_change"), context("auto", "chat-sc", review_stub([answer("allow")])), mcp_review)).kind, "run");
  const flagged = await decide(call("state_change"), context("auto", "chat-sc2", review_stub([answer("review", "patches memory")])), mcp_review);
  assert.equal(flagged.kind, "ask");
  assert.equal(flagged.kind === "ask" ? flagged.note?.reason : "", "patches memory");
  const denied = await decide(call("state_change"), context("auto", "chat-sc3", review_stub([answer("deny", "writes the protected file")])), mcp_review);
  assert.equal(denied.kind, "denied");
  assert.match(denied.kind === "denied" ? denied.reason : "", /^Denied by the automatic review\. The tool call did not run\./);
});

test("dangerous tools ask in full mode unless trusted, and the classifier decides them in auto mode", async () => {
  assert.equal((await decide(call("dangerous"), context("full"), mcp_review)).kind, "ask");
  assert.equal((await decide(call("dangerous", { trusted: true }), context("full"), mcp_review)).kind, "run");
  assert.equal((await decide(call("dangerous", { trusted: true }), context("ask"), mcp_review)).kind, "ask");
  assert.equal((await decide(call("dangerous"), context("auto", "chat-dg", review_stub([answer("allow")])), mcp_review)).kind, "run");
});

test("in auto mode a chat or session grant turns a model review into allow, never a deny", async () => {
  record_grant("chat-granted", call("state_change"), "chat");
  const granted = await decide(call("state_change"), context("auto", "chat-granted", review_stub([answer("review")])), mcp_review);
  assert.equal(granted.kind, "run");
  assert.equal(granted.kind === "run" ? granted.record?.granted : false, true);
  assert.equal((await decide(call("state_change"), context("auto", "chat-granted", review_stub([answer("deny")])), mcp_review)).kind, "denied");
  clear_mcp_chat("chat-granted");
});

test("a chat grant on a dangerous tool covers only the same target scope", async () => {
  const scoped = call("dangerous", { scope: "pid=1|process=|module=|address=0x10|size=4" });
  record_grant("chat-scope", scoped, "chat");
  assert.equal((await decide(scoped, context("ask", "chat-scope"), mcp_review)).kind, "run");
  assert.equal((await decide({ ...scoped, scope: "pid=1|process=|module=|address=0x20|size=4" }, context("ask", "chat-scope"), mcp_review)).kind, "ask");
  assert.equal((await decide(scoped, context("ask", "chat-other"), mcp_review)).kind, "ask");
  record_grant("chat-noscope", call("dangerous"), "chat");
  assert.equal((await decide(call("dangerous"), context("ask", "chat-noscope"), mcp_review)).kind, "ask");
});

test("a session grant on a dangerous tool covers the whole server in that chat", async () => {
  record_grant("chat-session", call("dangerous"), "session");
  assert.equal((await decide(call("dangerous", { tool: "other_write" }), context("ask", "chat-session"), mcp_review)).kind, "run");
  assert.equal((await decide(call("state_change"), context("ask", "chat-session"), mcp_review)).kind, "run");
  assert.equal((await decide(call("readonly"), context("ask", "chat-session"), mcp_review)).kind, "run");
  assert.equal((await decide(call("dangerous", { server: "ida" }), context("ask", "chat-session"), mcp_review)).kind, "ask");
  clear_mcp_chat("chat-session");
  assert.equal((await decide(call("dangerous"), context("ask", "chat-session"), mcp_review)).kind, "ask");
});

test("state change grants are per tool for chat and per server for session", async () => {
  record_grant("chat-state", call("state_change"), "chat");
  assert.equal((await decide(call("state_change"), context("ask", "chat-state"), mcp_review)).kind, "run");
  assert.equal((await decide(call("state_change", { tool: "rename" }), context("ask", "chat-state"), mcp_review)).kind, "ask");
  record_grant("chat-state", call("state_change"), "session");
  assert.equal((await decide(call("state_change", { tool: "rename" }), context("ask", "chat-state"), mcp_review)).kind, "run");
  record_grant("chat-once", call("state_change"), "once");
  assert.equal((await decide(call("state_change"), context("ask", "chat-once"), mcp_review)).kind, "ask");
});

test("shell tools go through the command gate, are never granted, and a deny text passes through once", async () => {
  const shell = call("shell_system", { args: { command: "format c:" }, trusted: true });
  assert.deepEqual(await decide(shell, context("full"), mcp_review), { kind: "block", reason: "The command policy is not initialized, shell MCP tools cannot run." });
  const seen: string[] = [];
  let next = gate_decision("block", "Original command-policy reason.");
  set_command_gate(async (command) => {
    seen.push(command);
    return next;
  });
  assert.equal((await decide(shell, context("full"), mcp_review)).kind, "block");
  assert.deepEqual(seen, ["format c:"]);
  next = { ...gate_decision("ask"), note: { id: "r", source: "model", reason: "Original command-policy reason.", rule_source: "none", rule: "" } };
  record_grant("chat-a", shell, "session");
  assert.equal((await decide(shell, context("full"), mcp_review)).kind, "ask");
  const asked = await decide(shell, context("auto"), mcp_review);
  assert.equal(asked.kind === "ask" ? asked.note?.reason : "", "Original command-policy reason.");
  next = gate_decision("deny", "Denied by the automatic review. The command did not run.");
  assert.deepEqual(await decide(shell, context("auto"), mcp_review), { kind: "denied", reason: "Denied by the automatic review. The command did not run." });
  next = gate_decision("run");
  assert.equal((await decide(call("shell_system", { args: { arguments: ["format", "c:"] } }), context("auto"), mcp_review)).kind, "run");
  assert.equal(seen.at(-1), "format c:\nformat\nc:");
  assert.equal((await decide(call("shell_system"), context("ask"), mcp_review)).kind, "ask");
  assert.equal((await decide(call("shell_system"), context("auto"), mcp_review)).kind, "ask");
});

test("a call the user denied before goes to the classifier, which sees the denial", async () => {
  const target = call("state_change", { args: { path: "a.bin" } });
  const denial: HumanDecision = {
    id: "d1", at: 1, actor: "main", tool: "mcp:ce/state_change_tool", subject: JSON.stringify(target.args, null, 2), cwd: "", approved: false, grant: "once", feedback: "not that file", reason: "",
  };
  const stub = review_stub([answer("deny", "the user denied writing a.bin", { workaround_of: "d1" })]);
  const ctx: ToolContext = { ...context("auto", "chat-denied", stub), human_decisions: async () => [denial] };
  const verdict = await decide(target, ctx, mcp_review);
  assert.equal(stub.calls.length, 1);
  assert.match(stub.calls[0]?.parts.map((part) => part.text).join("") ?? "", /"status":"denied by the user","reason":"","feedback":"not that file","human_spoke_since":true/);
  assert.equal(verdict.kind, "denied");
});
