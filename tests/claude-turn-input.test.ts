import assert from "node:assert/strict";
import { test } from "node:test";
import type { SteerMessage } from "../shared/chat.ts";
import { set_claude_runtime } from "../electron/claude/runtime.ts";
import type { Tool } from "../electron/tools/types.ts";
import type { TurnNote, TurnSession } from "../electron/turn/session.ts";
import { continuation_text, steer_prefix } from "../electron/turn/user-input.ts";
import { run_claude_turn } from "../electron/turn/claude/drive.ts";
import { handoff_footer, handoff_header } from "../electron/turn/claude/handoff.ts";
import type { ClaudeTurnInput } from "../electron/turn/claude/drive.ts";
import {
  claude_harness,
  ends,
  fake_runtime,
  init,
  make_tool,
  rate_limit,
  result,
  settle,
  start,
  test_hooks,
  text_response,
  tool_response,
} from "./claude-turn-kit.ts";

const begin = (tools: Tool[] = [], over: Partial<TurnSession> = {}, input: Partial<ClaudeTurnInput> = {}) => {
  const fake = fake_runtime();
  set_claude_runtime(fake.runtime);
  const h = claude_harness(tools, over, input);
  const done = run_claude_turn(h.session, h.input);
  return { fake, h, done };
};

const note = (text: string): TurnNote => ({ kind: "notice", notice: "agent_report", text, content: `NOTE ${text}` });

const steer_source = (steers: SteerMessage[]) => ({
  next: () => steers[0] ?? null,
  noted: async () => [],
  take: (steer_id: string) => {
    const at = steers.findIndex((steer) => steer.id === steer_id);
    steers.splice(at, 1);
  },
});

const block_texts = (content: unknown): string[] => (Array.isArray(content) ? content.flatMap((block: { type: string; text?: string }) => (block.type === "text" && block.text ? [block.text] : [])) : []);

test("the first message of a new session carries the hand-over, the fresh message and the opening notes in one SDK message", async () => {
  let taken = 0;
  const api_messages = [
    { role: "system" as const, content: "system prompt" },
    { role: "user" as const, content: "earlier question" },
    { role: "assistant" as const, content: "earlier answer", tool_calls: [{ id: "call_x", type: "function" as const, function: { name: "read", arguments: '{"path":"a"}' } }] },
    { role: "tool" as const, tool_call_id: "call_x", content: "file a" },
    { role: "user" as const, content: [{ type: "text" as const, text: "look at this" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }] },
  ];
  const { fake, h, done } = begin([], {
    hooks: test_hooks({ start: async () => [note("hook start")] }),
    take_notes: () => (taken++ === 0 ? [note("agent done")] : []),
  }, { api_messages, fresh_count: 1 });
  const query = await fake.opened();
  const first = await query.next_push();
  assert.equal(first.priority, undefined);
  assert.equal(first.client_composed, true);
  assert.equal(first.parent_tool_use_id, null);
  assert.equal(typeof first.uuid, "string");
  const content = first.message.content;
  assert.ok(Array.isArray(content));
  assert.equal(content.length, 5);
  assert.equal(content[0].type === "text" && content[0].text, [handoff_header, "USER: earlier question", "ASSISTANT: earlier answer", 'TOOL CALL read {"path":"a"}', "TOOL RESULT read: file a", handoff_footer].join("\n\n"));
  assert.deepEqual(content.slice(1), [
    { type: "text", text: "look at this" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "text", text: "NOTE hook start" },
    { type: "text", text: "NOTE agent done" },
  ]);
  assert.equal(query.options.title, "Chat title");
  query.send(init(), ...text_response("m1", "ok"), result());
  await done;
  assert.deepEqual(h.events.filter((event) => event.type === "notice").map((event) => event.type === "notice" && event.text), ["hook start", "agent done"]);
  assert.deepEqual(h.api_messages.slice(5, 7), [{ role: "user", content: "NOTE hook start" }, { role: "user", content: "NOTE agent done" }]);
});

test("a resumed session gets no hand-over, only the fresh message", async () => {
  const api_messages = [
    { role: "system" as const, content: "system prompt" },
    { role: "user" as const, content: "earlier" },
    { role: "assistant" as const, content: "before" },
    { role: "user" as const, content: "next question" },
  ];
  const { fake, done } = begin([], {}, { api_messages, stored: { session_id: "s-old", cwd: "C:/project", through_message_id: "prev" }, previous_turn_id: "prev" });
  const query = await fake.opened();
  const first = await query.next_push();
  assert.deepEqual(first.message.content, [{ type: "text", text: "next question" }]);
  assert.equal(query.options.resume, "s-old");
  assert.equal(query.options.title, undefined);
  query.send(init("s-old"), ...text_response("m1", "ok"), result());
  await done;
});

test("a steer queued during a tool call goes out after the handler with priority next and holds the result until acknowledged", async () => {
  const steers: SteerMessage[] = [];
  const read = make_tool("read", async () => {
    steers.push({ id: "steer-1", text: "use the other file", at: 7, attachments: [] });
    return { status: "done", text: "content", view: null };
  });
  const { fake, h, done } = begin([read], { steers: steer_source(steers) });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "read", input: { path: "a" } }]));
  await query.call("read", { path: "a" }, "tu-1");
  const steer = await query.next_push();
  assert.equal(steer.priority, "next");
  assert.equal(steer.client_composed, true);
  assert.deepEqual(block_texts(steer.message.content), [`${steer_prefix}\n\nuse the other file`]);
  assert.deepEqual(h.events.find((event) => event.type === "steer"), { type: "steer", round: 1, text: "use the other file", pushed_at: 7, steer_id: "steer-1" });
  query.send(...text_response("m2", "first answer"), result());
  await settle();
  assert.equal(ends(h.events).length, 0);
  query.send(start("m3", {}, [String(steer.uuid)]), ...text_response("m3", "answer to the steer").slice(1), result());
  await done;
  assert.equal(ends(h.events)[0].type === "end" && ends(h.events)[0].status, "done");
  const order = h.api_messages.slice(2).map((message) => message.role);
  assert.deepEqual(order, ["assistant", "tool", "user", "assistant", "assistant"]);
});

test("an acknowledgement carried only by the result releases the held turn", async () => {
  const steers: SteerMessage[] = [];
  const read = make_tool("read", async () => {
    steers.push({ id: "steer-2", text: "one more thing", at: 1, attachments: [] });
    return { status: "done", text: "content", view: null };
  });
  const { fake, h, done } = begin([read], { steers: steer_source(steers) });
  const query = await fake.opened();
  query.send(init(), ...tool_response("m1", [{ id: "tu-1", name: "read", input: {} }]));
  await query.call("read", {}, "tu-1");
  await query.next_push();
  const steer = await query.next_push();
  query.send(...text_response("m2", "folded in"), result({ user_message_uuids: [steer.uuid] }));
  await done;
  assert.equal(ends(h.events).length, 1);
});

test("a result with queued turns keeps reading until the queue is empty", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  query.send(init(), ...text_response("m1", "one"), result({ queued_turn_count: 1 }));
  await settle();
  assert.equal(ends(h.events).length, 0);
  query.send(...text_response("m2", "two"), result({ queued_turn_count: 0 }));
  await done;
  assert.deepEqual(h.events.filter((event) => event.type === "text").map((event) => event.type === "text" && `${event.round}:${event.delta}`), ["0:one", "1:two"]);
});

test("an idle wait that brings input continues the turn with that input", async () => {
  let idle_calls = 0;
  let notes: TurnNote[] = [];
  const { fake, h, done } = begin([], {
    idle: async () => {
      idle_calls += 1;
      if (idle_calls === 1) {
        notes = [note("agent finished")];
        return true;
      }
      return false;
    },
    take_notes: () => notes.splice(0),
  });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...text_response("m1", "waiting for the agent"), result());
  const pushed = await query.next_push();
  assert.deepEqual(block_texts(pushed.message.content), ["NOTE agent finished"]);
  assert.equal(pushed.priority, "next");
  query.send(...text_response("m2", "agent result read"), result({ user_message_uuids: [pushed.uuid] }));
  await done;
  assert.equal(idle_calls, 2);
  assert.equal(ends(h.events).length, 1);
});

test("a finished answer ends the turn when notes arrive after it and the idle wait brings nothing", { timeout: 5000 }, async () => {
  let note_calls = 0;
  let idle_calls = 0;
  const { fake, h, done } = begin([], {
    idle: async () => {
      idle_calls += 1;
      return false;
    },
    take_notes: () => (note_calls++ === 0 ? [] : [note("agent roster changed")]),
  });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...text_response("m1", "final report"), result());
  await done;
  assert.equal(query.pushed.length, 1);
  assert.equal(idle_calls, 1);
  assert.equal(ends(h.events).length, 1);
  assert.equal(ends(h.events)[0].type === "end" && ends(h.events)[0].status, "done");
  assert.deepEqual(h.events.filter((event) => event.type === "notice"), []);
});

test("a Stop hook that asks to continue sends its note and the turn reads on", async () => {
  let stops = 0;
  const hooks = test_hooks({
    stop: async (round, last_text, active) => {
      stops += 1;
      assert.equal(round, stops - 1);
      assert.equal(active, stops === 2);
      if (stops === 1) {
        assert.equal(last_text, "first try");
        return { kind: "continue", note: { kind: "steer", text: "run the tests", content: "STOP HOOK run the tests" } };
      }
      return { kind: "end" };
    },
  });
  const { fake, h, done } = begin([], { hooks });
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...text_response("m1", "first try"), result());
  const pushed = await query.next_push();
  assert.deepEqual(block_texts(pushed.message.content), ["STOP HOOK run the tests"]);
  query.send(...text_response("m2", "tests pass"), result({ user_message_uuids: [pushed.uuid] }));
  await done;
  assert.equal(stops, 2);
  assert.deepEqual(h.events.find((event) => event.type === "steer"), { type: "steer", round: 1, text: "run the tests" });
});

test("an answer cut by the output limit gets the notice and the continuation message", async () => {
  const { fake, h, done } = begin();
  const query = await fake.opened();
  await query.next_push();
  query.send(init(), ...text_response("m1", "long answer", "max_tokens"), result({ stop_reason: "max_tokens" }));
  const pushed = await query.next_push();
  assert.deepEqual(block_texts(pushed.message.content), [continuation_text]);
  assert.deepEqual(h.events.find((event) => event.type === "notice"), { type: "notice", round: 0, notice: "output_limit", text: "" });
  query.send(...text_response("m2", "the rest"), result({ user_message_uuids: [pushed.uuid] }));
  await done;
  assert.deepEqual(h.api_messages.slice(2).map((message) => message.role === "user" ? message.content : message.role), ["assistant", continuation_text, "assistant"]);
});

test("extra usage on the subscription ends the turn with the plan limit error instead of spending credits", async () => {
  for (const info of [{ status: "allowed_warning", isUsingOverage: true }, { status: "rejected", overageInUse: true }] as const) {
    const { fake, h, done } = begin();
    const query = await fake.opened();
    query.send(init(), rate_limit(info), ...text_response("m1", "ok"), result());
    await done;
    const [end] = ends(h.events);
    assert.equal(end?.type === "end" ? end.error?.kind : null, "claude_limit", JSON.stringify(info));
    assert.match(end?.type === "end" ? (end.error?.message ?? "") : "", /extra usage credits/);
    assert.deepEqual(h.events.filter((event) => event.type === "notice"), []);
  }
});
