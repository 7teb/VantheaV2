import assert from "node:assert/strict";
import { test } from "node:test";
import { set_key_source } from "../electron/model/key.ts";
import { review_completion, review_limits, type ReviewLimits } from "../electron/model/review-call.ts";
import type { Transport } from "../electron/model/transport.ts";
import type { ReviewCall } from "../electron/tools/types.ts";

set_key_source(() => "sk-or-test-key");

const call: ReviewCall = {
  session_id: "vx-review:chat-1",
  system: "system prompt",
  parts: [
    { text: "chat part", marker: true },
    { text: "agent part", marker: true },
    { text: "block 1", marker: true },
    { text: "block 2", marker: true },
    { text: "current part", marker: false },
  ],
  schema: { name: "command_review", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
};

const answer = (usage: Record<string, unknown> | undefined) =>
  JSON.stringify({
    id: "gen-9",
    choices: [{ index: 0, message: { role: "assistant", content: '{"decision":"allow"}' }, finish_reason: "stop" }],
    ...(usage ? { usage } : {}),
  });

const fake = (body: string) => {
  const seen: Record<string, unknown>[] = [];
  const transport: Partial<Transport> = {
    fetch: async (_url, init) => {
      seen.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(body, { status: 200 });
    },
    sleep: async () => {},
    random: () => 0,
  };
  const limits: ReviewLimits = { ...review_limits, transport };
  return { seen, limits };
};

type WireParts = { content: { prompt_cache_breakpoint?: unknown }[] }[];

const marker_flags = (body: Record<string, unknown> | undefined): boolean[] =>
  ((body?.messages as WireParts | undefined)?.[1]?.content ?? []).map((part) => Boolean(part.prompt_cache_breakpoint));

test("the review body carries the explicit cache layout, the pin and the strict schema", async () => {
  const { seen, limits } = fake(answer({ prompt_tokens: 7234, completion_tokens: 82 }));
  await review_completion("openai/gpt-6-luna", call, new AbortController().signal, limits);
  const body = seen[0] ?? {};
  assert.equal(body.model, "openai/gpt-6-luna");
  assert.equal(body.session_id, "vx-review:chat-1");
  assert.deepEqual(body.provider, { order: ["openai"] });
  assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("max_tokens" in body, false);
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "command_review", strict: true, schema: call.schema.schema } });
  for (const field of ["temperature", "safety_settings", "cache_control"]) {
    assert.equal(field in body, false);
  }
  const messages = body.messages as { role: string; content: unknown }[];
  assert.deepEqual(messages[0], { role: "system", content: "system prompt" });
  const flags = marker_flags(body);
  assert.deepEqual(flags, [true, true, true, true, false]);
  assert.ok(flags.filter(Boolean).length <= 4);
});

test("a google id gets one marker, and only above 20,000 characters of prefix", async () => {
  const short = fake(answer(undefined));
  await review_completion("google/gemini-3.5-flash-lite", call, new AbortController().signal, short.limits);
  const short_body = short.seen[0] ?? {};
  assert.equal("prompt_cache_options" in short_body, false);
  assert.equal("provider" in short_body, false);
  assert.deepEqual(marker_flags(short_body), [false, false, false, false, false]);
  const long = fake(answer(undefined));
  const big: ReviewCall = { ...call, parts: [{ text: "x".repeat(21000), marker: true }, ...call.parts.slice(1)] };
  await review_completion("google/gemini-3.5-flash-lite", big, new AbortController().signal, long.limits);
  assert.deepEqual(marker_flags(long.seen[0]), [false, false, false, true, false]);
});

test("usage, cache and cost fields are read, with 0 and null when absent", async () => {
  const full = fake(
    answer({
      prompt_tokens: 7234,
      completion_tokens: 82,
      cost: 0.000199855,
      prompt_tokens_details: { cached_tokens: 6353, cache_write_tokens: 289 },
      completion_tokens_details: { reasoning_tokens: 12 },
    }),
  );
  const reply = await review_completion("openai/gpt-6-luna", call, new AbortController().signal, full.limits);
  assert.equal(reply.finish_reason, "stop");
  assert.equal(reply.text, '{"decision":"allow"}');
  assert.deepEqual(
    { ...reply.usage, ms: 0 },
    { prompt_tokens: 7234, estimated_tokens: 0, cached_tokens: 6353, cache_write_tokens: 289, completion_tokens: 82, reasoning_tokens: 12, cost: 0.000199855, ms: 0 },
  );
  const bare = fake(answer(undefined));
  const empty = await review_completion("openai/gpt-6-luna", call, new AbortController().signal, bare.limits);
  assert.deepEqual(
    { ...empty.usage, ms: 0 },
    { prompt_tokens: 0, estimated_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cost: null, ms: 0 },
  );
});

const hanging = (on_attempt: () => void): Partial<Transport> => ({
  fetch: (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      on_attempt();
    }),
  sleep: async () => {},
  random: () => 0,
});

test("a provider that never answers fails within the deadline after two attempts", async () => {
  let attempts = 0;
  const transport = hanging(() => {
    attempts += 1;
  });
  const started = Date.now();
  await assert.rejects(review_completion("openai/gpt-6-luna", call, new AbortController().signal, { attempt_ms: 50, deadline_ms: 100, attempts: 2, transport }));
  assert.ok(Date.now() - started < 1000);
  assert.equal(attempts, 2);
});

test("a turn abort rethrows the turn's reason", async () => {
  const controller = new AbortController();
  const transport = hanging(() => controller.abort(new Error("turn stopped")));
  await assert.rejects(review_completion("openai/gpt-6-luna", call, controller.signal, { ...review_limits, transport }), /turn stopped/);
});
