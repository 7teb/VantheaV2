import assert from "node:assert/strict";
import { test } from "node:test";
import { flex_id } from "../shared/models.ts";
import { ModelError } from "../electron/model/errors.ts";
import { complete_plan } from "../electron/model/plan/complete.ts";
import { plan_responses_url } from "../electron/model/plan/send.ts";
import { review_completion, review_limits } from "../electron/model/review-call.ts";
import type { ReviewCall } from "../electron/tools/types.ts";
import { answer_frames, completed, created, event, fake_fetch, fake_source, forbidden_keys, incomplete, item_done, message_item, text_delta, with_source } from "./plan-harness.ts";

const schema = { name: "verdict", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, strict: true };

test("a completion with a schema sends text.format and drops every OpenRouter field", async () => {
  const fake = fake_fetch([{ frames: answer_frames('  {"ok":true}  ') }]);
  const { source } = fake_source();
  const result = await with_source(source, () =>
    complete_plan(
      {
        model_id: "openai/gpt-6-luna",
        messages: [
          { role: "system", content: "judge" },
          { role: "user", content: [{ type: "text", text: "case", prompt_cache_breakpoint: { mode: "explicit" } }] },
        ],
        max_tokens: 400,
        temperature: 0,
        schema,
        reasoning_effort: "low",
        session_id: "vx-review:chat-1",
        prompt_cache_options: { mode: "explicit" },
        provider: { order: ["openai"] },
      },
      undefined,
      fake.transport,
    ),
  );
  assert.deepEqual(result, {
    text: '{"ok":true}',
    usage: { prompt_tokens: 120, completion_tokens: 30, reasoning_tokens: 12 },
    meta: { id: "resp_1", finish_reason: "stop", cached_tokens: 64, cache_write_tokens: 8, cost: null },
  });
  assert.equal(fake.sent[0]?.url, plan_responses_url);
  const body = fake.sent[0]?.body ?? {};
  assert.deepEqual(body, {
    model: "gpt-6-luna",
    input: [
      { type: "message", role: "developer", content: "judge" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "case" }] },
    ],
    store: false,
    stream: true,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "verdict", schema: schema.schema, strict: true } },
  });
  for (const key of forbidden_keys) {
    assert.equal(key in body, false, key);
  }
});

test("json mode sends json_object and a plain completion sends no text field", async () => {
  const fake = fake_fetch([{ frames: answer_frames("{}") }]);
  const { source } = fake_source();
  await with_source(source, async () => {
    await complete_plan({ model_id: "openai/gpt-6-luna", messages: [{ role: "user", content: "json please" }], json: true }, undefined, fake.transport);
    await complete_plan({ model_id: flex_id("openai/gpt-6-luna"), messages: [{ role: "user", content: "title" }] }, undefined, fake.transport);
  });
  assert.deepEqual(fake.sent[0]?.body.text, { format: { type: "json_object" } });
  assert.deepEqual(Object.keys(fake.sent[1]?.body ?? {}), ["model", "input", "store", "stream"]);
  assert.equal(fake.sent[1]?.body.model, "gpt-6-luna");
});

test("a non-OpenAI model id is refused before any request", async () => {
  const fake = fake_fetch([{ frames: answer_frames("never") }]);
  const { source } = fake_source();
  await with_source(source, () =>
    assert.rejects(
      complete_plan({ model_id: "google/gemini-3-flash", messages: [{ role: "user", content: "x" }] }, undefined, fake.transport),
      (error: unknown) => error instanceof ModelError && error.kind === "bad_request",
    ),
  );
  assert.equal(fake.sent.length, 0);
});

test("the completion runs under one deadline that streaming events do not extend", async () => {
  const frames = [
    { data: created(), wait: 25 },
    { data: text_delta("a"), wait: 25 },
    { data: text_delta("b"), wait: 25 },
    { data: item_done(0, message_item("ab")) + completed(), wait: 25 },
  ];
  const fake = fake_fetch([{ frames }], { first_byte_ms: 70, idle_ms: 70, max_attempts: 1 });
  const { source } = fake_source();
  await with_source(source, () =>
    assert.rejects(
      complete_plan({ model_id: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }] }, undefined, fake.transport),
      (error: unknown) => error instanceof ModelError && error.kind === "timeout" && /^ChatGPT plan returned no complete answer within/.test(error.message),
    ),
  );
});

test("a length cut keeps the text and reports finish length", async () => {
  const fake = fake_fetch([{ frames: [{ data: text_delta("partial") + item_done(0, message_item("partial")) + incomplete("max_output_tokens") }] }]);
  const { source } = fake_source();
  const result = await with_source(source, () => complete_plan({ model_id: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }] }, undefined, fake.transport));
  assert.equal(result.text, "partial");
  assert.equal(result.meta.finish_reason, "length");
  assert.equal(result.meta.cost, null);
});

test("an abort rethrows the signal reason and plan_model notifies the source", async () => {
  const controller = new AbortController();
  const reason = new Error("stop now");
  controller.abort(reason);
  const fake = fake_fetch([{ frames: answer_frames("never") }]);
  const { source, rejected } = fake_source();
  await with_source(source, () => assert.rejects(complete_plan({ model_id: "openai/gpt-6-luna", messages: [] }, controller.signal, fake.transport), reason));
  assert.equal(fake.sent.length, 0);
  const missing = fake_fetch([{ status: 400, text: '{"error":{"code":"subscription_sharing_unsupported_capability","param":"model","message":"model"}}' }]);
  await with_source(source, () =>
    assert.rejects(
      complete_plan({ model_id: "openai/gpt-6-luna", messages: [{ role: "user", content: "x" }] }, undefined, missing.transport),
      (error: unknown) => error instanceof ModelError && error.kind === "plan_model",
    ),
  );
  assert.deepEqual(rejected, ["openai/gpt-6-luna"]);
});

const review_call: ReviewCall = {
  session_id: "vx-review:chat-1",
  system: "review system",
  parts: [
    { text: "chat part", marker: true },
    { text: "current part", marker: false },
  ],
  schema: { name: "command_review", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
};

test("the review goes through the plan in plan mode with the effort override and a strict schema", async () => {
  const answer = '{"decision":"allow"}';
  const fake = fake_fetch([{ frames: [{ data: event({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: answer }) + item_done(0, message_item(answer)) + completed() }] }]);
  const { source } = fake_source();
  const reply = await with_source(source, () =>
    review_completion("openai/gpt-6-luna", review_call, new AbortController().signal, { ...review_limits, transport: fake.transport }, "medium"),
  );
  assert.equal(reply.text, answer);
  assert.equal(reply.usage?.cost, null);
  assert.equal(reply.usage?.cached_tokens, 64);
  const body = fake.sent[0]?.body ?? {};
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.deepEqual(body.text, { format: { type: "json_schema", name: "command_review", schema: review_call.schema.schema, strict: true } });
  assert.deepEqual(body.input, [
    { type: "message", role: "developer", content: "review system" },
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "chat part" },
        { type: "input_text", text: "current part" },
      ],
    },
  ]);
  for (const key of forbidden_keys) {
    assert.equal(key in body, false, key);
  }
});
