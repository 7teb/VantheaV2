import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountModel } from "../shared/chatgpt.ts";
import type { ModelEntry } from "../shared/models.ts";
import { complete } from "../electron/model/complete.ts";
import type { CompleteRequest } from "../electron/model/completion-body.ts";
import { ModelError } from "../electron/model/errors.ts";
import { set_key_source } from "../electron/model/key.ts";
import { wrap_output } from "../electron/model/plan/input.ts";
import { plan_responses_url } from "../electron/model/plan/send.ts";
import { plan_source } from "../electron/model/plan/source.ts";
import { complete_model, stream_model } from "../electron/model/provider.ts";
import { stream_round } from "../electron/model/stream.ts";
import { api_base, type Transport } from "../electron/model/transport.ts";
import type { ApiMessage, RoundRequest } from "../electron/model/types.ts";
import { body_of, chunk, write_spec, type Frame } from "./model-stream-harness.ts";
import { answer_frames, call_item, fake_source, message_item, plan_model, with_source, type Reply } from "./plan-harness.ts";

set_key_source(() => "sk-or-test-key");

type Seen = { url: string; method: string; headers: unknown; body: unknown };

const openrouter_frames: Frame[] = [{ data: chunk({ content: "hello" }) + chunk({}, "stop") + "data: [DONE]\n\n" }];

const completion_text = JSON.stringify({ id: "gen-1", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] });

const capture = (plan_replies: Reply[] = []) => {
  const seen: Seen[] = [];
  let plan_posts = 0;
  const transport: Partial<Transport> = {
    fetch: async (url, init) => {
      seen.push({ url, method: String(init.method), headers: init.headers, body: init.body });
      if (url === plan_responses_url) {
        const reply = plan_replies[Math.min(plan_posts, plan_replies.length - 1)] ?? {};
        plan_posts += 1;
        if (reply.status && reply.status >= 400) {
          return new Response(reply.text ?? "", { status: reply.status });
        }
        return new Response(body_of(reply.frames ?? []), { status: 200 });
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.stream ? new Response(body_of(openrouter_frames), { status: 200 }) : new Response(completion_text, { status: 200 });
    },
    sleep: async () => {},
    random: () => 0,
    first_byte_ms: 200,
    idle_ms: 200,
  };
  return { seen, transport };
};

const callbacks = { on_text: () => {}, on_reasoning: () => {}, on_tool_draft: () => {}, on_retry: () => {} };

const gemini: ModelEntry = { ...plan_model, id: "google/gemini-3-flash", provider: "Google", provider_order: ["google-vertex"], verbosity: undefined };

const cerebras_oss: ModelEntry = { ...plan_model, id: "openai/gpt-oss-120b", provider_order: ["cerebras"], verbosity: undefined };

const deepseek: ModelEntry = { ...plan_model, id: "deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash", provider: "DeepSeek", provider_order: ["deepseek"], verbosity: undefined };

const claude: ModelEntry = { ...plan_model, id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "Anthropic", provider_order: ["anthropic"], verbosity: undefined };

const sol_pro: ModelEntry = { ...plan_model, id: "openai/gpt-6.2-sol-pro", label: "GPT-6.2 Sol Pro" };

const listed = (...slugs: string[]): AccountModel[] => slugs.map((slug) => ({ slug, display_name: slug, context_window: null, service_tiers: [] }));

const plan_tokens = ["plan-token-1", "plan-token-2"];

const round = (model: ModelEntry, messages?: ApiMessage[]): RoundRequest => ({
  model,
  effort: "high",
  messages: messages ?? [
    { role: "system", content: "system prompt" },
    { role: "user", content: "hi" },
  ],
  tools: [write_spec],
  max_tokens: 32000,
});

const completion = (model_id: string): CompleteRequest => ({
  model_id,
  messages: [{ role: "user", content: "title this" }],
  max_tokens: 40,
  temperature: 0.2,
  reasoning_effort: "minimal",
  session_id: "vx-side:1",
});

const streamed_both = async (request: RoundRequest) => {
  const direct = capture();
  await stream_round(request, callbacks, new AbortController().signal, direct.transport);
  const routed = capture();
  await stream_model(request, callbacks, new AbortController().signal, routed.transport);
  return { direct: direct.seen, routed: routed.seen };
};

test("with the default source every round request is byte-identical to stream_round", async () => {
  assert.equal(plan_source().billing(), "api");
  for (const model of [plan_model, gemini, cerebras_oss]) {
    const { direct, routed } = await streamed_both(round(model));
    assert.equal(direct.length, 1);
    assert.deepEqual(routed, direct);
    assert.equal(routed[0]?.url, `${api_base}/chat/completions`);
  }
});

test("with the default source every completion request is byte-identical to complete", async () => {
  for (const model_id of ["openai/gpt-6-luna", "google/gemini-3-flash"]) {
    const direct = capture();
    await complete(completion(model_id), undefined, direct.transport);
    const routed = capture();
    await complete_model(completion(model_id), undefined, routed.transport);
    assert.deepEqual(routed.seen, direct.seen);
    assert.equal(routed.seen[0]?.url, `${api_base}/chat/completions`);
  }
});

const wrapped_messages = (): ApiMessage[] => [
  { role: "system", content: "system prompt" },
  { role: "user", content: "go" },
  {
    role: "assistant",
    content: "done",
    reasoning_details: wrap_output([message_item("done"), call_item("call_p", "write_file", "fc_1", "{}")]),
    tool_calls: [{ id: "call_wire", type: "function", function: { name: "write_file", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "call_wire", content: "written" },
];

test("a wrapped history goes to OpenRouter without its plan items", async () => {
  const routed = capture();
  await stream_model(round(plan_model, wrapped_messages()), callbacks, new AbortController().signal, routed.transport);
  const body = JSON.parse(String(routed.seen[0]?.body)) as { messages: Record<string, unknown>[] };
  assert.equal(routed.seen[0]?.url, `${api_base}/chat/completions`);
  assert.equal("reasoning_details" in (body.messages[2] ?? {}), false);
  assert.deepEqual(body.messages[2]?.tool_calls, [{ id: "call_wire", type: "function", function: { name: "write_file", arguments: "{}" } }]);
  const stripped = wrapped_messages().map((message) => (message.role === "assistant" ? { role: message.role, content: message.content, tool_calls: message.tool_calls } : message));
  const direct = capture();
  await stream_round(round(plan_model, stripped), callbacks, new AbortController().signal, direct.transport);
  assert.deepEqual(routed.seen, direct.seen);
});

test("plan billing routes eligible models to the plan and the rest to OpenRouter unchanged", async () => {
  const { source } = fake_source("chatgpt");
  await with_source(source, async () => {
    const plan = capture([{ frames: answer_frames("plan answer") }]);
    const result = await stream_model(round(plan_model), callbacks, new AbortController().signal, plan.transport);
    assert.equal(result.content, "plan answer");
    assert.deepEqual(
      plan.seen.map((seen) => seen.url),
      [plan_responses_url],
    );
    for (const model of [gemini, cerebras_oss]) {
      const { direct, routed } = await streamed_both(round(model));
      assert.deepEqual(routed, direct);
      assert.equal(routed[0]?.url, `${api_base}/chat/completions`);
    }
    const side = capture([{ frames: answer_frames("Short title") }]);
    const titled = await complete_model(completion("openai/gpt-6-luna"), undefined, side.transport);
    assert.equal(titled.text, "Short title");
    assert.equal(titled.meta.cost, null);
    assert.equal(side.seen[0]?.url, plan_responses_url);
    const vendor = capture();
    await complete_model(completion("google/gemini-3-flash"), undefined, vendor.transport);
    assert.equal(vendor.seen[0]?.url, `${api_base}/chat/completions`);
  });
});

test("API billing sends OpenAI models to OpenRouter", async () => {
  const { source } = fake_source("api");
  await with_source(source, async () => {
    const { direct, routed } = await streamed_both(round(plan_model));
    assert.deepEqual(routed, direct);
    const side = capture();
    await complete_model(completion("openai/gpt-6-luna"), undefined, side.transport);
    assert.equal(side.seen[0]?.url, `${api_base}/chat/completions`);
  });
});

test("a plan limit or a refused sign-in never falls back to OpenRouter", async () => {
  const limit: Reply = { status: 429, text: '{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Usage limit reached"}}' };
  const unauthorized: Reply = { status: 401, text: '{"detail":"Unauthorized"}' };
  for (const account of [null, listed("gpt-6.2-sol", "gpt-6-luna")]) {
    const { source } = fake_source("chatgpt", plan_tokens, account);
    await with_source(source, async () => {
      for (const [replies, kind] of [
        [[limit], "plan_limit"],
        [[unauthorized, unauthorized], "plan_auth"],
      ] as const) {
        const routed = capture([...replies]);
        await assert.rejects(
          stream_model(round(plan_model), callbacks, new AbortController().signal, routed.transport),
          (error: unknown) => error instanceof ModelError && error.kind === kind,
        );
        const side = capture([...replies]);
        await assert.rejects(complete_model(completion("openai/gpt-6-luna"), undefined, side.transport), (error: unknown) => error instanceof ModelError && error.kind === kind);
        const urls = [...routed.seen, ...side.seen].map((seen) => seen.url);
        assert.ok(urls.length > 0);
        assert.ok(
          urls.every((url) => url === plan_responses_url),
          urls.join(", "),
        );
      }
    });
  }
});

test("plan billing sends DeepSeek and Claude to OpenRouter byte-identical to stream_round", async () => {
  for (const account of [null, listed("gpt-6.2-sol")]) {
    const { source } = fake_source("chatgpt", plan_tokens, account);
    await with_source(source, async () => {
      for (const model of [deepseek, claude]) {
        const { direct, routed } = await streamed_both(round(model));
        assert.equal(direct.length, 1);
        assert.deepEqual(routed, direct);
        assert.equal(routed[0]?.url, `${api_base}/chat/completions`);
      }
    });
  }
});

test("plan billing without an OpenRouter key shows the missing-key error for models off the plan and sends nothing", async () => {
  const { source } = fake_source("chatgpt", plan_tokens, listed("gpt-6-luna"));
  set_key_source(() => "");
  try {
    await with_source(source, async () => {
      for (const model of [deepseek, claude, plan_model]) {
        const routed = capture();
        await assert.rejects(
          stream_model(round(model), callbacks, new AbortController().signal, routed.transport),
          (error: unknown) => error instanceof ModelError && error.kind === "auth" && /No OpenRouter API key is set/.test(error.message),
        );
        assert.equal(routed.seen.length, 0, model.id);
      }
    });
  } finally {
    set_key_source(() => "sk-or-test-key");
  }
});

test("plan billing sends an OpenAI model the account does not list to OpenRouter and a listed one only to the plan", async () => {
  const unlisted = fake_source("chatgpt", plan_tokens, listed("gpt-6-luna"));
  await with_source(unlisted.source, async () => {
    const { direct, routed } = await streamed_both(round(plan_model));
    assert.deepEqual(routed, direct);
    assert.equal(routed[0]?.url, `${api_base}/chat/completions`);
  });
  const named = fake_source("chatgpt", plan_tokens, listed("gpt-6.2-sol"));
  await with_source(named.source, async () => {
    const plan = capture([{ frames: answer_frames("plan answer") }]);
    const result = await stream_model(round(plan_model), callbacks, new AbortController().signal, plan.transport);
    assert.equal(result.content, "plan answer");
    assert.deepEqual(
      plan.seen.map((seen) => seen.url),
      [plan_responses_url],
    );
  });
});

test("a pro variant runs on the plan only when the account lists the pro model", async () => {
  const base_only = fake_source("chatgpt", plan_tokens, listed("gpt-6.2-sol"));
  await with_source(base_only.source, async () => {
    const { direct, routed } = await streamed_both(round(sol_pro));
    assert.deepEqual(routed, direct);
    assert.equal(routed[0]?.url, `${api_base}/chat/completions`);
  });
  const with_pro = fake_source("chatgpt", plan_tokens, listed("gpt-6.2-sol", "gpt-6.2-sol-pro"));
  await with_source(with_pro.source, async () => {
    const plan = capture([{ frames: answer_frames("pro answer") }]);
    await stream_model(round(sol_pro), callbacks, new AbortController().signal, plan.transport);
    assert.deepEqual(
      plan.seen.map((seen) => seen.url),
      [plan_responses_url],
    );
  });
});

test("side jobs keep going through the plan when the account does not list their model", async () => {
  const { source } = fake_source("chatgpt", plan_tokens, listed("gpt-6.2-sol"));
  await with_source(source, async () => {
    const side = capture([{ frames: answer_frames("Short title") }]);
    const titled = await complete_model(completion("openai/gpt-6-luna"), undefined, side.transport);
    assert.equal(titled.text, "Short title");
    assert.deepEqual(
      side.seen.map((seen) => seen.url),
      [plan_responses_url],
    );
  });
});
