import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import type { AccountModel } from "../shared/chatgpt.ts";
import type { ModelEntry } from "../shared/models.ts";
import type { BillingMode } from "../shared/settings.ts";
import { ModelError } from "../electron/model/errors.ts";
import { plan_source, set_plan_source, type PlanSource } from "../electron/model/plan/source.ts";
import { stream_plan_round } from "../electron/model/plan/stream.ts";
import type { Transport } from "../electron/model/transport.ts";
import type { ApiMessage, RoundRequest, RoundResult, ToolDraftUpdate } from "../electron/model/types.ts";
import type { ToolSpec } from "../electron/tools/types.ts";
import { body_of, type Frame } from "./model-stream-harness.ts";

export type Reply = { status?: number; text?: string; headers?: Record<string, string>; frames?: Frame[] };

export type Sent = { url: string; method: string; headers: Record<string, string>; redirect: string; raw: string; encoded: boolean; body: Record<string, unknown> };

export const forbidden_keys = [
  "max_output_tokens",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "metadata",
  "user",
  "prompt_cache_retention",
  "prompt_cache_key",
  "prompt_cache_options",
  "include",
  "service_tier",
  "previous_response_id",
  "truncation",
  "instructions",
  "stream_options",
  "provider",
  "session_id",
  "safety_settings",
  "messages",
  "tools",
];

export const plan_model: ModelEntry = {
  id: "openai/gpt-6.2-sol",
  label: "GPT-6.2 Sol",
  provider: "OpenAI",
  provider_order: ["openai"],
  efforts: ["low", "medium", "high", "xhigh", "major"],
  default_effort: "medium",
  vision: true,
  context_length: 400000,
  max_output: 128000,
  reasoning_passback: true,
  verbosity: "medium",
};

export const event = (payload: Record<string, unknown>, named = false) => `${named ? `event: ${String(payload.type)}\n` : ""}data: ${JSON.stringify(payload)}\n\n`;

export const usage = { input_tokens: 120, input_tokens_details: { cached_tokens: 64, cache_write_tokens: 8 }, output_tokens: 30, output_tokens_details: { reasoning_tokens: 12 }, total_tokens: 150 };

export const created = () => event({ type: "response.created", sequence_number: 0, response: { id: "resp_1", status: "in_progress", output: [] } });

export const completed = (value: Record<string, unknown> = usage) => event({ type: "response.completed", response: { id: "resp_1", status: "completed", output: [], usage: value } });

export const incomplete = (reason: string) => event({ type: "response.incomplete", response: { id: "resp_1", status: "incomplete", incomplete_details: { reason }, usage } });

export const failed = (code: string, message: string) => event({ type: "response.failed", response: { id: "resp_1", status: "failed", error: { code, message } } });

export const text_delta = (delta: string, item_id = "msg_1", output_index = 0) =>
  event({ type: "response.output_text.delta", item_id, output_index, content_index: 0, delta });

export const message_item = (text: string, id = "msg_1") => ({
  type: "message",
  id,
  role: "assistant",
  status: "completed",
  phase: "final_answer",
  content: [{ type: "output_text", text, annotations: [] }],
});

export const reasoning_item = (id: string, summary: string) => ({ type: "reasoning", id, summary: [{ type: "summary_text", text: summary }], encrypted_content: `enc-${id}` });

export const call_item = (call_id: string, name: string, id: string, args: string) => ({ type: "function_call", id, call_id, name, arguments: args, status: "completed" });

export const item_done = (output_index: number, item: Record<string, unknown>) => event({ type: "response.output_item.done", output_index, item });

export const call_added = (output_index: number, call_id: string, name: string, id: string) =>
  event({ type: "response.output_item.added", output_index, item: { type: "function_call", id, call_id, name, arguments: "", status: "in_progress" } });

export const call_delta = (output_index: number, id: string, delta: string) => event({ type: "response.function_call_arguments.delta", item_id: id, output_index, delta });

export const answer_frames = (text: string): Frame[] => [{ data: created() }, { data: text_delta(text) }, { data: item_done(0, message_item(text)) + completed() }];

export type FakeSource = { source: PlanSource; renewed: string[]; rejected: string[] };

export const fake_source = (
  billing: BillingMode = "chatgpt",
  tokens: string[] = ["plan-token-1", "plan-token-2"],
  account: readonly AccountModel[] | null = null,
): FakeSource => {
  const renewed: string[] = [];
  const rejected: string[] = [];
  let at = 0;
  const source: PlanSource = {
    billing: () => billing,
    access_token: async () => tokens[at] ?? "",
    renewed_token: async (token) => {
      renewed.push(token);
      at = Math.min(at + 1, tokens.length - 1);
      return tokens[at] ?? "";
    },
    model_rejected: (model_id) => {
      rejected.push(model_id);
    },
    account_models: () => account,
  };
  return { source, renewed, rejected };
};

export const with_source = async <T>(source: PlanSource, run: () => Promise<T>): Promise<T> => {
  const previous = plan_source();
  set_plan_source(source);
  try {
    return await run();
  } finally {
    set_plan_source(previous);
  }
};

const decoded = (init: RequestInit, headers: Record<string, string>): { raw: string; encoded: boolean } => {
  if (headers["Content-Encoding"] === "zstd") {
    return { raw: zstdDecompressSync(Buffer.from(init.body as Uint8Array)).toString("utf8"), encoded: true };
  }
  return { raw: String(init.body), encoded: false };
};

export type FakeFetch = { transport: Partial<Transport>; sent: Sent[]; delays: number[]; clock: { now: number } };

export const fake_fetch = (replies: Reply[], overrides: Partial<Transport> = {}): FakeFetch => {
  const sent: Sent[] = [];
  const delays: number[] = [];
  const clock = { now: 0 };
  const transport: Partial<Transport> = {
    fetch: async (url, init) => {
      const reply = replies[Math.min(sent.length, replies.length - 1)] ?? {};
      const headers = { ...(init.headers as Record<string, string>) };
      const { raw, encoded } = decoded(init, headers);
      sent.push({ url, method: String(init.method), headers, redirect: String(init.redirect), raw, encoded, body: JSON.parse(raw) as Record<string, unknown> });
      if (reply.status && reply.status >= 400) {
        return new Response(reply.text ?? "", { status: reply.status, headers: reply.headers ?? {} });
      }
      return new Response(body_of(reply.frames ?? [], clock), { status: 200, headers: { "content-type": "text/event-stream", ...reply.headers } });
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
    now: () => clock.now,
    first_byte_ms: 200,
    idle_ms: 200,
    ...overrides,
  };
  return { transport, sent, delays, clock };
};

export type PlanRun = {
  result: RoundResult | null;
  error: ModelError | null;
  sent: Sent[];
  log: string[];
  delays: number[];
  drafts: (ToolDraftUpdate & { index: number; name: string })[];
  renewed: string[];
  rejected: string[];
};

export type PlanRunOptions = {
  messages?: ApiMessage[];
  tools?: ToolSpec[];
  tool_choice?: "none";
  model?: ModelEntry;
  effort?: string;
  max_tokens?: number;
  transport?: Partial<Transport>;
  signal?: AbortSignal;
  abort_after_text?: AbortController;
  tokens?: string[];
  cache_key?: string;
};

export const plan_run = async (replies: Reply[], options: PlanRunOptions = {}): Promise<PlanRun> => {
  const fake = fake_fetch(replies, options.transport);
  const { source, renewed, rejected } = fake_source("chatgpt", options.tokens);
  const log: string[] = [];
  const drafts: PlanRun["drafts"] = [];
  const callbacks = {
    on_text: (delta: string) => {
      log.push(`text:${delta}`);
      options.abort_after_text?.abort();
    },
    on_reasoning: (delta: string) => log.push(`reasoning:${delta}`),
    on_tool_draft: (index: number, name: string, draft: ToolDraftUpdate) => {
      log.push(`draft:${index}:${name}`);
      drafts.push({ ...draft, index, name });
    },
    on_retry: (attempt: number, max: number, reason: string) => log.push(`retry:${attempt}/${max}:${reason}`),
  };
  const request: RoundRequest = {
    model: options.model ?? plan_model,
    effort: options.effort ?? "high",
    messages: options.messages ?? [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hi" },
    ],
    tools: options.tools ?? [],
    ...(options.tool_choice ? { tool_choice: options.tool_choice } : {}),
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
    ...(options.cache_key ? { cache_key: options.cache_key } : {}),
  };
  const signal = options.signal ?? options.abort_after_text?.signal ?? new AbortController().signal;
  return with_source(source, async () => {
    try {
      const result = await stream_plan_round(request, callbacks, signal, fake.transport);
      return { result, error: null, sent: fake.sent, log, delays: fake.delays, drafts, renewed, rejected };
    } catch (error) {
      assert.ok(error instanceof ModelError, `unexpected error ${String(error)}`);
      return { result: null, error, sent: fake.sent, log, delays: fake.delays, drafts, renewed, rejected };
    }
  });
};
