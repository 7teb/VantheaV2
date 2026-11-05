import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, UserMessage } from "../shared/chat.ts";
import { compaction_request } from "../electron/context/compact-text.ts";
import { image_left_out_text } from "../electron/context/images.ts";
import { trimmed_stub } from "../electron/context/trim.ts";
import { estimate_messages } from "../electron/context/usage.ts";
import { removed_output_stub } from "../electron/context/window.ts";
import { ModelError } from "../electron/model/errors.ts";
import type { ApiMessage, ApiToolMessage, ApiUserMessage } from "../electron/model/types.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_compaction_turn, run_turn_loop } from "../electron/turn/loop.ts";
import { api_call_id } from "../electron/turn/round.ts";
import { compaction_steps, counted, is_note_call, recording, setup, small, type Recorded } from "./turn-compaction-harness.ts";
import { completed, tool_call, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const wide = { ...small, context_length: 100_000 };

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-12T10:00:00.000Z" });

const assistant = (id: string, result: string): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:01.000Z",
  ended_at: "2026-10-12T10:00:05.000Z",
  status: "done",
  steps: [
    { id: `${id}-text`, round: 0, kind: "text", text: `turn ${id}` },
    {
      id: `${id}-tool`,
      round: 0,
      kind: "tool",
      index: 0,
      call_id: "c0_0",
      name: "read_file",
      args: { path: `${id}.ts` },
      status: "done",
      progress: null,
      approval: null,
      view: null,
      error: null,
      result_text: result,
      started_at: 1,
      ended_at: 2,
    },
  ],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 3,
});

const tool_round = (id: string, chars: number): ApiMessage[] => [
  { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }] },
  { role: "tool", tool_call_id: id, content: `${id}:${"x".repeat(chars)}` },
];

const tool_contents = (messages: ApiMessage[]) => messages.filter((message): message is ApiToolMessage => message.role === "tool").map((message) => message.content);

test("an old tool result replayed from the chat reaches the compaction call in full, with nothing but the request added", async () => {
  const old = `LOSS-CONTROL-613 ${"x".repeat(60_000)}`;
  const chat: Message[] = [user("u1", "a"), assistant("a1", old), user("u2", "b"), assistant("a2", "short"), user("u3", "c"), assistant("a3", "short")];
  const { calls, stream } = recording(() => completed({ content: "TASK: t" }));
  const { h } = setup(stream, "ok");
  h.session.model = { ...small, context_length: 1_000_000 };
  h.messages.splice(0, h.messages.length, ...(await build_api_messages({ system: "sys", summary: null, messages: chat, model: h.session.model, agent_tools: false })));
  const before = structuredClone(h.messages);
  await run_compaction_turn(h.session, h.messages);
  const sent = (calls[0] as Recorded).messages;
  assert.ok(sent.some((message) => message.role === "tool" && message.tool_call_id === api_call_id("a1", "c0_0") && message.content === old));
  assert.deepEqual(sent.slice(0, -1), before);
  assert.deepEqual(sent.at(-1), { role: "user", steer: true, content: compaction_request("user") });
});

test("a context between 70 and 90 percent of the window reaches the compaction call untrimmed", async () => {
  const { calls, stream } = recording((request) => (is_note_call(request) ? completed({ content: "TASK: t" }) : completed({ content: "fixed" })));
  const { h } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_big", 340_000));
  const full = tool_contents(h.messages)[0];
  await run_turn_loop(h.session, h.messages);
  const note = calls.find((call) => is_note_call(call.request)) as Recorded;
  assert.deepEqual(tool_contents(note.messages), [full]);
  assert.equal(note.messages.at(-1)?.content, compaction_request("user"));
  assert.equal(h.events.some((event) => event.type === "notice" && event.notice === "context_trimmed"), false);
});

test("a newest round above the recent budget survives compaction whole and its size does not compact again", async () => {
  let working = 0;
  const { calls, stream } = recording((request) => {
    if (is_note_call(request)) {
      return completed({ content: "TASK: t" });
    }
    working += 1;
    return working === 1 ? completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls" }) : completed({ content: "fixed" });
  });
  const { h } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_big", 300_000));
  const full = tool_contents(h.messages)[0];
  await run_turn_loop(h.session, h.messages);
  assert.equal(calls.filter((call) => is_note_call(call.request)).length, 1);
  assert.equal(calls.length, 3);
  const after = (calls[1] as Recorded).messages;
  assert.deepEqual(tool_contents(after), [full]);
  assert.ok(estimate_messages(after) > wide.context_length * 0.7);
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["done"]);
});

test("a compaction request above 90 percent of the window that still fits goes out whole, so the cached prefix stays intact", async () => {
  const { calls, stream } = recording((request) => (is_note_call(request) ? completed({ content: "TASK: t" }) : completed({ content: "fixed" })));
  const { h } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_big", 380_000));
  const full = tool_contents(h.messages)[0];
  await run_turn_loop(h.session, h.messages);
  const notes = calls.filter((call) => is_note_call(call.request));
  assert.equal(notes.length, 1);
  assert.deepEqual(tool_contents((notes[0] as Recorded).messages), [full]);
  assert.equal((notes[0] as Recorded).messages.at(-1)?.content, compaction_request("user"));
  assert.ok(estimate_messages((notes[0] as Recorded).messages) > wide.context_length * 0.9);
});

test("a note cut off for lack of room is asked for again without the oldest outputs, leaving a tenth of the window", async () => {
  let note_calls = 0;
  const { calls, stream } = recording((request) => {
    if (!is_note_call(request)) {
      return completed({ content: "fixed" });
    }
    note_calls += 1;
    return note_calls === 1 ? completed({ content: "TASK: t\nSTATE: cut", finish_reason: "length" }) : completed({ content: "TASK: t\nNEXT: n" });
  });
  const { h, saved } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_big", 380_000));
  const full = tool_contents(h.messages)[0];
  await run_turn_loop(h.session, h.messages);
  const notes = calls.filter((call) => is_note_call(call.request)) as Recorded[];
  assert.equal(notes.length, 2);
  assert.deepEqual(tool_contents(notes[0]?.messages ?? []), [full]);
  assert.deepEqual(tool_contents(notes[1]?.messages ?? []), [removed_output_stub]);
  assert.equal(notes[1]?.messages.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "c_big" }]));
  assert.ok(estimate_messages(notes[1]?.messages ?? []) <= wide.context_length * 0.9);
  assert.equal(saved[0]?.note, "TASK: t\nNEXT: n");
});

test("a compaction request over the window drops only the oldest outputs it has to and lists them, the chat context keeps them", async () => {
  const { calls, stream } = recording(() => completed({ content: "TASK: t" }));
  const { h } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_1", 160_000), ...tool_round("c_2", 160_000), ...tool_round("c_3", 120_000));
  const originals = h.messages.filter((message): message is ApiToolMessage => message.role === "tool");
  const full = originals.map((message) => message.content);
  await run_compaction_turn(h.session, h.messages);
  const sent = (calls[0] as Recorded).messages;
  assert.deepEqual(tool_contents(sent), [removed_output_stub, full[1], full[2]]);
  assert.equal(sent.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "c_1" }]));
  assert.match(String(sent.at(-1)?.content), /\n- read_file \(c_1\)\n\nDo not call tools\. Reply with the note only\.$/);
  assert.deepEqual(originals.map((message) => message.content), full);
});

for (const ratio of [1.2, 1]) {
  test(`a main request over the window drops its oldest outputs with a notice, measured from the provider's count (ratio ${ratio})`, async () => {
    const output = "z".repeat(52_000);
    const { calls, stream } = recording((request, call) => {
      if (is_note_call(request)) {
        throw new ModelError("context_limit", "too long", 400);
      }
      if (call === 2 || call === 3) {
        return completed({ tool_calls: [tool_call("read_file")], finish_reason: "tool_calls", usage: counted(request, ratio) });
      }
      return completed({ content: "done" });
    });
    const { h } = setup(stream, output);
    h.session.model = { ...small, context_length: 30_000 };
    h.messages.push(...tool_round("c_1", 120_000), ...tool_round("c_2", 120_000));
    await run_turn_loop(h.session, h.messages);
    assert.equal(calls.length, 4);
    const window_notices = h.events.filter((event, index) => event.type === "notice" && event.notice === "context_trimmed" && h.events[index - 1]?.type === "context");
    const fallback_notices = h.events.filter((event, index) => event.type === "notice" && event.notice === "context_trimmed" && h.events[index - 1]?.type === "compaction");
    assert.equal(window_notices.length + fallback_notices.length, h.events.filter((event) => event.type === "notice" && event.notice === "context_trimmed").length);
    assert.ok(h.events.every((event) => event.type !== "notice" || event.text === ""));
    assert.equal(window_notices.length, ratio > 1 ? 1 : 0);
    assert.deepEqual(tool_contents((calls[2] as Recorded).messages), [trimmed_stub, trimmed_stub, output]);
    assert.deepEqual(tool_contents((calls[3] as Recorded).messages), [trimmed_stub, trimmed_stub, ratio > 1 ? removed_output_stub : output, output]);
  });
}

test("a compaction request the provider rejects as too long loses the next oldest output per rejection and lists it, the chat context keeps it", async () => {
  let rejections = 0;
  const { calls, stream } = recording(() => {
    if (rejections < 2) {
      rejections += 1;
      throw new ModelError("context_limit", "too long", 400);
    }
    return completed({ content: "TASK: t" });
  });
  const { h, sleeps } = setup(stream, "ok");
  h.session.model = wide;
  h.messages.push(...tool_round("c_1", 40_000), ...tool_round("c_2", 40_000), ...tool_round("c_3", 40_000));
  const originals = h.messages.filter((message): message is ApiToolMessage => message.role === "tool");
  const full = originals.map((message) => message.content);
  await run_compaction_turn(h.session, h.messages);
  const sent = calls.map((call) => call.messages);
  assert.equal(sent.length, 3);
  assert.deepEqual(tool_contents(sent[0] ?? []), full);
  assert.equal(sent[0]?.at(-1)?.content, compaction_request("user"));
  assert.deepEqual(tool_contents(sent[1] ?? []), [removed_output_stub, full[1], full[2]]);
  assert.equal(sent[1]?.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "c_1" }]));
  assert.deepEqual(tool_contents(sent[2] ?? []), [removed_output_stub, removed_output_stub, full[2]]);
  assert.equal(sent[2]?.at(-1)?.content, compaction_request("user", [{ tool: "read_file", call_id: "c_1" }, { tool: "read_file", call_id: "c_2" }]));
  assert.deepEqual(sleeps, []);
  assert.deepEqual(compaction_steps(h).map((step) => step.status), ["done"]);
  assert.deepEqual(h.events.flatMap((event) => (event.type === "compaction" && event.status === "running" ? [event.attempt] : [])), [1]);
  assert.deepEqual(originals.map((message) => message.content), full);
});

const png_url = (width: number, height: number) => {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return `data:image/png;base64,${head.toString("base64")}`;
};

test("an image left out only for the compaction request stays in the chat context", async () => {
  const shot: ApiUserMessage = { role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: png_url(9000, 100) } }] };
  const kinds = () => (Array.isArray(shot.content) ? shot.content.map((part) => part.type) : []);
  const during: string[][] = [];
  const { calls, stream } = recording(() => {
    during.push(kinds());
    return completed({ content: "TASK: t" });
  });
  const { h } = setup(stream, "ok");
  h.session.model = { ...wide, id: "anthropic/claude-x", provider_order: ["anthropic"] };
  h.messages.push(shot);
  await run_compaction_turn(h.session, h.messages);
  const copy = (calls[0] as Recorded).messages.find((message) => message.role === "user" && Array.isArray(message.content));
  assert.deepEqual(copy?.content, [{ type: "text", text: "see" }, { type: "text", text: image_left_out_text }]);
  assert.deepEqual(during, [["text", "image_url"]]);
});
