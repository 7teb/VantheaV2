import assert from "node:assert/strict";
import { test } from "node:test";
import { output_wrapper_type } from "../electron/model/plan/input.ts";
import { compress_above_bytes, plan_responses_url } from "../electron/model/plan/send.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { ToolSpec } from "../electron/tools/types.ts";
import { write_spec } from "./model-stream-harness.ts";
import {
  answer_frames,
  call_added,
  call_delta,
  call_item,
  completed,
  created,
  event,
  failed,
  forbidden_keys,
  item_done,
  message_item,
  plan_run,
  reasoning_item,
  text_delta,
  type Reply,
} from "./plan-harness.ts";

const read_spec: ToolSpec = { name: "read_file", description: "read", parameters: { type: "object", properties: {} } };

const luna_model: ModelEntry = {
  id: "openai/gpt-6-luna",
  label: "GPT-6 Luna",
  provider: "OpenAI",
  provider_order: ["openai"],
  efforts: [],
  default_effort: "",
  vision: true,
  context_length: 400000,
  max_output: 128000,
  reasoning_passback: false,
};

test("a clean round posts the Responses body with the plan token and returns text, reasoning, usage and the wrapper", async () => {
  const done = await plan_run([
    {
      headers: { "x-request-id": "req_1" },
      frames: [
        { data: created() },
        { data: ": keep-alive\n\n" },
        { data: event({ type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "plan" }) },
        { data: text_delta("hello ", "msg_1", 1) + text_delta("world", "msg_1", 1) },
        { data: item_done(0, reasoning_item("rs_1", "plan")) + item_done(1, message_item("hello world")) },
        { data: completed() },
      ],
    },
  ]);
  assert.equal(done.error, null);
  assert.equal(done.result?.status, "completed");
  assert.equal(done.result?.content, "hello world");
  assert.equal(done.result?.reasoning, "plan");
  assert.equal(done.result?.finish_reason, "stop");
  assert.deepEqual(done.result?.usage, { prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 12, cached_tokens: 64, cache_write_tokens: 8 });
  assert.deepEqual(done.result?.reasoning_details, [{ type: output_wrapper_type, items: [reasoning_item("rs_1", "plan"), message_item("hello world")] }]);
  assert.deepEqual(done.log, ["reasoning:plan", "text:hello ", "text:world"]);
  const sent = done.sent[0];
  assert.equal(done.sent.length, 1);
  assert.equal(sent?.url, plan_responses_url);
  assert.equal(sent?.method, "POST");
  assert.equal(sent?.redirect, "error");
  assert.deepEqual(sent?.headers, { Authorization: "Bearer plan-token-1", "Content-Type": "application/json", Accept: "text/event-stream" });
  assert.deepEqual(sent?.body, {
    model: "gpt-6.2-sol",
    input: [
      { type: "message", role: "developer", content: "system prompt" },
      { type: "message", role: "user", content: "hi" },
    ],
    store: false,
    stream: true,
    reasoning: { effort: "high", summary: "detailed" },
    text: { verbosity: "medium" },
  });
});

test("the round body carries tools as one input item, tool_choice none only with tools, and never a forbidden key", async () => {
  const with_tools = await plan_run([{ frames: answer_frames("ok") }], { tools: [read_spec], tool_choice: "none", max_tokens: 9000, effort: "major" });
  const body = with_tools.sent[0]?.body ?? {};
  assert.deepEqual(Object.keys(body), ["model", "input", "store", "stream", "reasoning", "text", "tool_choice"]);
  assert.equal(body.tool_choice, "none");
  assert.deepEqual(body.reasoning, { effort: "xhigh", summary: "detailed" });
  assert.deepEqual((body.input as Record<string, unknown>[])[1], {
    type: "additional_tools",
    role: "developer",
    tools: [{ type: "function", name: "read_file", description: "read", parameters: read_spec.parameters, strict: false }],
  });
  const without_tools = await plan_run([{ frames: answer_frames("ok") }], { tool_choice: "none", model: luna_model });
  const plain = without_tools.sent[0]?.body ?? {};
  assert.deepEqual(Object.keys(plain), ["model", "input", "store", "stream"]);
  for (const sent of [body, plain]) {
    for (const key of forbidden_keys) {
      assert.equal(key in sent, false, key);
    }
  }
});

test("CRLF framing, event lines, split chunks and a [DONE] sentinel are read", async () => {
  const crlf = (text: string) => text.replaceAll("\n", "\r\n");
  const whole = event({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "split" }, true);
  const done = await plan_run([
    {
      frames: [
        { data: crlf(created()) },
        { data: crlf(whole.slice(0, 20)) },
        { data: crlf(whole.slice(20)) },
        { data: crlf(event({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: " text" })) },
        { data: crlf(completed()) + "data: [DONE]\r\n\r\n" },
      ],
    },
  ]);
  assert.equal(done.result?.content, "split text");
  const sentinel = await plan_run([{ frames: [{ data: text_delta("never finished") + "data: [DONE]\n\n" }] }], { transport: { max_attempts: 1 } });
  assert.equal(sentinel.error?.kind, "stream_interrupted");
});

test("a stream without a terminal event and a malformed event are retried as stream_interrupted", async () => {
  const done = await plan_run([{ frames: [{ data: text_delta("half") }] }, { frames: [{ data: "data: {not json\n\n" }] }, { frames: answer_frames("whole") }]);
  assert.equal(done.result?.content, "whole");
  assert.equal(done.sent.length, 3);
  assert.deepEqual(done.log, ["text:half", "retry:2/9:stream_interrupted", "retry:3/9:stream_interrupted", "text:whole"]);
  assert.deepEqual(done.delays, [2000, 5000]);
});

test("unavailable answers and plain rate limits are retried, usage limits never", async () => {
  const unavailable: Reply = { status: 503, text: '{"detail":"direct routing unavailable"}' };
  const retried = await plan_run([unavailable, { status: 429, text: '{"error":{"code":"rate_limit_exceeded","message":"slow"}}', headers: { "retry-after": "3" } }, { frames: answer_frames("ok") }]);
  assert.equal(retried.result?.content, "ok");
  assert.deepEqual(retried.delays, [2000, 3000]);
  const limited = await plan_run([{ status: 429, text: '{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Usage limit reached"}}' }, { frames: answer_frames("never") }]);
  assert.equal(limited.error?.kind, "plan_limit");
  assert.equal(limited.sent.length, 1);
  const mid_stream = await plan_run([{ frames: [{ data: text_delta("par") + failed("subscription_sharing_usage_limit_exceeded", "limit") }] }, { frames: answer_frames("never") }]);
  assert.equal(mid_stream.error?.kind, "plan_limit");
  assert.equal(mid_stream.error?.message, "ChatGPT plan: limit (subscription_sharing_usage_limit_exceeded)");
  assert.equal(mid_stream.sent.length, 1);
  const server = await plan_run([{ frames: [{ data: event({ type: "error", code: "server_error", message: "boom", param: null }) }] }, { frames: answer_frames("again") }]);
  assert.equal(server.result?.content, "again");
  assert.equal(server.sent.length, 2);
});

test("a 401 renews the token once and resends, a second 401 is plan_auth", async () => {
  const unauthorized: Reply = { status: 401, text: '{"detail":"Unauthorized"}' };
  const renewed = await plan_run([unauthorized, { frames: answer_frames("ok") }]);
  assert.equal(renewed.result?.content, "ok");
  assert.deepEqual(renewed.renewed, ["plan-token-1"]);
  assert.deepEqual(
    renewed.sent.map((sent) => sent.headers.Authorization),
    ["Bearer plan-token-1", "Bearer plan-token-2"],
  );
  const keyed = await plan_run([unauthorized, { frames: answer_frames("ok") }], { cache_key: "chat-1" });
  assert.deepEqual(
    keyed.sent.map((sent) => [sent.headers["session-id"], sent.headers["thread-id"]]),
    [
      ["chat-1", "chat-1"],
      ["chat-1", "chat-1"],
    ],
  );
  assert.equal("prompt_cache_key" in (keyed.sent[0]?.body ?? {}), false);
  const refused = await plan_run([unauthorized, unauthorized, { frames: answer_frames("never") }]);
  assert.equal(refused.error?.kind, "plan_auth");
  assert.equal(refused.error?.message, "ChatGPT plan 401: Unauthorized");
  assert.equal(refused.sent.length, 2);
  assert.deepEqual(refused.renewed, ["plan-token-1"]);
});

test("a body above the threshold is sent zstd compressed, a smaller one as plain JSON", async () => {
  const large = "x".repeat(compress_above_bytes + 10);
  const big = await plan_run([{ frames: answer_frames("ok") }], { messages: [{ role: "user", content: large }] });
  assert.equal(big.sent[0]?.encoded, true);
  assert.equal(big.sent[0]?.headers["Content-Encoding"], "zstd");
  assert.deepEqual(big.sent[0]?.body.input, [{ type: "message", role: "user", content: large }]);
  const small = await plan_run([{ frames: answer_frames("ok") }]);
  assert.equal(small.sent[0]?.encoded, false);
  assert.equal("Content-Encoding" in (small.sent[0]?.headers ?? {}), false);
});

test("an abort mid-stream returns the cancelled shape with the partial text", async () => {
  const controller = new AbortController();
  const cancelled = await plan_run([{ frames: [{ data: created() + text_delta("partial") }, { hang: true }] }], { abort_after_text: controller });
  assert.deepEqual(cancelled.result, { status: "cancelled", content: "partial", reasoning: "", reasoning_details: [], tool_calls: [], finish_reason: "", usage: null });
  const before = new AbortController();
  before.abort();
  const never = await plan_run([{ frames: answer_frames("never") }], { signal: before.signal });
  assert.equal(never.result?.status, "cancelled");
  assert.equal(never.sent.length, 0);
});

test("a silent server times out with the plan named in the message", async () => {
  const silent = await plan_run([{ frames: [{ hang: true }] }], { transport: { max_attempts: 1, first_byte_ms: 30 } });
  assert.equal(silent.error?.kind, "timeout");
  assert.match(silent.error?.message ?? "", /^ChatGPT plan sent nothing for 0 s after the request\.$/);
});

test("a write tool reports drafts while its arguments stream and the round finishes with tool calls", async () => {
  const args = '{"path":"a.txt","content":"one\\ntwo\\n"}';
  const done = await plan_run(
    [
      {
        frames: [
          { data: call_added(0, "call_w", "write_file", "fc_1") },
          { data: call_delta(0, "fc_1", args.slice(0, 18)) },
          { data: call_delta(0, "fc_1", args.slice(18)) },
          { data: item_done(0, call_item("call_w", "write_file", "fc_1", args)) + completed() },
        ],
      },
    ],
    { tools: [write_spec] },
  );
  assert.equal(done.result?.finish_reason, "tool_calls");
  assert.deepEqual(done.result?.tool_calls, [{ index: 0, id: "call_w", name: "write_file", arguments: args }]);
  assert.ok(done.drafts.length >= 2);
  assert.ok(done.drafts.every((draft) => draft.index === 0 && draft.name === "write_file"));
  assert.equal(done.drafts.map((draft) => draft.delta ?? "").join(""), "one\ntwo\n");
  assert.ok(done.drafts.some((draft) => draft.path === "a.txt"));
});

test("a plan_model answer tells the source which model was rejected", async () => {
  const done = await plan_run([{ status: 404, text: '{"error":{"code":"model_not_found","message":"The model does not exist"}}' }]);
  assert.equal(done.error?.kind, "plan_model");
  assert.deepEqual(done.rejected, ["openai/gpt-6.2-sol"]);
  const other = await plan_run([{ status: 400, text: '{"detail":"bad"}' }]);
  assert.deepEqual(other.rejected, []);
});
