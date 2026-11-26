import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelError } from "../electron/model/errors.ts";
import { create_plan_accumulator, type PlanAccumulator, type PlanPush } from "../electron/model/plan/events.ts";
import { output_wrapper_type } from "../electron/model/plan/input.ts";
import { call_item, message_item, reasoning_item, usage } from "./plan-harness.ts";

const ids = () => {
  let next = 0;
  return () => `call_made_${(next += 1)}`;
};

const feed = (accumulator: PlanAccumulator, events: Record<string, unknown>[]): PlanPush[] => events.map((event) => accumulator.push(event));

const text = (delta: string, item_id = "msg_1", output_index = 0) => ({ type: "response.output_text.delta", item_id, output_index, content_index: 0, delta });

const done = (output_index: number, item: Record<string, unknown>) => ({ type: "response.output_item.done", output_index, item });

const completed = { type: "response.completed", response: { id: "resp_9", status: "completed", usage } };

test("text deltas, usage and the wrapper of finished items in output order", () => {
  const accumulator = create_plan_accumulator();
  const pushes = feed(accumulator, [
    { type: "response.created", response: { id: "resp_9" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1", summary: [] } },
    { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "think" },
    text("hello ", "msg_1", 1),
    text("world", "msg_1", 1),
    done(1, message_item("hello world")),
    done(0, reasoning_item("rs_1", "think")),
    completed,
  ]);
  assert.deepEqual(
    pushes.map((push) => [push.text, push.reasoning, push.terminal]),
    [
      ["", "", null],
      ["", "", null],
      ["", "", null],
      ["", "think", null],
      ["hello ", "", null],
      ["world", "", null],
      ["", "", null],
      ["", "", null],
      ["", "", "completed"],
    ],
  );
  const assembly = accumulator.finish(ids());
  assert.equal(assembly.content, "hello world");
  assert.equal(assembly.reasoning, "think");
  assert.equal(assembly.finish_reason, "stop");
  assert.deepEqual(assembly.usage, { prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 12, cached_tokens: 64, cache_write_tokens: 8 });
  assert.equal(assembly.response_id, "resp_9");
  assert.equal(assembly.cached_tokens, 64);
  assert.equal(assembly.cache_write_tokens, 8);
  assert.deepEqual(assembly.reasoning_details, [{ type: output_wrapper_type, items: [reasoning_item("rs_1", "think"), message_item("hello world")] }]);
});

test("a second message item starts after a blank line", () => {
  const accumulator = create_plan_accumulator();
  const pushes = feed(accumulator, [text("first", "msg_1", 0), text("second", "msg_2", 1), text(" part", "msg_2", 1), completed]);
  assert.deepEqual(
    pushes.map((push) => push.text),
    ["first", "\n\nsecond", " part", ""],
  );
  assert.equal(accumulator.finish(ids()).content, "first\n\nsecond part");
});

test("a refusal is shown as text and finishes as content_filter", () => {
  const accumulator = create_plan_accumulator();
  feed(accumulator, [{ type: "response.refusal.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "I can't help with that." }, completed]);
  const assembly = accumulator.finish(ids());
  assert.equal(assembly.content, "I can't help with that.");
  assert.equal(assembly.finish_reason, "content_filter");
});

test("a later summary part and raw reasoning text both reach the reasoning, the later part after a blank line", () => {
  const accumulator = create_plan_accumulator();
  const pushes = feed(accumulator, [
    { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 0 },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "one" },
    { type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 1 },
    { type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 1, delta: "two" },
    { type: "response.reasoning_text.delta", item_id: "rs_2", output_index: 1, content_index: 0, delta: " raw" },
  ]);
  assert.deepEqual(
    pushes.map((push) => push.reasoning),
    ["", "one", "", "\n\ntwo", " raw"],
  );
  assert.equal(accumulator.reasoning(), "one\n\ntwo raw");
});

test("function calls register on added, collect argument deltas, take the final item and finish as tool_calls", () => {
  const accumulator = create_plan_accumulator();
  const pushes = feed(accumulator, [
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_a", name: "read_file", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: '{"path":' },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '"a"}' },
    done(0, call_item("call_a", "read_file", "fc_1", '{"path":"a"}')),
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_2", call_id: "call_b", name: "run_command", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_2", output_index: 1, delta: '{"command":"l' },
    done(1, call_item("call_b", "run_command", "fc_2", '{"command":"ls"}')),
    completed,
  ]);
  assert.deepEqual(
    pushes.map((push) => push.drafted),
    [[0], [0], [0], [], [1], [1], [1], []],
  );
  assert.deepEqual(accumulator.tool(0), { index: 0, id: "call_a", name: "read_file", arguments: '{"path":"a"}' });
  const assembly = accumulator.finish(ids());
  assert.equal(assembly.finish_reason, "tool_calls");
  assert.deepEqual(assembly.tool_calls, [
    { index: 0, id: "call_a", name: "read_file", arguments: '{"path":"a"}' },
    { index: 1, id: "call_b", name: "run_command", arguments: '{"command":"ls"}' },
  ]);
  const [wrapper] = assembly.reasoning_details as { items: Record<string, unknown>[] }[];
  assert.deepEqual(
    wrapper?.items.map((item) => [item.type, item.call_id, "arguments" in item]),
    [
      ["function_call", "call_a", false],
      ["function_call", "call_b", false],
    ],
  );
});

test("function_call_arguments.done completes the collected arguments or replaces diverging ones", () => {
  const accumulator = create_plan_accumulator();
  const pushes = feed(accumulator, [
    { type: "response.in_progress", response: { id: "resp_5" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_a", name: "read_file", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: '{"pa' },
    { type: "response.function_call_arguments.done", item_id: "fc_1", output_index: 0, arguments: '{"path":"a"}' },
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_2", call_id: "call_b", name: "read_file", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_2", output_index: 1, delta: "garbled" },
    { type: "response.function_call_arguments.done", item_id: "fc_2", output_index: 1, arguments: '{"path":"b"}' },
    completed,
  ]);
  assert.deepEqual(pushes[3]?.drafted, [0]);
  assert.deepEqual(
    accumulator.finish(ids()).tool_calls.map((call) => call.arguments),
    ['{"path":"a"}', '{"path":"b"}'],
  );
  assert.equal(accumulator.finish(ids()).response_id, "resp_9");
});

test("a write tool gets a draft decoder and an unfinished call keeps the arguments collected so far", () => {
  const accumulator = create_plan_accumulator();
  feed(accumulator, [
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "", name: "write_file", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 0, delta: '{"path":"a.txt","content":"one\\ntwo' },
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_2", call_id: "call_x", name: "", arguments: "" } },
    completed,
  ]);
  const draft = accumulator.draft(0)?.take();
  assert.equal(draft?.path, "a.txt");
  assert.equal(draft?.delta, "one\ntwo");
  const assembly = accumulator.finish(ids());
  assert.deepEqual(assembly.tool_calls, [{ index: 0, id: "call_made_1", name: "write_file", arguments: '{"path":"a.txt","content":"one\\ntwo' }]);
  assert.deepEqual(assembly.reasoning_details, []);
});

test("incomplete responses map their reason to a finish or a bad request", () => {
  const reason = (value: string) => {
    const accumulator = create_plan_accumulator();
    feed(accumulator, [text("cut"), done(0, message_item("cut")), { type: "response.incomplete", response: { id: "resp_1", incomplete_details: { reason: value }, usage } }]);
    return accumulator;
  };
  const length = reason("max_output_tokens").finish(ids());
  assert.equal(length.finish_reason, "length");
  assert.deepEqual(length.reasoning_details, []);
  assert.deepEqual(length.usage, { prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 12, cached_tokens: 64, cache_write_tokens: 8 });
  assert.equal(reason("content_filter").finish(ids()).finish_reason, "content_filter");
  assert.throws(
    () => reason("steered").finish(ids()),
    (error: unknown) => error instanceof ModelError && error.kind === "bad_request" && error.message === "ChatGPT plan: the response ended incomplete (steered).",
  );
  assert.equal(reason("max_output_tokens").push({ type: "response.incomplete", response: {} }).terminal, "incomplete");
});

test("failed responses and error events report a failure", () => {
  const accumulator = create_plan_accumulator();
  const [failed, flat, nested, unknown] = feed(accumulator, [
    { type: "response.failed", response: { id: "resp_1", status: "failed", error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } },
    { type: "error", code: "server_error", message: "boom", param: null },
    { type: "error", error: { type: "invalid_request_error", code: "subscription_sharing_unsupported_capability", message: "no", param: "tools" } },
    { type: "response.audio.delta", delta: "x" },
  ]);
  assert.deepEqual(failed?.failure, { code: "subscription_sharing_usage_limit_exceeded", message: "limit", param: "", type: "" });
  assert.deepEqual(flat?.failure, { code: "server_error", message: "boom", param: "", type: "" });
  assert.deepEqual(nested?.failure, { code: "subscription_sharing_unsupported_capability", message: "no", param: "tools", type: "" });
  assert.deepEqual(unknown, { text: "", reasoning: "", drafted: [], terminal: null, failure: null });
  assert.deepEqual(accumulator.push("not an object"), { text: "", reasoning: "", drafted: [], terminal: null, failure: null });
});
