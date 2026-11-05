import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, ContextUsage, Message } from "../shared/chat.ts";
import { calibrate, calibration_scale, coerce_context_usage, context_parts, measure_request, sent_estimate, stored_context } from "../electron/context/calibration.ts";
import { trim_tool_messages, trimmed_stub } from "../electron/context/trim.ts";
import { estimate_messages } from "../electron/context/usage.ts";
import { fit_window, removed_output_stub } from "../electron/context/window.ts";
import { parse_body } from "../electron/chats/files.ts";
import { parse_event } from "../electron/agents/records.ts";
import type { ApiMessage } from "../electron/model/types.ts";
import type { ToolSpec } from "../electron/tools/types.ts";
import { model } from "./turn-loop-harness.ts";

const assistant = (id: string, model_id: string, context: ContextUsage | null): AssistantMessage => ({
  id,
  role: "assistant",
  model: model_id,
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-12T10:00:00.000Z",
  ended_at: "2026-10-12T10:00:05.000Z",
  status: "done",
  steps: [{ id: `${id}-text`, round: 0, kind: "text", text: "answer" }],
  reasoning_details: [],
  retry: null,
  error: null,
  context,
  last_seq: 2,
});

const user = (id: string): Message => ({ id, role: "user", text: "q", attachments: [], origin: "user", created_at: "2026-10-12T10:00:00.000Z" });

const measured = (prompt_tokens: number, estimate: number, floor = 0): ContextUsage => ({ used: 1, limit: 10_000, calibration: { prompt_tokens, estimate }, floor });

test("the measure is the provider count of the calibrated request scaled onto the next request", () => {
  const calibration = calibrate({ prompt_tokens: 1100, completion_tokens: 900, reasoning_tokens: 800 }, 1000);
  assert.deepEqual(calibration, { prompt_tokens: 1100, estimate: 1000 });
  const next: ApiMessage[] = [{ role: "user", content: "x".repeat(20_000) }];
  assert.equal(sent_estimate(next, [], model), 5000);
  assert.equal(measure_request(next, [], model, calibration), 5500);
  assert.equal(measure_request(next, [], model, null), 5000);
});

test("a round without usage, a zero prompt count or a zero estimate yields no calibration", () => {
  assert.equal(calibrate(null, 1000), null);
  assert.equal(calibrate({ prompt_tokens: 0, completion_tokens: 10, reasoning_tokens: 0 }, 1000), null);
  assert.equal(calibrate({ prompt_tokens: 500, completion_tokens: 10, reasoning_tokens: 0 }, 0), null);
  assert.equal(calibration_scale(null), 1);
});

test("the stored calibration comes from the newest message of the same model, the floor only from the newest measured message of that model", () => {
  const history: Message[] = [
    user("u1"),
    assistant("x1", "x", measured(1120, 1000, 7300)),
    user("u2"),
    assistant("y1", "y", measured(900, 1000, 7100)),
    user("u3"),
    assistant("x2", "x", null),
  ];
  assert.deepEqual(stored_context(history, "x"), { calibration: { prompt_tokens: 1120, estimate: 1000 }, floor: 0 });
  assert.deepEqual(stored_context(history, "y"), { calibration: { prompt_tokens: 900, estimate: 1000 }, floor: 7100 });
  assert.deepEqual(stored_context(history, "z"), { calibration: null, floor: 0 });
  assert.deepEqual(stored_context(history.slice(0, 2), "x"), { calibration: { prompt_tokens: 1120, estimate: 1000 }, floor: 7300 });
});

test("a newer message of the same model without a calibration falls back to the older one, a legacy context counts as none", () => {
  const history: Message[] = [user("u1"), assistant("x1", "x", measured(1300, 1000)), user("u2"), assistant("x2", "x", { used: 9000, limit: 10_000 })];
  assert.deepEqual(stored_context(history, "x"), { calibration: { prompt_tokens: 1300, estimate: 1000 }, floor: 0 });
  assert.deepEqual(stored_context([user("u1"), assistant("x1", "x", { used: 9000, limit: 10_000 })], "x"), { calibration: null, floor: 0 });
});

test("a truncated chat measures with the calibration of the messages that are left", () => {
  const history: Message[] = [user("u1"), assistant("x1", "x", measured(1100, 1000)), user("u2"), assistant("x2", "x", measured(1500, 1000))];
  assert.deepEqual(stored_context(history.slice(0, 2), "x").calibration, { prompt_tokens: 1100, estimate: 1000 });
});

test("an invalid stored calibration is dropped at load, the rest of the context stays", () => {
  for (const bad of [{ prompt_tokens: "1100", estimate: 1000 }, { prompt_tokens: 0, estimate: 1000 }, { prompt_tokens: -5, estimate: 1000 }, { prompt_tokens: Number.NaN, estimate: 1000 }, { prompt_tokens: 1100, estimate: 0 }]) {
    assert.deepEqual(coerce_context_usage({ used: 7000, limit: 10_000, calibration: bad, floor: 7000 }), { used: 7000, limit: 10_000, floor: 7000 });
  }
  assert.equal(coerce_context_usage({ used: "7000", limit: 10_000 }), null);
  assert.equal(coerce_context_usage({ used: 7000, limit: -1 }), null);
  assert.deepEqual(coerce_context_usage({ used: 7000, limit: 10_000, floor: -3 }), { used: 7000, limit: 10_000 });
  assert.deepEqual(coerce_context_usage({ used: 7000, limit: 10_000 }), { used: 7000, limit: 10_000 });
});

test("the chat loader and the agent journal loader coerce stored contexts", () => {
  const raw = JSON.parse(
    JSON.stringify({
      messages: [user("u1"), { ...assistant("x1", "x", null), context: { used: 7000, limit: 10_000, calibration: { prompt_tokens: "big", estimate: 1000 }, floor: 7000 } }, user("u2"), assistant("x2", "x", null)],
    }),
  ) as unknown;
  const body = parse_body(raw, "chat-a");
  const contexts = body?.messages.flatMap((message) => (message.role === "assistant" ? [message.context] : []));
  assert.deepEqual(contexts, [{ used: 7000, limit: 10_000, floor: 7000 }, null]);
  assert.deepEqual(stored_context(body?.messages ?? [], "x"), { calibration: null, floor: 7000 });
  assert.equal(parse_event({ type: "context", usage: { used: "a", limit: 1 }, seq: 1, at: 1 }, "chat-a"), null);
  assert.deepEqual(parse_event({ type: "context", usage: { used: 5, limit: 10, calibration: { prompt_tokens: 3, estimate: 2 } }, seq: 1, at: 1 }, "chat-a"), {
    type: "context",
    usage: { used: 5, limit: 10, calibration: { prompt_tokens: 3, estimate: 2 } },
    seq: 1,
    at: 1,
  });
});

test("the sent estimate leaves out earlier-turn reasoning the wire form strips, current-turn reasoning stays", () => {
  const messages: ApiMessage[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: "a", reasoning: "r".repeat(4000) },
    { role: "user", content: "second" },
    { role: "assistant", content: "b", reasoning: "s".repeat(400) },
  ];
  assert.equal(sent_estimate(messages, [], model), estimate_messages(messages) - 1000);
  assert.equal(sent_estimate(messages, [], { ...model, reasoning_passback: true }), estimate_messages(messages));
});

const tool_pair = (id: string, chars: number): ApiMessage[] => [
  { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }] },
  { role: "tool", tool_call_id: id, content: "x".repeat(chars) },
];

test("the window fit converts the excess back into estimate units before dropping outputs", () => {
  const window = { ...model, context_length: 10_000 };
  const scaled = [...tool_pair("c1", 2000), ...tool_pair("c2", 2000)];
  assert.deepEqual(fit_window(scaled, window, 12_000, undefined, 1, 2), [{ tool: "read_file", call_id: "c1" }, { tool: "read_file", call_id: "c2" }]);
  const once = [...tool_pair("c1", 8000), ...tool_pair("c2", 8000)];
  assert.deepEqual(fit_window(once, window, 12_000, undefined, 1, 2), [{ tool: "read_file", call_id: "c1" }]);
  assert.equal(once[1]?.content, removed_output_stub);
});

test("the fallback trim fits the scaled estimate under the fraction", () => {
  const window = { ...model, context_length: 10_000 };
  const messages = [...tool_pair("c1", 12_000), ...tool_pair("c2", 12_000)];
  assert.equal(trim_tool_messages(structuredClone(messages), window, 0.7), false);
  const scaled = structuredClone(messages);
  assert.equal(trim_tool_messages(scaled, window, 0.7, 1.2), true);
  assert.deepEqual(scaled.filter((message) => message.role === "tool").map((message) => message.content === trimmed_stub), [true, false]);
});

test("the context split sums to the measured total and survives storage, broken splits are dropped", () => {
  const messages: ApiMessage[] = [
    { role: "system", content: "s".repeat(4000) },
    { role: "user", content: "u".repeat(2000) },
    { role: "assistant", content: "a".repeat(2000) },
  ];
  const specs: ToolSpec[] = [{ name: "read_file", description: "d".repeat(1800), parameters: { type: "object", properties: {} } }];
  const parts = context_parts(messages, specs, model, 9000);
  assert.equal(parts.system + parts.tools + parts.messages, 9000);
  assert.ok(parts.system > parts.messages / 2 && parts.tools > 0 && parts.messages > 0, JSON.stringify(parts));
  assert.deepEqual(context_parts([], [], model, 0), { system: 0, tools: 0, messages: 0 });
  assert.deepEqual(coerce_context_usage({ used: 9000, limit: 100000, parts })?.parts, parts);
  assert.equal(coerce_context_usage({ used: 9000, limit: 100000, parts: { system: 1, tools: -2, messages: 3 } })?.parts, undefined);
  assert.equal(coerce_context_usage({ used: 9000, limit: 100000 })?.parts, undefined);
});
