import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { set_key_source } from "../electron/model/key.ts";
import { round_body, stream_round } from "../electron/model/stream.ts";
import { body_of, chunk, error_chunk, model, run, write_spec } from "./model-stream-harness.ts";

set_key_source(() => "sk-or-test-key");

test("a clean stream completes with content, finish reason and usage", async () => {
  const usage = { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12, completion_tokens_details: { reasoning_tokens: 2 } };
  const done = await run([
    {
      frames: [
        { data: ": OPENROUTER PROCESSING\n\n" },
        { data: chunk({ reasoning: "plan" }) + chunk({ content: "hello " }) },
        { data: chunk({ content: "world" }, "stop") },
        { data: `data: ${JSON.stringify({ id: "gen-1", choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }], usage })}\n\ndata: [DONE]\n\n` },
      ],
    },
  ]);
  assert.equal(done.error, null);
  assert.equal(done.result?.status, "completed");
  assert.equal(done.result?.content, "hello world");
  assert.equal(done.result?.reasoning, "plan");
  assert.equal(done.result?.finish_reason, "stop");
  assert.deepEqual(done.result?.usage, { prompt_tokens: 5, completion_tokens: 7, reasoning_tokens: 2 });
  assert.deepEqual(done.log, ["reasoning:plan", "text:hello ", "text:world"]);
  assert.equal(done.posts, 1);
  assert.equal(done.headers[0]?.Authorization, "Bearer sk-or-test-key");
  assert.equal(done.headers[0]?.["X-OpenRouter-Title"], "VantheaX");
});

test("a finish without [DONE] or with a broken socket afterwards still completes", async () => {
  const finish_only = await run([{ frames: [{ data: chunk({ content: "done" }, "stop") }] }]);
  assert.equal(finish_only.result?.content, "done");
  const socket_after_finish = await run([{ frames: [{ data: chunk({ content: "complete" }, "stop") }, { error: "socket hang up" }] }]);
  assert.equal(socket_after_finish.result?.content, "complete");
  assert.equal(socket_after_finish.posts, 1);
  const silent_after_finish = await run([{ frames: [{ data: chunk({ content: "kept" }, "stop") }, { hang: true }] }]);
  assert.equal(silent_after_finish.result?.content, "kept");
  assert.equal(silent_after_finish.posts, 1);
});

test("an end of stream before any finish is retried after on_retry", async () => {
  const eof = await run([{ frames: [{ data: chunk({ content: "half" }) }] }, { frames: [{ data: chunk({ content: "whole" }, "stop") }] }]);
  assert.equal(eof.result?.content, "whole");
  assert.equal(eof.posts, 2);
  assert.deepEqual(eof.log, ["text:half", "retry:2/9:stream_interrupted", "text:whole"]);
  assert.deepEqual(eof.delays, [2000]);
});

test("a read error mid-stream is retried", async () => {
  const broken = await run([
    { frames: [{ data: chunk({ content: "partial" }) }, { error: "terminated" }] },
    { frames: [{ data: chunk({ content: "recovered" }, "stop") }] },
  ]);
  assert.equal(broken.result?.content, "recovered");
  assert.equal(broken.posts, 2);
});

test("an already aborted signal returns cancelled without posting", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = await run([{ frames: [{ data: chunk({ content: "never" }, "stop") }] }], { signal: controller.signal });
  assert.equal(cancelled.result?.status, "cancelled");
  assert.equal(cancelled.posts, 0);
});

test("an abort mid-stream returns cancelled with the partial text", async () => {
  const controller = new AbortController();
  const cancelled = await run([{ frames: [{ data: chunk({ content: "partial" }) }, { hang: true }] }], { abort_after_text: controller });
  assert.equal(cancelled.result?.status, "cancelled");
  assert.equal(cancelled.result?.content, "partial");
  assert.equal(cancelled.posts, 1);
});

test("first byte and idle timeouts are retried", async () => {
  const first = await run([{ frames: [{ hang: true }] }, { frames: [{ data: chunk({ content: "late" }, "stop") }] }]);
  assert.equal(first.result?.content, "late");
  assert.deepEqual(first.log, ["retry:2/9:timeout", "text:late"]);
  const idle = await run([{ frames: [{ data: chunk({ content: "start" }) }, { hang: true }] }, { frames: [{ data: chunk({ content: "second" }, "stop") }] }]);
  assert.equal(idle.result?.content, "second");
  assert.equal(idle.posts, 2);
  const exhausted = await run([{ frames: [{ data: chunk({ content: "start" }) }, { hang: true }] }], { transport: { max_attempts: 1 } });
  assert.equal(exhausted.error?.kind, "timeout");
  assert.match(exhausted.error?.message ?? "", /went silent/);
});

test("keep-alive comments reset the idle timer", async () => {
  const comment = { data: ": OPENROUTER PROCESSING\n\n", wait: 30 };
  const kept = await run([{ frames: [{ data: chunk({ content: "a" }) }, comment, comment, comment, comment, { data: chunk({ content: "b" }, "stop"), wait: 30 }] }]);
  assert.equal(kept.result?.content, "ab");
  assert.equal(kept.posts, 1);
});

test("mid-stream provider errors are classified", async () => {
  const fatal = await run([{ frames: [{ data: error_chunk({ code: 400, message: "bad request", metadata: { error_type: "invalid_request" } }) }] }]);
  assert.equal(fatal.error?.kind, "bad_request");
  assert.equal(fatal.posts, 1);
  const temporary = await run([
    { frames: [{ data: chunk({ content: "x" }) + error_chunk({ code: 503, message: "upstream down", metadata: { error_type: "provider_overloaded" } }) }] },
    { frames: [{ data: chunk({ content: "after outage" }, "stop") }] },
  ]);
  assert.equal(temporary.result?.content, "after outage");
  assert.deepEqual(temporary.log, ["text:x", "retry:2/9:provider_unavailable", "text:after outage"]);
  const untyped = await run([{ frames: [{ data: error_chunk({ code: "server_error", message: "Provider disconnected" }) }] }, { frames: [{ data: chunk({}, "stop") }] }]);
  assert.deepEqual(untyped.log, ["retry:2/9:stream_interrupted"]);
  const policy = await run([{ frames: [{ data: error_chunk({ code: 403, message: "flagged", metadata: { error_type: "content_policy_violation" } }) }] }]);
  assert.equal(policy.error?.kind, "policy");
  assert.equal(policy.posts, 1);
  const cyber = await run([{ frames: [{ data: error_chunk({ code: 400, message: "blocked", metadata: { error_type: "invalid_request", provider_code: "cyber_policy" } }) }] }]);
  assert.equal(cyber.error?.kind, "policy");
});

test("retries back off from 2 s to 120 s and stop after nine attempts with an identical body", async () => {
  const exhausted = await run([{ frames: [{ data: chunk({ content: "partial" }) }] }]);
  assert.equal(exhausted.error?.kind, "stream_interrupted");
  assert.match(exhausted.error?.message ?? "", /gave up after 9 attempts/);
  assert.equal(exhausted.posts, 9);
  assert.equal(new Set(exhausted.bodies).size, 1);
  assert.deepEqual(exhausted.log.filter((line) => line.startsWith("retry")), [2, 3, 4, 5, 6, 7, 8, 9].map((attempt) => `retry:${attempt}/9:stream_interrupted`));
  assert.deepEqual(exhausted.delays, [2000, 5000, 10_000, 20_000, 30_000, 60_000, 120_000, 120_000]);
});

test("retries stop once the next wait would pass ten minutes since the first attempt", async () => {
  let clock = 0;
  const waited: number[] = [];
  const sleep = async (ms: number) => {
    waited.push(ms);
    clock += ms + 400_000;
  };
  const slow = await run([{ frames: [{ data: chunk({ content: "partial" }) }] }], { transport: { now: () => clock, sleep } });
  assert.equal(slow.error?.kind, "stream_interrupted");
  assert.equal(slow.posts, 3);
  assert.deepEqual(waited, [2000, 5000]);
  assert.match(slow.error?.message ?? "", /gave up after 3 attempts/);
});

test("HTTP errors map to the documented kinds", async () => {
  const context = await run([{ status: 400, text: JSON.stringify({ error: { code: 400, message: "too big", metadata: { error_type: "context_length_exceeded" } } }) }]);
  assert.equal(context.error?.kind, "context_limit");
  assert.equal(context.posts, 1);
  const phrase = await run([{ status: 400, text: JSON.stringify({ error: { code: 400, message: "This endpoint's maximum context length is 128000 tokens." } }) }]);
  assert.equal(phrase.error?.kind, "context_limit");
  const not_context = await run([{ status: 400, text: JSON.stringify({ error: { code: 400, message: "max_tokens must be an integer token count" } }) }]);
  assert.equal(not_context.error?.kind, "bad_request");
  const auth = await run([{ status: 401, text: JSON.stringify({ error: { code: 401, message: "No auth credentials found" } }) }]);
  assert.equal(auth.error?.kind, "auth");
  assert.equal(auth.error?.status, 401);
  const credits = await run([{ status: 402, text: JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }) }]);
  assert.equal(credits.error?.kind, "credits");
  assert.equal(credits.posts, 1);
  const moderation = await run([{ status: 403, text: JSON.stringify({ error: { code: 403, message: "flagged", metadata: { reasons: ["x"], flagged_input: "y" } } }) }]);
  assert.equal(moderation.error?.kind, "policy");
  const key_limit = await run([{ status: 403, text: JSON.stringify({ error: { code: 403, message: "Key limit exceeded (total limit)", metadata: { limit_source: "openrouter_key_limit" } } }) }]);
  assert.equal(key_limit.error?.kind, "credits");
  assert.equal(key_limit.posts, 1);
  const html = await run([{ status: 502, text: "<html>bad gateway</html>" }, { frames: [{ data: chunk({ content: "ok" }, "stop") }] }]);
  assert.equal(html.result?.content, "ok");
});

test("provider errors carry the upstream provider, type, code and raw payload in the message", async () => {
  const raw = JSON.stringify({ error: { message: "Invalid tool_call_id", type: "invalid_request_error" } });
  const body = { error: { code: 400, message: "Provider returned error", metadata: { provider_name: "DeepSeek", error_type: "invalid_prompt", provider_code: "invalid_request_error", raw } } };
  const failed = await run([{ status: 400, text: JSON.stringify(body) }]);
  assert.equal(failed.error?.kind, "bad_request");
  assert.equal(failed.error?.message, `OpenRouter 400: Provider returned error (DeepSeek, invalid_prompt, invalid_request_error): ${raw}`);
  const object_raw = await run([{ frames: [{ data: error_chunk({ code: 400, message: "Provider returned error", metadata: { raw: { detail: "bad role" } } }) }] }]);
  assert.equal(object_raw.error?.message, 'OpenRouter 400: Provider returned error: {"detail":"bad role"}');
});

test("rate limits honor Retry-After up to the cap", async () => {
  const limited = await run([
    { status: 429, text: JSON.stringify({ error: { code: 429, message: "slow down" } }), headers: { "retry-after": "5" } },
    { frames: [{ data: chunk({ content: "ok now" }, "stop") }] },
  ]);
  assert.equal(limited.result?.content, "ok now");
  assert.deepEqual(limited.delays, [5000]);
  const long = await run([
    { status: 429, text: "", headers: { "retry-after": "600" } },
    { frames: [{ data: chunk({ content: "ok" }, "stop") }] },
  ]);
  assert.deepEqual(long.delays, [120000]);
  const in_flight = { error: { code: 402, message: "in flight", metadata: { reason: "in_flight_budget_exhausted", limit_source: "openrouter_in_flight_budget" } } };
  const budget = await run([
    { status: 402, text: JSON.stringify(in_flight), headers: { "retry-after": "3" } },
    { frames: [{ data: chunk({ content: "settled" }, "stop") }] },
  ]);
  assert.equal(budget.result?.content, "settled");
  assert.deepEqual(budget.log[0], "retry:2/9:rate_limited");
});

test("a missing key fails with auth before any request", async () => {
  set_key_source(() => "  ");
  const missing = await run([{ frames: [] }]);
  set_key_source(() => "sk-or-test-key");
  assert.equal(missing.error?.kind, "auth");
  assert.equal(missing.posts, 0);
});

test("tool call drafts report the name at once, then the decoded content, and recovered calls get ids", async () => {
  const call = (value: Record<string, unknown>) => chunk({ tool_calls: [{ index: 0, type: "function", ...value }] });
  const drafted = await run(
    [
      {
        frames: [
          { data: call({ id: "call_w", function: { name: "write_file", arguments: "" } }) },
          { data: call({ function: { arguments: '{"path":"a.ts","content":"1\\n2' } }) },
          { data: call({ function: { arguments: "\\n3\\n4\\n5\\n6" } }) },
          { data: call({ function: { arguments: '\\n7"}' } }) + chunk({}, "tool_calls") },
        ],
      },
    ],
    { tools: [write_spec] },
  );
  assert.deepEqual(
    drafted.drafts.map(({ at, ...draft }) => draft),
    [
      { index: 0, name: "write_file", lines: 0 },
      { index: 0, name: "write_file", lines: 7, delta: "1\n2\n3\n4\n5\n6\n7", path: "a.ts" },
    ],
  );
  assert.deepEqual(drafted.result?.tool_calls, [{ index: 0, id: "call_w", name: "write_file", arguments: '{"path":"a.ts","content":"1\\n2\\n3\\n4\\n5\\n6\\n7"}' }]);
  const recovered = await run([{ frames: [{ data: chunk({ content: '<tool_call>{"name":"write_file","arguments":{"path":"b"}}</tool_call>' }, "stop") }] }], {
    tools: [write_spec],
  });
  assert.equal(recovered.result?.content, "");
  assert.equal(recovered.result?.tool_calls[0]?.name, "write_file");
  assert.match(recovered.result?.tool_calls[0]?.id ?? "", /^call_[0-9a-f]{24}$/);
});

test("an exception from a callback propagates unchanged and is not retried", async () => {
  let posts = 0;
  const failure = new Error("engine bug");
  const request = { model, effort: "high", messages: [], tools: [] };
  const callbacks = {
    on_text: () => {
      throw failure;
    },
    on_reasoning: () => {},
    on_tool_draft: () => {},
    on_retry: () => {},
  };
  const fetch_impl = async () => {
    posts += 1;
    return new Response(body_of([{ data: chunk({ content: "x" }, "stop") }]), { status: 200 });
  };
  await assert.rejects(stream_round(request, callbacks, new AbortController().signal, { fetch: fetch_impl }), (error: unknown) => error === failure);
  assert.equal(posts, 1);
});

test("the request body follows the documented shape", () => {
  const body = round_body({
    model,
    effort: "major",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
      { role: "assistant", content: null, tool_calls: [], reasoning_details: [] },
    ],
    tools: [write_spec],
  });
  assert.equal(body.model, "vendor/model");
  assert.equal(body.stream, true);
  assert.equal("max_tokens" in body, false);
  assert.equal(body.tool_choice, "auto");
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  const gpt = round_body({ model: { ...model, id: "openai/gpt-6.1-sol:floor", provider_order: ["openai/flex", "openai"], verbosity: "low" }, effort: "high", messages: [], tools: [] });
  assert.deepEqual(gpt.reasoning, { effort: "high", summary: "detailed" });
  assert.equal(gpt.verbosity, "low");
  assert.equal("verbosity" in body, false);
  const oss = round_body({ model: { ...model, id: "openai/gpt-oss-120b", provider_order: ["cerebras/fp16"] }, effort: "high", messages: [], tools: [] });
  assert.deepEqual(oss.reasoning, { effort: "high" });
  assert.deepEqual(body.provider, { order: ["vendor"], allow_fallbacks: false });
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "write_file", description: "write", parameters: { type: "object", properties: {} } } }]);
  assert.equal((body.messages as unknown[]).length, 2);
  const plain = round_body({ model: { ...model, efforts: [], default_effort: "", provider_order: [] }, effort: "high", messages: [], tools: [] });
  assert.equal("reasoning" in plain, false);
  assert.equal("provider" in plain, false);
  assert.equal("tools" in plain, false);
  assert.equal("safety_settings" in plain, false);
  const gemini = round_body({ model: { ...model, id: "google/gemini-3.8-flash:floor" }, effort: "high", messages: [], tools: [] });
  assert.deepEqual(
    (gemini.safety_settings as { category: string; threshold: string }[]).map((entry) => `${entry.category}=${entry.threshold}`),
    ["HARM_CATEGORY_HARASSMENT=OFF", "HARM_CATEGORY_HATE_SPEECH=OFF", "HARM_CATEGORY_SEXUALLY_EXPLICIT=OFF", "HARM_CATEGORY_DANGEROUS_CONTENT=OFF", "HARM_CATEGORY_CIVIC_INTEGRITY=OFF"],
  );
  assert.equal("cache_control" in plain, false);
  assert.equal("cache_control" in gemini, false);
  const claude = round_body({ model: { ...model, id: "anthropic/claude-opus-5.5" }, effort: "high", messages: [], tools: [] });
  assert.deepEqual(claude.cache_control, { type: "ephemeral" });
});

test("a model with a fallback retries its own route three times, then continues on the fallback route", async () => {
  const fast: ModelEntry = { ...model, id: "z-ai/glm-5.3:nitro", provider_order: ["baseten/fast"], fallback: { id: "z-ai/glm-5.3", label: "GLM 5.3", provider_order: ["gmicloud/fp8", "baidu/fp8"] } };
  const limited = { status: 429, text: JSON.stringify({ error: { code: 429, message: "rate limited upstream" } }) };
  const done = await run([limited, limited, limited, { frames: [{ data: chunk({ content: "ok" }, "stop") }] }], { model: fast });
  assert.equal(done.error, null);
  assert.equal(done.result?.content, "ok");
  assert.equal(done.posts, 4);
  const routes = done.bodies.map((body) => JSON.parse(body) as { model: string; provider: { order: string[] } });
  assert.deepEqual(routes.map((body) => body.model), ["z-ai/glm-5.3:nitro", "z-ai/glm-5.3:nitro", "z-ai/glm-5.3:nitro", "z-ai/glm-5.3"]);
  assert.deepEqual(routes[3]?.provider.order, ["gmicloud/fp8", "baidu/fp8"]);
  assert.deepEqual(done.log.filter((line) => line.startsWith("retry")), ["retry:2/12:rate_limited", "retry:3/12:rate_limited", "retry:4/12:GLM 5.3"]);
  const refused = await run([{ status: 401, text: JSON.stringify({ error: { code: 401, message: "bad key" } }) }], { model: fast });
  assert.equal(refused.error?.kind, "auth");
  assert.equal(refused.posts, 1);
});
