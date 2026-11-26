import assert from "node:assert/strict";
import { test } from "node:test";
import type { UserMessage } from "../shared/chat.ts";
import type { ApiAssistantMessage, RoundRequest } from "../electron/model/types.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { completed, harness, make_tool, model, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

const look = make_tool("look", async () => ({ status: "done", text: "seen", view: null }));

const one_call = (raw: string) => {
  const requests: RoundRequest[] = [];
  const h = harness(async (request) => {
    requests.push({ ...request, messages: [...request.messages] });
    if (requests.length === 1) {
      return completed({ tool_calls: [{ index: 0, id: "p0", name: "look", arguments: raw }], finish_reason: "tool_calls" });
    }
    return completed({ content: "done" });
  }, [look]);
  return { h, requests };
};

const sent_calls = (messages: RoundRequest["messages"]) =>
  messages.filter((message): message is ApiAssistantMessage => message.role === "assistant").flatMap((message) => message.tool_calls ?? []);

const user: UserMessage = { id: "u1", role: "user", text: "go", attachments: [], origin: "user", created_at: "2026-11-22T10:00:00.000Z" };

test("every round of a turn carries the session's cache key, and a session without one sends none", async () => {
  const keyed = one_call("{}");
  keyed.h.session.cache_key = "chat-1";
  await run_turn_loop(keyed.h.session, keyed.h.messages);
  assert.deepEqual(
    keyed.requests.map((request) => request.cache_key),
    ["chat-1", "chat-1"],
  );
  const plain = one_call("{}");
  await run_turn_loop(plain.h.session, plain.h.messages);
  assert.deepEqual(
    plain.requests.map((request) => "cache_key" in request),
    [false, false],
  );
});

test("the next turn replays a tool call with the exact argument string the model sent", async () => {
  const raw = '{"path": "a.txt", "note": "caf\\u00e9"}';
  const { h, requests } = one_call(raw);
  await run_turn_loop(h.session, h.messages);
  const during = sent_calls(requests[1].messages);
  assert.equal(during[0]?.function.arguments, raw);
  const message = transcript(h.events);
  const step = message.steps.find((entry) => entry.kind === "tool");
  assert.ok(step?.kind === "tool");
  assert.equal(step.arguments, raw);
  assert.deepEqual(step.args, { path: "a.txt", note: "café" });
  const later = await build_api_messages({ system: "s", summary: null, messages: [user, message], model, agent_tools: false });
  assert.deepEqual(sent_calls(later), during);
});

test("a compact argument string is not stored twice and replays from the parsed arguments", async () => {
  const raw = '{"path":"a.txt"}';
  const { h, requests } = one_call(raw);
  await run_turn_loop(h.session, h.messages);
  const message = transcript(h.events);
  const step = message.steps.find((entry) => entry.kind === "tool");
  assert.ok(step?.kind === "tool");
  assert.equal("arguments" in step, false);
  const later = await build_api_messages({ system: "s", summary: null, messages: [user, message], model, agent_tools: false });
  assert.deepEqual(sent_calls(later), sent_calls(requests[1].messages));
});
