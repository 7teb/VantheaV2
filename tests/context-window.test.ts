import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { estimate_messages } from "../electron/context/usage.ts";
import { drop_oldest_outputs, fit_window, removed_output_stub } from "../electron/context/window.ts";
import type { ApiAssistantMessage, ApiMessage } from "../electron/model/types.ts";

const model = (id = "m"): ModelEntry => ({
  id,
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 10_000,
  max_output: 1000,
  reasoning_passback: false,
});

const round = (index: number, chars: number): ApiMessage[] => [
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id: `c${index}`, type: "function", function: { name: index % 2 ? "read_file" : "run_command", arguments: "{}" } }],
    reasoning_details: [{ type: "reasoning.text", text: "r" }],
  },
  { role: "tool", tool_call_id: `c${index}`, content: "x".repeat(chars) },
];

const outputs = (messages: ApiMessage[]) => messages.flatMap((message) => (message.role === "tool" ? [message.content] : []));

test("a request inside the window keeps every tool output", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...round(1, 36_000), ...round(2, 3600)];
  const before = JSON.stringify(messages);
  assert.deepEqual(fit_window(messages, model(), estimate_messages(messages)), []);
  assert.equal(JSON.stringify(messages), before);
  assert.deepEqual(fit_window(messages, { ...model(), context_length: 0 }, 1_000_000), []);
});

test("a request over the window loses only the oldest outputs it has to, and an output smaller than its stub stays", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...round(1, 40), ...round(2, 16_000), ...round(3, 16_000), ...round(4, 16_000)];
  assert.deepEqual(fit_window(messages, model(), estimate_messages(messages)), [{ tool: "run_command", call_id: "c2" }]);
  assert.deepEqual(outputs(messages), ["x".repeat(40), removed_output_stub, "x".repeat(16_000), "x".repeat(16_000)]);
  assert.ok(estimate_messages(messages) <= 10_000);
  assert.ok(messages.every((message) => message.role !== "assistant" || message.reasoning_details));
});

test("the measured size decides, and a listed output must save more than its line costs", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...round(1, 400), ...round(2, 16_000), ...round(3, 16_000)];
  assert.deepEqual(fit_window(messages, model(), 10_500, () => 200), [{ tool: "run_command", call_id: "c2" }]);
  assert.equal(outputs(messages)[0], "x".repeat(400));
});

test("for reasoning bound to the prefix, reasoning after the first removed output is dropped", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...round(1, 16_000), ...round(2, 16_000), ...round(3, 16_000)];
  fit_window(messages, model("anthropic/claude-x"), estimate_messages(messages));
  const reasoning = messages.filter((message): message is ApiAssistantMessage => message.role === "assistant").map((message) => Boolean(message.reasoning_details));
  assert.deepEqual(reasoning, [true, false, false]);
  assert.equal(outputs(messages)[0], removed_output_stub);
});

test("an excess of one token removes exactly the next oldest output that is not already removed or too small", () => {
  const messages: ApiMessage[] = [{ role: "system", content: "s" }, ...round(1, 16_000), ...round(2, 40), ...round(3, 16_000), ...round(4, 16_000)];
  assert.deepEqual(drop_oldest_outputs(messages, model(), 1), [{ tool: "read_file", call_id: "c1" }]);
  assert.deepEqual(drop_oldest_outputs(messages, model(), 1), [{ tool: "read_file", call_id: "c3" }]);
  assert.deepEqual(outputs(messages), [removed_output_stub, "x".repeat(40), removed_output_stub, "x".repeat(16_000)]);
  assert.deepEqual(drop_oldest_outputs(messages, model(), 0), []);
});
