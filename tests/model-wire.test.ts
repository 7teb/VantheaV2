import assert from "node:assert/strict";
import { test } from "node:test";
import { wire_messages, type ApiAssistantMessage, type ApiMessage } from "../electron/model/types.ts";

const reasoning = [{ type: "reasoning.text", text: "thinking" }];

const call = (id: string) => ({ id, type: "function" as const, function: { name: "read_file", arguments: "{}" } });

const assistants = (messages: ApiMessage[]) => messages.filter((message): message is ApiAssistantMessage => message.role === "assistant");

test("reasoning stays only on assistant messages after the last user message", () => {
  const messages: ApiMessage[] = [
    { role: "system", content: "s" },
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("a")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "a", content: "ok" },
    { role: "user", content: "steer" },
    { role: "assistant", content: null, tool_calls: [call("b")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "b", content: "ok" },
  ];
  const wired = assistants(wire_messages(messages, false));
  assert.equal(wired.length, 2);
  assert.equal("reasoning_details" in (wired[0] ?? {}), false);
  assert.deepEqual(wired[1]?.reasoning_details, reasoning);
});

test("plain reasoning text follows the same last-user rule as reasoning_details", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: "a", tool_calls: [call("a")], reasoning: "first" },
    { role: "tool", tool_call_id: "a", content: "ok" },
    { role: "user", content: "steer" },
    { role: "assistant", content: "b", tool_calls: [call("b")], reasoning: "second" },
    { role: "tool", tool_call_id: "b", content: "ok" },
  ];
  const wired = assistants(wire_messages(messages, false));
  assert.equal("reasoning" in (wired[0] ?? {}), false);
  assert.equal(wired[1]?.reasoning, "second");
});

test("a passback model gets a non-empty reasoning on current-turn assistant messages that had none", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "old task" },
    { role: "assistant", content: null, tool_calls: [call("a")] },
    { role: "tool", tool_call_id: "a", content: "ok" },
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("b")], reasoning: "" },
    { role: "tool", tool_call_id: "b", content: "ok" },
    { role: "assistant", content: null, tool_calls: [call("c")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "c", content: "ok" },
  ];
  const passback = assistants(wire_messages(messages, true));
  assert.equal("reasoning" in (passback[0] ?? {}), false);
  assert.equal(passback[1]?.reasoning, " ");
  assert.equal("reasoning" in (passback[2] ?? {}), false);
  assert.deepEqual(passback[2]?.reasoning_details, reasoning);
  const plain = assistants(wire_messages(messages, false));
  assert.equal("reasoning" in (plain[1] ?? {}), false);
});

test("a passback model keeps reasoning of earlier turns, other models drop it", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "old task" },
    { role: "assistant", content: null, tool_calls: [call("a")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "a", content: "ok" },
    { role: "assistant", content: "done", reasoning: "wrapped up" },
    { role: "user", content: "next" },
  ];
  const passback = assistants(wire_messages(messages, true));
  assert.deepEqual(passback[0]?.reasoning_details, reasoning);
  assert.equal(passback[1]?.reasoning, "wrapped up");
  const plain = assistants(wire_messages(messages, false));
  assert.equal("reasoning_details" in (plain[0] ?? {}), false);
  assert.equal("reasoning" in (plain[1] ?? {}), false);
});

test("assistant messages with neither content nor tool calls are not sent", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: null, reasoning_details: reasoning },
    { role: "user", content: "Continue." },
  ];
  assert.deepEqual(
    wire_messages(messages, false).map((message) => message.role),
    ["user", "user"],
  );
});

test("empty tool_calls arrays are dropped from the wire", () => {
  const wired = wire_messages(
    [
      { role: "user", content: "task" },
      { role: "assistant", content: "answer", tool_calls: [] },
    ],
    false,
  );
  assert.equal("tool_calls" in (wired[1] ?? {}), false);
});

const carrier_message = (label: string): ApiMessage => ({
  role: "user",
  tool_images: true,
  content: [
    { type: "text", text: label },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
  ],
});

test("a screenshot carrier keeps the current turn's reasoning for a non-passback model", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("a")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "a", content: "shot" },
    carrier_message("[Screenshot s1]"),
    { role: "assistant", content: null, tool_calls: [call("b")], reasoning: "second" },
    { role: "tool", tool_call_id: "b", content: "ok" },
  ];
  const wired = wire_messages(messages, false);
  const kept = assistants(wired);
  assert.deepEqual(kept[0]?.reasoning_details, reasoning);
  assert.equal(kept[1]?.reasoning, "second");
});

test("the carrier flag never reaches the wire and the image parts stay in order", () => {
  const wired = wire_messages([{ role: "user", content: "task" }, carrier_message("[Screenshot s1]")], false);
  assert.equal("tool_images" in (wired[1] ?? {}), false);
  assert.deepEqual(wired[1], { role: "user", content: [{ type: "text", text: "[Screenshot s1]" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }] });
});

test("a real user message after a carrier still starts a new turn", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("a")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "a", content: "shot" },
    carrier_message("[Screenshot s1]"),
    { role: "assistant", content: "done", reasoning: "wrapped" },
    { role: "user", content: "next task" },
    { role: "assistant", content: null, tool_calls: [call("b")], reasoning: "fresh" },
  ];
  const kept = assistants(wire_messages(messages, false));
  assert.equal("reasoning_details" in (kept[0] ?? {}), false);
  assert.equal("reasoning" in (kept[1] ?? {}), false);
  assert.equal(kept[2]?.reasoning, "fresh");
});

test("replayed carriers of earlier turns do not move the current turn for a passback model", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: null, tool_calls: [call("a")] },
    { role: "tool", tool_call_id: "a", content: "shot" },
    carrier_message("[Screenshot s0]"),
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("b")] },
    { role: "tool", tool_call_id: "b", content: "shot" },
    carrier_message("[Screenshot s1]"),
    { role: "assistant", content: null, tool_calls: [call("c")] },
  ];
  const passback = assistants(wire_messages(messages, true));
  assert.equal("reasoning" in (passback[0] ?? {}), false);
  assert.equal(passback[1]?.reasoning, " ");
  assert.equal(passback[2]?.reasoning, " ");
});

test("the steer flag never reaches the wire", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "user", steer: true, content: [{ type: "text", text: "also this" }] },
  ];
  assert.deepEqual(wire_messages(messages, false)[1], { role: "user", content: [{ type: "text", text: "also this" }] });
});

test("a steer after the turn's user message keeps current-turn reasoning, a real user message after it starts a new turn", () => {
  const steered: ApiMessage[] = [
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [call("a")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "a", content: "ok" },
    { role: "user", steer: true, content: "steer" },
    { role: "assistant", content: null, tool_calls: [call("b")], reasoning_details: reasoning },
    { role: "tool", tool_call_id: "b", content: "ok" },
  ];
  const wired = assistants(wire_messages(steered, false));
  assert.deepEqual(wired[0]?.reasoning_details, reasoning);
  assert.deepEqual(wired[1]?.reasoning_details, reasoning);
  const next = assistants(wire_messages([...steered, { role: "user", content: "next task" }], false));
  assert.equal("reasoning_details" in (next[0] ?? {}), false);
  assert.equal("reasoning_details" in (next[1] ?? {}), false);
});
