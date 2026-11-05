import assert from "node:assert/strict";
import type { ModelEntry } from "../shared/models.ts";
import { ModelError } from "../electron/model/errors.ts";
import { stream_round } from "../electron/model/stream.ts";
import type { Transport } from "../electron/model/transport.ts";
import type { RoundResult, ToolDraftUpdate } from "../electron/model/types.ts";
import type { ToolSpec } from "../electron/tools/types.ts";

export type Frame = { data?: string; error?: string; hang?: boolean; wait?: number; at?: number };

export type Plan = { status?: number; text?: string; headers?: Record<string, string>; frames?: Frame[] };

type Clock = { now: number };

const encoder = new TextEncoder();

export const body_of = (frames: Frame[], clock: Clock = { now: 0 }) => {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const frame = frames[index];
        index += 1;
        if (!frame) {
          controller.close();
          return;
        }
        if (frame.wait) {
          await new Promise((resolve) => setTimeout(resolve, frame.wait));
        }
        if (frame.hang) {
          await new Promise(() => {});
        }
        if (frame.error) {
          controller.error(new TypeError(frame.error));
          return;
        }
        if (frame.at !== undefined) {
          clock.now = frame.at;
        }
        controller.enqueue(encoder.encode(frame.data ?? ""));
      },
    },
    { highWaterMark: 0 },
  );
};

export const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

export const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) =>
  sse({ id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason }] });

export const error_chunk = (error: Record<string, unknown>) =>
  sse({ id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", error, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] });

export const model: ModelEntry = {
  id: "vendor/model",
  label: "Model",
  provider: "Vendor",
  provider_order: ["vendor"],
  efforts: ["low", "high", "xhigh", "major"],
  default_effort: "high",
  vision: false,
  context_length: 100000,
  max_output: 8000,
  reasoning_passback: false,
};

export const write_spec: ToolSpec = { name: "write_file", description: "write", parameters: { type: "object", properties: {} } };

export type Drafted = ToolDraftUpdate & { index: number; name: string; at: number };

export type Run = {
  result: RoundResult | null;
  error: ModelError | null;
  posts: number;
  bodies: string[];
  headers: Record<string, string>[];
  log: string[];
  delays: number[];
  drafts: Drafted[];
};

export type RunOptions = { signal?: AbortSignal; tools?: ToolSpec[]; abort_after_text?: AbortController; transport?: Partial<Transport>; model?: ModelEntry; max_tokens?: number };

export const run = async (plans: Plan[], options: RunOptions = {}): Promise<Run> => {
  const clock: Clock = { now: 0 };
  const bodies: string[] = [];
  const headers: Record<string, string>[] = [];
  const log: string[] = [];
  const delays: number[] = [];
  const drafts: Drafted[] = [];
  let posts = 0;
  const fetch_impl = async (_url: string, init: RequestInit) => {
    const plan = plans[Math.min(posts, plans.length - 1)] ?? {};
    posts += 1;
    bodies.push(String(init.body));
    headers.push(init.headers as Record<string, string>);
    if (plan.status && plan.status >= 400) {
      return new Response(plan.text ?? "", { status: plan.status, headers: plan.headers ?? {} });
    }
    return new Response(body_of(plan.frames ?? [], clock), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const callbacks = {
    on_text: (delta: string) => {
      log.push(`text:${delta}`);
      options.abort_after_text?.abort();
    },
    on_reasoning: (delta: string) => log.push(`reasoning:${delta}`),
    on_tool_draft: (index: number, name: string, draft: ToolDraftUpdate) => {
      log.push(`draft:${index}:${name}:${draft.lines}`);
      drafts.push({ ...draft, index, name, at: clock.now });
    },
    on_retry: (attempt: number, max: number, reason: string) => log.push(`retry:${attempt}/${max}:${reason}`),
  };
  const transport: Partial<Transport> = {
    fetch: fetch_impl,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
    now: () => clock.now,
    first_byte_ms: 60,
    idle_ms: 60,
    ...options.transport,
  };
  const request = { model: options.model ?? model, effort: "high", messages: [{ role: "user" as const, content: "hi" }], tools: options.tools ?? [], ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}) };
  try {
    const result = await stream_round(request, callbacks, options.signal ?? options.abort_after_text?.signal ?? new AbortController().signal, transport);
    return { result, error: null, posts, bodies, headers, log, delays, drafts };
  } catch (error) {
    assert.ok(error instanceof ModelError, `unexpected error ${String(error)}`);
    return { result: null, error, posts, bodies, headers, log, delays, drafts };
  }
};
