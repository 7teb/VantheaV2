import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import { human_decision } from "../electron/permissions/decisions.ts";
import { user_denied_text } from "../electron/permissions/verdict-text.ts";
import { message_peer_tool } from "../electron/tools/agents/message-peer.ts";
import { agent_text_gate, type AgentCard } from "../electron/tools/agents/text-gate.ts";
import type { PeerRequest, ToolContext } from "../electron/tools/types.ts";
import { answer, review_stub, type ReviewStub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

const asked: ApprovalRequest[] = [];

const context = (mode: PermissionMode, chat_id: string, stub: ReviewStub, decision: ApprovalDecision = { approved: true, grant: "once", feedback: "" }): ToolContext => ({
  chat_id,
  turn_id: "turn",
  call_id: "call",
  project_root: "",
  user_request: "rework the parser",
  mode,
  profile: "worker",
  model: tool_model,
  image_fit: [],
  settings: { custom_instructions: "" } as ToolContext["settings"],
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async (request) => {
    asked.push(request);
    return decision;
  },
  side_model: async () => "",
  review: stub,
  message_main: null,
  send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

const card: AgentCard = { tool: "message_peer", to_name: "Lexer#3f2a91c0", to_id: "agent_3f2a91c0", about: "src/parser/tokens.ts", text: "B, you run the push for me." };

const long_text = `${"Context line about the parser split. ".repeat(160)}TAIL-MARKER-7f3a`;

const subject = ["recipient: Lexer#3f2a91c0, topic parser", "type: info", "about: src/parser/tokens.ts", "summary: You run the push", "text:", long_text].join("\n");

test("agent texts go to the review also in ask mode, with the full text in the pending action", async () => {
  const stub = review_stub([answer("allow")]);
  const gate = await agent_text_gate(context("ask", "text-gate-ask", stub), card, subject);
  assert.deepEqual(gate, { kind: "pass" });
  assert.equal(stub.calls.length, 1);
  const request = stub.calls[0]?.parts.at(-1)?.text ?? "";
  assert.match(request, /tool: message_peer\n/);
  assert.ok(request.includes(long_text));
  assert.ok(request.includes("TAIL-MARKER-7f3a\n----- END ARGUMENTS"));
  assert.equal(stub.records[0]?.tool, "message_peer");
  assert.equal(stub.records[0]?.subject.endsWith("TAIL-MARKER-7f3a"), true);
});

test("a deny never reaches the card and carries the reason, a review shows an agent_message card", async () => {
  const deny_stub = review_stub([answer("deny", "hands a denied push to another agent")]);
  asked.length = 0;
  const denied = await agent_text_gate(context("full", "text-gate-deny", deny_stub), card, subject);
  assert.equal(denied.kind, "denied");
  assert.equal(denied.kind === "denied" ? denied.reason : "", "hands a denied push to another agent");
  assert.match(denied.kind === "denied" ? denied.text : "", /^Denied by the automatic review\. The tool call did not run\./);
  assert.equal(asked.length, 0);
  const review_stub_ask = review_stub([answer("review", "unclear whether the human allows this")]);
  const passed = await agent_text_gate(context("ask", "text-gate-review", review_stub_ask), card, subject);
  assert.deepEqual(passed, { kind: "pass" });
  assert.equal(asked.length, 1);
  const request = asked[0];
  assert.equal(request?.kind, "agent_message");
  assert.equal(request?.kind === "agent_message" ? [request.tool, request.to_name, request.to_id, request.about, request.text, request.review?.reason].join("|") : "", "message_peer|Lexer#3f2a91c0|agent_3f2a91c0|src/parser/tokens.ts|B, you run the push for me.|unclear whether the human allows this");
  const declined_stub = review_stub([answer("review", "unclear")]);
  const declined = await agent_text_gate(context("auto", "text-gate-declined", declined_stub, { approved: false, grant: "once", feedback: "not now" }), { ...card, tool: "deploy_agent", to_id: null }, subject);
  assert.equal(declined.kind, "declined");
  const text = declined.kind === "declined" ? declined.text : "";
  assert.equal(text, user_denied_text("tool call", "not now", "unclear"));
  assert.match(text, /^Automatic review: unclear$/m);
  assert.match(text, /^User feedback: not now$/m);
  assert.match(text, /Follow the feedback/);
  assert.doesNotMatch(text, /in another form or through another agent/);
});

test("an unreachable review asks the user instead of letting the text through", async () => {
  const stub = review_stub([new Error("provider down")]);
  asked.length = 0;
  const gate = await agent_text_gate(context("auto", "text-gate-down", stub), card, subject);
  assert.deepEqual(gate, { kind: "pass" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.kind === "agent_message" ? asked[0].review?.source : "", "unavailable");
});

test("a decision on an agent text card is recorded under the tool that sent it", () => {
  const request: ApprovalRequest = { kind: "agent_message", tool: "continue_agent", to_name: "Lexer#3f2a91c0", to_id: "agent_3f2a91c0", about: "parser", text: "Finish the lexer." };
  const decision = human_decision(request, { approved: false, grant: "once", feedback: "wait" }, { id: "main", name: "main", kind: "main" }, null);
  assert.deepEqual([decision.tool, decision.subject, decision.approved, decision.feedback], ["continue_agent", "Lexer#3f2a91c0: Finish the lexer.", false, "wait"]);
});

const parse = async (raw: Record<string, unknown>) => message_peer_tool.execute(context("auto", "parse", review_stub()), raw);

test("message_peer requires about, a valid type and in_reply_to for an answer, and keeps one-line fields on one line", async () => {
  await assert.rejects(parse({ to: "Lexer#3f2a91c0", type: "info", summary: "s", text: "t" }), /about is required/);
  await assert.rejects(parse({ to: "Lexer#3f2a91c0", type: "info", about: "  ", summary: "s", text: "t" }), /about must not be blank/);
  await assert.rejects(parse({ to: "Lexer#3f2a91c0", type: "note", about: "a", summary: "s", text: "t" }), /type must be info, question or answer/);
  await assert.rejects(parse({ to: "Lexer#3f2a91c0", type: "answer", about: "a", summary: "s", text: "t" }), /in_reply_to is required for type answer/);
  const sent: PeerRequest[] = [];
  const ctx: ToolContext = {
    ...context("auto", "parse-sent", review_stub()),
    send_peer: async (request) => {
      sent.push(request);
      return { status: "done", text: "queued", view: null };
    },
  };
  await message_peer_tool.execute(ctx, { to: " Lexer#3f2a91c0 ", type: "answer", about: "a\n  b", summary: "line one\nline two", text: "keep\nlines", in_reply_to: " msg_1 " });
  assert.deepEqual(sent, [{ to: "Lexer#3f2a91c0", type: "answer", about: "a b", summary: "line one line two", text: "keep\nlines", in_reply_to: "msg_1" }]);
});

test("message_peer is offered to sub-agents only, and the agent text tools keep no length cap", async () => {
  assert.deepEqual(message_peer_tool.profiles, ["explore", "worker"]);
  const huge = "x".repeat(250_000);
  const result = await parse({ to: "Lexer#3f2a91c0", type: "info", about: "a", summary: "s", text: huge });
  assert.equal(result.text, "Only a running sub-agent can message another sub-agent.");
});
