import assert from "node:assert/strict";
import { test } from "node:test";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import type { CompactionRecord, TurnSession } from "../electron/turn/session.ts";
import { run_claude_turn, type ClaudeTurnInput } from "../electron/turn/claude/drive.ts";
import { claude_harness, ends, error_result, fake_runtime, init, open_steps, result, settle, system, text_response, transcript, until, type FakeQuery } from "./claude-turn-kit.ts";

const stored = { session_id: "sess-1", cwd: "C:/project", through_message_id: "prev-turn" };

const begin = (over: Partial<TurnSession> = {}, input: Partial<ClaudeTurnInput> = {}) => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness([], over, input);
  const done = run_claude_turn(h.session, h.input);
  return { fake, h, done };
};

const post_compact = async (query: FakeQuery, summary: string) => {
  const matcher = query.options.hooks?.PostCompact?.[0];
  assert.ok(matcher);
  const input = { hook_event_name: "PostCompact", trigger: "auto", compact_summary: summary, session_id: "sess-1", transcript_path: "t", cwd: "C:/project" } as HookInput;
  return matcher.hooks[0](input, undefined, { signal: new AbortController().signal });
};

test("Claude Code's automatic compaction shows as the compaction line and its summary is saved through the last round", async () => {
  const saved: CompactionRecord[] = [];
  const { fake, h, done } = begin({ compaction: { audience: "user", facts: async () => "facts", save: async (record) => void saved.push(record) } });
  const query = await fake.opened();
  query.send(init(), ...text_response("m1", "first round", "tool_use"));
  await until(() => h.events.some((event) => event.type === "usage"), "first round");
  query.send(system("status", { status: "compacting" }));
  await until(() => h.events.some((event) => event.type === "compaction"), "compaction start");
  assert.deepEqual(await post_compact(query, "Summary of the work"), {});
  query.send(system("compact_boundary", { compact_metadata: { trigger: "auto", pre_tokens: 950_000, post_tokens: 40_000 } }), system("status", { status: null, compact_result: "success" }), ...text_response("m2", "after"), result());
  await done;
  assert.deepEqual(saved, [{ note: "Summary of the work", facts: "facts", through_round: 0 }]);
  const compactions = h.events.filter((event) => event.type === "compaction");
  assert.deepEqual(compactions, [
    { type: "compaction", round: 1, status: "running", source: "auto" },
    { type: "compaction", round: 1, status: "done", source: "auto" },
  ]);
  const after = h.events.findIndex((event) => event.type === "compaction" && event.status === "done");
  assert.deepEqual(h.events[after + 1], { type: "context", usage: { used: 40_000, limit: 1_000_000, floor: 0 } });
  assert.equal(transcript(h.events).status, "done");
});

test("a failing automatic compaction shows failed with Claude Code's text and the turn goes on", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), system("status", { status: "compacting" }), system("status", { status: null, compact_result: "failed", compact_error: "Conversation too long to summarise" }), ...text_response("m1", "ok"), result());
  await done;
  assert.deepEqual(h.events.filter((event) => event.type === "compaction").at(-1), {
    type: "compaction",
    round: 0,
    status: "failed",
    source: "auto",
    error: { kind: "internal", message: "Conversation too long to summarise" },
  });
  assert.equal(transcript(h.events).status, "done");
});

test("a save that fails inside the PostCompact hook is logged and does not break the hook", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);
  const { fake, done } = begin({ compaction: { audience: "user", facts: async () => "", save: async () => Promise.reject(new Error("disk full")) } });
  const query = await fake.opened();
  assert.deepEqual(await post_compact(query, "x"), {});
  assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes("saving the compaction summary")));
  query.send(init(), ...text_response("m1", "ok"), result());
  await done;
});

test("manual compaction needs a resumable session and otherwise ends failed without starting Claude Code", async () => {
  const { fake, h, done } = begin({}, { compact_only: true });
  await done;
  assert.equal(fake.queries.length, 0);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error: { kind: "internal", message: "This chat has no Claude Code session to compact." } }]);
});

test("manual compaction resumes the session, sends /compact as a command and ends done at the boundary", async () => {
  const saved: CompactionRecord[] = [];
  const { fake, h, done } = begin({ compaction: { audience: "user", facts: async () => "f", save: async (record) => void saved.push(record) } }, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  const pushed = await query.next_push();
  assert.equal(pushed.message.content, "/compact");
  assert.equal(pushed.client_composed, undefined);
  assert.equal(query.options.resume, "sess-1");
  query.send(init(), system("status", { status: "compacting" }));
  await until(() => h.events.some((event) => event.type === "compaction"), "manual compaction");
  await post_compact(query, "Manual summary");
  query.send(system("compact_boundary", { compact_metadata: { trigger: "manual", pre_tokens: 200_000 } }), result({ result: "" }));
  await done;
  assert.deepEqual(saved, [{ note: "Manual summary", facts: "f", through_round: -1 }]);
  assert.deepEqual(h.events.filter((event) => event.type === "compaction"), [
    { type: "compaction", round: 0, status: "running", source: "manual" },
    { type: "compaction", round: 0, status: "done", source: "manual" },
  ]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("manual compaction without a boundary ends failed with the compaction line failed", async () => {
  const { fake, h, done } = begin({}, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  query.send(init(), result({ result: "Nothing to compact" }));
  await done;
  const error = { kind: "internal", message: "Claude Code finished /compact without compacting the conversation." };
  assert.deepEqual(h.events.filter((event) => event.type === "compaction"), [{ type: "compaction", round: 0, status: "failed", source: "manual", error }]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error }]);
  assert.deepEqual(open_steps(h.events), []);
});

test("manual compaction that hits a login error carries that kind into the compaction line and the end", async () => {
  const { fake, h, done } = begin({}, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  query.send(init(), error_result({ errors: ["Not logged in · Please run /login"] }));
  await done;
  const error = { kind: "claude_auth", message: "Not logged in · Please run /login" };
  assert.deepEqual(h.events.find((event) => event.type === "compaction"), { type: "compaction", round: 0, status: "failed", source: "manual", error });
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error }]);
  assert.equal(fake.auth_failures(), 1);
});

test("a manual compaction of a session Claude Code no longer has ends failed with no session", async () => {
  const { fake, h, done } = begin({}, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  query.send(error_result({ errors: ["No conversation found with session ID: sess-1"] }));
  await done;
  assert.equal(fake.queries.length, 1);
  assert.deepEqual(fake.deleted, [{ session_id: "sess-1", cwd: "C:/project" }]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error: { kind: "internal", message: "This chat has no Claude Code session to compact." } }]);
});

const manual_saved = () => {
  const saved: CompactionRecord[] = [];
  return { saved, over: { compaction: { audience: "user" as const, facts: async () => "f", save: async (record: CompactionRecord) => void saved.push(record) } } };
};

const boundary = () => system("compact_boundary", { compact_metadata: { trigger: "manual", pre_tokens: 200_000 } });

test("manual compaction ends done once the boundary and then the PostCompact summary arrived, without a result", async () => {
  const { saved, over } = manual_saved();
  const { fake, h, done } = begin(over, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), system("status", { status: "compacting" }), boundary());
  await until(() => h.events.some((event) => event.type === "compaction" && event.status === "done"), "boundary");
  await settle();
  assert.deepEqual(ends(h.events), []);
  await post_compact(query, "Summary after the boundary");
  await done;
  assert.deepEqual(saved.map((record) => record.note), ["Summary after the boundary"]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("manual compaction ends done at the boundary when the PostCompact summary came first, without a result", async () => {
  const { saved, over } = manual_saved();
  const { fake, h, done } = begin(over, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), system("status", { status: "compacting" }));
  await until(() => h.events.some((event) => event.type === "compaction"), "compaction start");
  await post_compact(query, "Summary before the boundary");
  await settle();
  assert.deepEqual(ends(h.events), []);
  query.send(boundary());
  await done;
  assert.deepEqual(saved.map((record) => record.note), ["Summary before the boundary"]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "done", error: null }]);
});

test("a manual compaction that Claude Code reports failed ends the turn failed without waiting for a result", async () => {
  const { fake, h, done } = begin({}, { compact_only: true, stored, previous_turn_id: "prev-turn" });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), system("status", { status: "compacting" }), system("status", { status: null, compact_result: "failed", compact_error: "Conversation too long to summarise" }));
  await done;
  const error = { kind: "internal", message: "Conversation too long to summarise" };
  assert.deepEqual(h.events.filter((event) => event.type === "compaction"), [
    { type: "compaction", round: 0, status: "running", source: "manual" },
    { type: "compaction", round: 0, status: "failed", source: "manual", error },
  ]);
  assert.deepEqual(ends(h.events), [{ type: "end", status: "failed", error }]);
  assert.deepEqual(open_steps(h.events), []);
});
