import assert from "node:assert/strict";
import { test } from "node:test";
import type { PermissionMode } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { Settings } from "../shared/settings.ts";
import { abort_turn, active_turn, drop_untaken_steers, push_steer, register_active, take_steer_active, unregister_active } from "../electron/turn/active.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import type { RoundResult } from "../electron/model/types.ts";
import type { TurnSession } from "../electron/turn/session.ts";
import type { Tool } from "../electron/tools/types.ts";
import { acknowledge_steer, dequeue, empty_composer, enqueue, queue_of, release_steers, set_steering } from "../src/state/chat-drafts.ts";
import { review_stub } from "./review-stub.ts";

const model: ModelEntry = { id: "m", label: "M", provider: "p", provider_order: [], efforts: [], default_effort: "", vision: false, context_length: 1000000, max_output: 4096, reasoning_passback: false };

const completed = (over: Partial<RoundResult>): RoundResult => ({
  status: "completed", content: "", reasoning: "", reasoning_details: [], tool_calls: [], finish_reason: "stop", usage: null, ...over,
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const harness = (chat_id: string, execute: Tool["execute"]) => {
  const events: StreamEventBody[] = [];
  let state = enqueue(empty_composer, chat_id, { id: "q1", text: "same text", attachments: [], plan: false, steering: false });
  state = enqueue(state, chat_id, { id: "q2", text: "same text", attachments: [], plan: false, steering: false });
  state = set_steering(state, chat_id, "q1", true, "s1", "m1");
  state = set_steering(state, chat_id, "q2", true, "s2", "m1");
  const turn = register_active(chat_id, "m1", (event) => {
    events.push(event);
    if (event.type === "steer" && event.steer_id) state = acknowledge_steer(state, chat_id, event.steer_id);
    if (event.type === "end") state = release_steers(state, chat_id, "m1");
  }, model, "high");
  const tool: Tool = { spec: { name: "held_tool", description: "", parameters: { type: "object", properties: {} } }, profiles: ["main"], available: () => true, execute };
  let calls = 0;
  const session: TurnSession = {
    compaction: { audience: "user", facts: async () => "" },
    chat_id, message_id: "m1", user_request: "go", project_root: "", settings: {} as Settings, model, effort: "", mode: "auto" as PermissionMode, plan: false,
    signal: turn.controller.signal, emit: turn.emit, stream: async () => ++calls === 1
      ? completed({ tool_calls: [{ index: 0, id: "p1", name: "held_tool", arguments: "{}" }], finish_reason: "tool_calls" })
      : completed({ content: "read both steers" }),
    resolve_tools: () => [tool], side_model: async () => "", review: review_stub(), wait_decision: async () => ({ approved: true, grant: "once", feedback: "" }),
    steers: {
      next: () => active_turn(chat_id)?.steers[0] ?? null,
      noted: async (steer) => steer.attachments,
      take: (steer_id) => {
        take_steer_active(chat_id, steer_id);
      },
    },
  };
  return { session, events, turn, state: () => state, calls: () => calls };
};

test("accepted steers keep their cards while a tool runs and remove the exact cards when adopted", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const h = harness("steer-adopt", async () => {
    await held;
    return { status: "done", text: "tool finished", view: null };
  });
  const messages = [{ role: "user" as const, content: "go" }];
  const done = run_turn_loop(h.session, messages);
  await settle();
  const pushed_from = Date.now();
  assert.equal(push_steer("steer-adopt", "same text", "s1"), true);
  assert.equal(push_steer("steer-adopt", "same text", "s1"), true);
  assert.equal(push_steer("steer-adopt", "same text", "s2"), true);
  const pushed_to = Date.now();
  assert.equal(h.events.some((event) => event.type === "steer"), false);
  assert.equal(queue_of(h.state(), "steer-adopt").length, 2);
  assert.ok(queue_of(h.state(), "steer-adopt").every((entry) => entry.steering));
  release?.();
  await done;
  assert.deepEqual(h.events.filter((event) => event.type === "steer").map((event) => event.type === "steer" ? event.steer_id : ""), ["s1", "s2"]);
  const stamps = h.events.flatMap((event) => (event.type === "steer" ? [event.pushed_at ?? 0] : []));
  assert.equal(stamps.length, 2);
  assert.ok(stamps.every((stamp) => stamp >= pushed_from && stamp <= pushed_to));
  assert.equal(queue_of(h.state(), "steer-adopt").length, 0);
  assert.equal(h.calls(), 2);
  assert.equal(push_steer("steer-adopt", "too late", "s3"), false);
  unregister_active("steer-adopt", "m1");
});

test("a stopped tool leaves unadopted steers available without automatically resending them", async () => {
  const h = harness("steer-stop", async (ctx) => {
    await new Promise<void>((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true }));
    return { status: "done", text: "", view: null };
  });
  const done = run_turn_loop(h.session, [{ role: "user", content: "go" }]);
  await settle();
  assert.equal(push_steer("steer-stop", "same text", "s1"), true);
  assert.equal(push_steer("steer-stop", "same text", "s2"), true);
  abort_turn("steer-stop", new Error("user stopped"));
  await done;
  const queue = queue_of(h.state(), "steer-stop");
  assert.equal(queue.length, 2);
  assert.ok(queue.every((entry) => !entry.steering && entry.steer_failed && entry.text === "same text"));
  assert.equal(dequeue(h.state(), "steer-stop").next, null);
  assert.equal(h.events.some((event) => event.type === "steer"), false);
  assert.equal(push_steer("steer-stop", "late", "s3"), false);
  unregister_active("steer-stop", "m1");
});

test("an ended or aborted turn refuses a steer even before its active record is removed", () => {
  const ended = register_active("steer-ended", "m1", () => undefined, model, "");
  ended.emit({ type: "end", status: "done", error: null });
  assert.equal(push_steer("steer-ended", "late", "s1"), false);
  unregister_active("steer-ended", "m1");
  register_active("steer-aborted", "m2", () => undefined, model, "");
  abort_turn("steer-aborted", new Error("stop"));
  assert.equal(push_steer("steer-aborted", "late", "s2"), false);
  unregister_active("steer-aborted", "m2");
});

test("untaken steers are logged once with their attachment ids and dropped from the turn", (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (line: string) => warnings.push(line));
  const turn = register_active("steer-left", "m1", () => undefined, model, "");
  const shot = { id: "img_left_9f8e7d6c.png", kind: "image" as const, name: "a.png", mime: "image/png", size: 1, vision_note: null };
  turn.steers.push({ id: "s1", text: "first", at: 1, attachments: [shot] }, { id: "s2", text: "second", at: 2, attachments: [] });
  drop_untaken_steers("steer-left", turn);
  drop_untaken_steers("steer-left", turn);
  assert.deepEqual(warnings, ["[turn] turn m1 in chat steer-left ended with steers it did not take: s1 (attachments: img_left_9f8e7d6c.png); s2 (attachments: none)"]);
  assert.equal(turn.steers.length, 0);
  unregister_active("steer-left", "m1");
});
