import assert from "node:assert/strict";
import { test } from "node:test";
import { read_balance, read_key_info } from "../electron/model/balance.ts";
import { complete } from "../electron/model/complete.ts";
import { ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import type { Transport } from "../electron/model/transport.ts";

type Reply = { status: number; body: string; headers?: Record<string, string> };

const transport = (replies: Reply[]) => {
  const seen: { url: string; method: string; body: string }[] = [];
  const delays: number[] = [];
  const overrides: Partial<Transport> = {
    fetch: async (url, init) => {
      const reply = replies[Math.min(seen.length, replies.length - 1)] ?? { status: 500, body: "" };
      seen.push({ url, method: String(init.method), body: String(init.body) });
      return new Response(reply.body, { status: reply.status, headers: reply.headers ?? {} });
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
  };
  return { overrides, seen, delays };
};

const completion = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "gen-1",
    object: "chat.completion",
    created: 1,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    ...extra,
  });

set_key_source(() => "sk-or-test-key");

test("complete sends the documented body and returns trimmed text with usage", async () => {
  const { overrides, seen } = transport([{ status: 200, body: completion("  Short title \n") }]);
  const result = await complete({ model_id: "side/model", messages: [{ role: "user", content: "hi" }], max_tokens: 50, temperature: 0, json: true }, undefined, overrides);
  assert.deepEqual(result, {
    text: "Short title",
    usage: { prompt_tokens: 3, completion_tokens: 4, reasoning_tokens: 0 },
    meta: { id: "gen-1", finish_reason: "stop", cached_tokens: 0, cache_write_tokens: 0, cost: null },
  });
  assert.equal(seen[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(JSON.parse(seen[0]?.body ?? "{}"), {
    model: "side/model",
    messages: [{ role: "user", content: "hi" }],
    max_completion_tokens: 50,
    temperature: 0,
    response_format: { type: "json_object" },
  });
});

test("a completion without max_tokens sends no output cap and reports a length finish", async () => {
  const cut = JSON.stringify({ id: "gen-2", choices: [{ index: 0, message: { role: "assistant", content: "partial" }, finish_reason: "length" }] });
  const { overrides, seen } = transport([{ status: 200, body: cut }]);
  const result = await complete({ model_id: "side/model", messages: [{ role: "user", content: "hi" }], temperature: 0.2 }, undefined, overrides);
  const body = JSON.parse(seen[0]?.body ?? "{}");
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("max_tokens" in body, false);
  assert.equal(result.meta.finish_reason, "length");
  assert.equal(result.text, "partial");
});

test("a response schema wins over the json flag and is sent as strict json_schema", async () => {
  const { overrides, seen } = transport([{ status: 200, body: completion("{}") }]);
  const schema = { name: "shape", schema: { type: "object", properties: {} }, strict: true };
  await complete({ model_id: "m", messages: [], max_tokens: 10, json: true, schema }, undefined, overrides);
  assert.deepEqual(JSON.parse(seen[0]?.body ?? "{}").response_format, { type: "json_schema", json_schema: schema });
});

test("side jobs on a Gemini model turn every adjustable safety filter off", async () => {
  const { overrides, seen } = transport([{ status: 200, body: completion("ok") }]);
  await complete({ model_id: "google/gemini-3.1-flash-lite-20260507", messages: [], max_tokens: 10 }, undefined, overrides);
  const body = JSON.parse(seen[0]?.body ?? "{}");
  assert.equal(body.safety_settings.length, 5);
  assert.ok(body.safety_settings.every((entry: { threshold: string }) => entry.threshold === "OFF"));
});

test("content parts are joined and optional fields stay out of the body", async () => {
  const { overrides, seen } = transport([{ status: 200, body: completion([{ type: "text", text: "a" }, { type: "text", text: "b" }]) }]);
  const result = await complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, overrides);
  assert.equal(result.text, "ab");
  const body = JSON.parse(seen[0]?.body ?? "{}") as Record<string, unknown>;
  assert.equal("temperature" in body, false);
  assert.equal("response_format" in body, false);
});

test("a 200 carrying an error body is classified and retried when transient", async () => {
  const { overrides, seen, delays } = transport([
    { status: 200, body: JSON.stringify({ error: { code: 502, message: "Provider disconnected", metadata: { error_type: "provider_unavailable" } } }) },
    { status: 200, body: completion("ok") },
  ]);
  const result = await complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, overrides);
  assert.equal(result.text, "ok");
  assert.equal(seen.length, 2);
  assert.deepEqual(delays, [2000]);
});

test("a choice level error with a fatal type is thrown without retry", async () => {
  const body = JSON.stringify({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "error", error: { code: 400, message: "bad", metadata: { error_type: "invalid_prompt" } } }] });
  const { overrides, seen } = transport([{ status: 200, body }]);
  await assert.rejects(
    complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, overrides),
    (error: unknown) => error instanceof ModelError && error.kind === "bad_request",
  );
  assert.equal(seen.length, 1);
});

test("rate limits are retried with Retry-After and auth errors are not", async () => {
  const limited = transport([
    { status: 429, body: JSON.stringify({ error: { code: 429, message: "slow" } }), headers: { "retry-after": "2" } },
    { status: 200, body: completion("fine") },
  ]);
  assert.equal((await complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, limited.overrides)).text, "fine");
  assert.deepEqual(limited.delays, [2000]);
  const denied = transport([{ status: 401, body: JSON.stringify({ error: { code: 401, message: "User not found." } }) }]);
  await assert.rejects(
    complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, denied.overrides),
    (error: unknown) => error instanceof ModelError && error.kind === "auth" && error.status === 401,
  );
  assert.equal(denied.seen.length, 1);
});

test("an aborted signal rejects without a request", async () => {
  const { overrides, seen } = transport([{ status: 200, body: completion("never") }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(complete({ model_id: "m", messages: [], max_tokens: 10 }, controller.signal, overrides));
  assert.equal(seen.length, 0);
});

test("a completion whose body never finishes fails as no complete answer within the attempt time", async () => {
  const overrides: Partial<Transport> = {
    fetch: async (_url, init) =>
      new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('{"id":"gen-1","choices":['));
            init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
          },
        }),
        { status: 200 },
      ),
    sleep: async () => {},
    random: () => 0,
    first_byte_ms: 500,
    max_attempts: 1,
  };
  await assert.rejects(complete({ model_id: "m", messages: [], max_tokens: 10 }, undefined, overrides), (error: unknown) => {
    assert.ok(error instanceof ModelError);
    assert.equal(error.kind, "timeout");
    assert.equal(error.message, "OpenRouter returned no complete answer within 1 s of the request.");
    return true;
  });
});

test("key information maps to the balance shape", () => {
  assert.deepEqual(read_key_info(JSON.stringify({ data: { label: "k", limit: 100, limit_remaining: 74.5, usage: 25.5 } })), {
    limit: 100,
    usage: 25.5,
    remaining: 74.5,
  });
  assert.deepEqual(read_key_info(JSON.stringify({ data: { limit: null, limit_remaining: null, usage: 3 } })), { limit: null, usage: 3, remaining: null });
  assert.throws(() => read_key_info(JSON.stringify({ data: {} })), ModelError);
});

test("read_balance is null without a key and cached per key", async () => {
  set_key_source(() => "");
  assert.equal(await read_balance(), null);
  set_key_source(() => "sk-or-balance-key");
  const { overrides, seen } = transport([{ status: 200, body: JSON.stringify({ data: { limit: null, limit_remaining: null, usage: 1.5 } }) }]);
  assert.deepEqual(await read_balance(overrides), { limit: null, usage: 1.5, remaining: null });
  assert.deepEqual(await read_balance(overrides), { limit: null, usage: 1.5, remaining: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.method, "GET");
  assert.equal(seen[0]?.url, "https://openrouter.ai/api/v1/key");
  set_key_source(() => "sk-or-test-key");
});
