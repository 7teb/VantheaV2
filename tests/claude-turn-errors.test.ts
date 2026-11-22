import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import { blocked_limit, limit_error, names_missing_session, result_error, type ClaudeFacts } from "../electron/turn/claude/errors.ts";
import { handoff_header } from "../electron/turn/claude/handoff.ts";
import { claude_harness, claude_model, ends, error_result, fake_runtime, init, make_tool, open_steps, result, synthetic, text_response, transcript } from "./claude-turn-kit.ts";

const prefixes = ["You've hit your", "You're out of usage credits"];

const no_facts: ClaudeFacts = { assistant_error: null, assistant_text: "", limit: null };

const classify = (over: Record<string, unknown>, facts: Partial<ClaudeFacts> = {}) => {
  const error = result_error(error_result(over) as SDKResultMessage, { ...no_facts, ...facts }, prefixes);
  return { kind: error.kind, message: error.message };
};

const classify_success = (over: Record<string, unknown>, facts: Partial<ClaudeFacts> = {}) => {
  const error = result_error(result({ is_error: true, ...over }) as SDKResultMessage, { ...no_facts, ...facts }, prefixes);
  return { kind: error.kind, message: error.message };
};

test("startup failures and missing sessions on a new session are claude_process", () => {
  assert.deepEqual(classify({ startup_failure_reason: "shell_tool_missing", errors: ["No shell found"] }), { kind: "claude_process", message: "Claude Code did not start (shell_tool_missing): No shell found" });
  assert.equal(classify({ errors: ["No conversation found with session ID: abc"] }).kind, "claude_process");
});

test("login problems are claude_auth by error code or by text", () => {
  assert.equal(classify({ errors: ["x"] }, { assistant_error: "authentication_failed" }).kind, "claude_auth");
  assert.equal(classify({ errors: ["x"] }, { assistant_error: "oauth_org_not_allowed" }).kind, "claude_auth");
  assert.equal(classify({ errors: ["x"] }, { assistant_error: "verification_required" }).kind, "claude_auth");
  assert.deepEqual(classify_success({ result: "Not logged in · Please run /login" }), { kind: "claude_auth", message: "Not logged in · Please run /login" });
  assert.equal(classify_success({ result: "Failed to authenticate: OAuth token revoked" }).kind, "claude_auth");
});

test("a held account is claude_blocked unless the text names a usage limit", () => {
  assert.equal(classify_success({ result: "Your account is on hold" }, { assistant_error: "account_on_hold" }).kind, "claude_blocked");
  assert.equal(classify_success({ result: "Billing problem" }, { assistant_error: "billing_error" }).kind, "claude_blocked");
  assert.equal(classify_success({ result: "You're out of usage credits" }, { assistant_error: "billing_error" }).kind, "claude_limit");
});

test("usage limits are claude_limit with the limit type and the local reset time", () => {
  const limit = { status: "rejected" as const, rateLimitType: "seven_day" as const, resetsAt: 1_900_000_000 };
  const by_event = classify_success({ result: "Request rejected" }, { limit });
  assert.equal(by_event.kind, "claude_limit");
  assert.match(by_event.message, /^Request rejected \(limit seven_day, resets at \d{4}-\d\d-\d\d \d\d:\d\d\)$/);
  assert.equal(classify_success({ result: "You've hit your session limit · resets 3:45pm" }).message, "You've hit your session limit · resets 3:45pm");
  assert.equal(classify({ errors: ["stopped"], terminal_reason: "blocking_limit" }).kind, "claude_limit");
  assert.equal(limit_error("", null).message, "Claude Code reports that the Claude plan usage limit is reached.");
  assert.equal(blocked_limit({ status: "rejected", overageStatus: "allowed" }), false);
  assert.equal(blocked_limit({ status: "rejected", isUsingOverage: true }), false);
  assert.equal(blocked_limit({ status: "allowed_warning" }), false);
  assert.equal(blocked_limit({ status: "rejected", overageStatus: "rejected" }), true);
});

test("the remaining API errors map to the engine's kinds in the documented order", () => {
  assert.equal(classify_success({ result: "slow down" }, { assistant_error: "rate_limit" }).kind, "rate_limited");
  assert.equal(classify_success({ result: "no such model" }, { assistant_error: "model_not_found" }).kind, "claude_model");
  assert.equal(classify_success({ result: "busy" }, { assistant_error: "overloaded" }).kind, "provider_unavailable");
  assert.equal(classify_success({ result: "boom", api_error_status: 503 }).kind, "provider_unavailable");
  assert.equal(classify({ errors: ["too long"], terminal_reason: "prompt_too_long" }).kind, "context_limit");
  assert.equal(classify_success({ result: "prompt is too long: 1200000 tokens" }).kind, "context_limit");
  assert.equal(classify_success({ result: "bad field" }, { assistant_error: "invalid_request" }).kind, "bad_request");
  assert.deepEqual(classify_success({ result: "" }, { assistant_text: "API Error: something odd" }), { kind: "internal", message: "API Error: something odd" });
  assert.equal(classify({ errors: [] }).message, "Claude Code ended the turn with error_during_execution.");
});

test("names_missing_session finds the Claude Code text in any source", () => {
  assert.equal(names_missing_session(["", "No conversation found with session ID: 1234"]), true);
  assert.equal(names_missing_session(["session gone"]), false);
});

const run = async (messages: Parameters<ReturnType<typeof fake_runtime>["queries"][number]["send"]>, over: Parameters<typeof claude_harness>[1] = {}) => {
  const fake = fake_runtime(prefixes);
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], over);
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(...messages);
  await done;
  assert.equal(ends(h.events).length, 1);
  assert.deepEqual(open_steps(h.events), []);
  return { h, fake, message: transcript(h.events) };
};

test("an auth error result ends with claude_auth and asks the account service to check the login again", async () => {
  const { message, fake } = await run([init(), error_result({ errors: ["Not logged in · Please run /login"] })]);
  assert.equal(message.status, "failed");
  assert.deepEqual(message.error, { kind: "claude_auth", message: "Not logged in · Please run /login" });
  assert.equal(fake.auth_failures(), 1);
});

test("an API key in Claude Code's environment ends the turn with claude_auth at init", async () => {
  const { message } = await run([init("sess-1", "ANTHROPIC_API_KEY")]);
  assert.deepEqual(message.error, { kind: "claude_auth", message: "Claude Code would use an API key (ANTHROPIC_API_KEY), the Claude plan runs only on the subscription login." });
});

test("a refusal ends the turn blocked with the policy kind", async () => {
  const { message } = await run([init(), ...text_response("m1", "I can't help with that", "refusal"), result({ stop_reason: "refusal" })]);
  assert.equal(message.status, "blocked");
  assert.equal(message.error?.kind, "policy");
});

test("an overloaded API ends the turn interrupted as provider_unavailable", async () => {
  const { message } = await run([init(), result({ is_error: true, result: "API Error: overloaded", api_error_status: 529 })]);
  assert.equal(message.status, "interrupted");
  assert.equal(message.error?.kind, "provider_unavailable");
});

test("an effort Claude Code does not take ends with claude_model before Claude Code starts", async () => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], { model: { ...claude_model, efforts: ["minimal"], default_effort: "minimal" }, effort: "minimal" });
  await run_claude_turn(h.session, h.input);
  assert.equal(fake.queries.length, 0);
  assert.deepEqual(transcript(h.events).error, { kind: "claude_model", message: "Claude Code does not take the effort minimal for Claude Opus 5.5." });
});

const stored = { session_id: "old-session", cwd: "C:/project", through_message_id: "prev-turn" };

const history = () => [
  { role: "system" as const, content: "system prompt" },
  { role: "user" as const, content: "earlier question" },
  { role: "assistant" as const, content: "earlier answer" },
  { role: "user" as const, content: "do the thing" },
];

test("a resumed session that Claude Code no longer has starts one new seeded session in the same turn", async () => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], {}, { api_messages: history(), stored, previous_turn_id: "prev-turn" });
  const done = run_claude_turn(h.session, h.input);
  const first = await fake.opened(1);
  assert.equal(first.options.resume, "old-session");
  first.send(error_result({ errors: ["No conversation found with session ID: old-session"] }));
  const second = await fake.opened(2);
  assert.equal(second.options.resume, undefined);
  assert.equal(typeof second.options.sessionId, "string");
  const opening = await second.next_push();
  const blocks = opening.message.content;
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks[0].type === "text" && blocks[0].text.startsWith(handoff_header), true);
  assert.equal(blocks[0].type === "text" && blocks[0].text.includes("USER: earlier question\n\nASSISTANT: earlier answer"), true);
  assert.deepEqual(blocks.slice(1), [{ type: "text", text: "do the thing" }]);
  second.send(init("new-session"), ...text_response("m1", "fresh start"), result());
  await done;
  assert.deepEqual(fake.deleted, [{ session_id: "old-session", cwd: "C:/project" }]);
  assert.deepEqual(h.saved, [null, { session_id: "new-session", cwd: "C:/project", through_message_id: "turn-1" }]);
  assert.equal(transcript(h.events).status, "done");
  assert.equal(ends(h.events).length, 1);
});

test("a missing session reported on stderr of a crashed resume also falls back to a new session", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], {}, { api_messages: history(), stored, previous_turn_id: "prev-turn" });
  const done = run_claude_turn(h.session, h.input);
  const first = await fake.opened(1);
  first.stderr = "No conversation found with session ID: old-session";
  first.crash(new Error("Claude Code process exited with code 1"));
  const second = await fake.opened(2);
  second.send(init("new-session"), ...text_response("m1", "ok"), result());
  await done;
  assert.equal(transcript(h.events).status, "done");
  assert.deepEqual(fake.deleted.map((entry) => entry.session_id), ["old-session"]);
});

test("a resumed turn that fails with bad_request before any round clears and deletes its session", async () => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], {}, { stored, previous_turn_id: "prev-turn" });
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(init("old-session"), synthetic("API Error: 400 messages: invalid tool_use block", "invalid_request"), result({ is_error: true, result: "" }));
  await done;
  const message = transcript(h.events);
  assert.deepEqual(message.error, { kind: "bad_request", message: "API Error: 400 messages: invalid tool_use block" });
  assert.equal(message.steps.length, 0);
  assert.deepEqual(h.saved, [{ session_id: "old-session", cwd: "C:/project", through_message_id: "turn-1" }, null]);
  assert.deepEqual(fake.deleted, [{ session_id: "old-session", cwd: "C:/project" }]);
});

test("a stored session that does not cover the previous turn is deleted and replaced by a seeded one", async () => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], {}, { api_messages: history(), stored, previous_turn_id: "other-turn" });
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  assert.equal(query.options.resume, undefined);
  query.send(init("seeded"), ...text_response("m1", "ok"), result());
  await done;
  assert.deepEqual(fake.deleted, [{ session_id: "old-session", cwd: "C:/project" }]);
  assert.deepEqual(h.saved, [null, { session_id: "seeded", cwd: "C:/project", through_message_id: "turn-1" }]);
});

test("a Claude Code account on another API backend ends the turn with claude_auth at init", async () => {
  const fake = fake_runtime(prefixes);
  fake.account = { apiProvider: "bedrock" };
  set_claude_runtime(fake.runtime);
  const h = claude_harness([]);
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(init(), ...text_response("m1", "billed elsewhere"));
  await done;
  const message = transcript(h.events);
  assert.deepEqual(message.error, { kind: "claude_auth", message: "Claude Code would run on the bedrock API backend, the Claude plan runs only on the subscription login." });
  assert.equal(message.steps.some((step) => step.kind === "text"), false);
  assert.equal(ends(h.events).length, 1);
  assert.equal(fake.auth_failures(), 1);
});

const read_tool = make_tool("read", async () => ({ status: "done", text: "contents", view: null }));

const with_tools = (tools: string[]): SDKMessage => ({ ...init(), tools }) as SDKMessage;

test("Claude Code that starts with its own built-in tools ends the turn with claude_process before any round", async () => {
  const fake = fake_runtime(prefixes);
  set_claude_runtime(fake.runtime);
  const h = claude_harness([read_tool]);
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(with_tools(["read", "mcp__vantheax__read", "EndConversation", "Read", "Bash"]), ...text_response("m1", "read it myself"));
  await done;
  const message = transcript(h.events);
  assert.deepEqual(message.error, { kind: "claude_process", message: "Claude Code started with its own tools: Read, Bash" });
  assert.equal(message.steps.some((step) => step.kind === "text"), false);
  assert.equal(ends(h.events).length, 1);
});

test("Claude Code that lists only this app's tools and EndConversation runs the turn", async () => {
  const fake = fake_runtime(prefixes);
  set_claude_runtime(fake.runtime);
  const h = claude_harness([read_tool]);
  const done = run_claude_turn(h.session, h.input);
  const query = await fake.opened();
  query.send(with_tools(["read", "mcp__vantheax__read", "EndConversation"]), ...text_response("m1", "ok"), result());
  await done;
  assert.equal(transcript(h.events).status, "done");
});
