import { ModelError } from "../errors.ts";
import { create_sse_parser, type SseItem } from "../sse.ts";
import { create_draft_reporter, make_call_id, read_chunk } from "../stream.ts";
import { attempt_failure, create_watchdog, transport_with, with_retries, type Transport, type Watchdog } from "../transport.ts";
import type { RoundCallbacks, RoundRequest, RoundResult } from "../types.ts";
import { round_plan_body } from "./body.ts";
import { plan_error } from "./errors.ts";
import { create_plan_accumulator, type PlanAccumulator, type PlanPush } from "./events.ts";
import { plan_provider, send_plan, type PlanReply } from "./send.ts";
import { plan_source } from "./source.ts";

type Reader = ReadableStreamDefaultReader<Uint8Array>;

type PlanReadHooks = { idle_ms: number | null; on_push(outcome: PlanPush): void; after_chunk(): void };

const parse_event = (data: string): unknown => {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn(`[plan] malformed stream event (${String(error)}): ${data.slice(0, 200)}`);
    throw new ModelError("stream_interrupted", "The ChatGPT plan sent a malformed stream event before the answer was complete.");
  }
};

const read_next = async (reader: Reader, watchdog: Watchdog) => {
  try {
    return await read_chunk(reader, watchdog.signal);
  } catch (error) {
    throw attempt_failure(error, watchdog, "read", plan_provider);
  }
};

export const read_plan_stream = async (reply: PlanReply, accumulator: PlanAccumulator, watchdog: Watchdog, hooks: PlanReadHooks): Promise<boolean> => {
  if (!reply.response.body) {
    throw new ModelError("stream_interrupted", "The ChatGPT plan answered without a stream body.");
  }
  const reader = reply.response.body.getReader();
  const parser = create_sse_parser();
  const decoder = new TextDecoder();
  const context = { retry_after_ms: 0, request_id: reply.request_id, token: reply.token };
  let terminal = false;
  const consume = (items: SseItem[]): boolean => {
    for (const item of items) {
      if (hooks.idle_ms !== null) {
        watchdog.arm(hooks.idle_ms, "idle");
      }
      if (item.kind !== "event") {
        continue;
      }
      if (item.data === "[DONE]") {
        return true;
      }
      const outcome = accumulator.push(parse_event(item.data));
      if (outcome.failure) {
        throw plan_error(null, outcome.failure, context);
      }
      hooks.on_push(outcome);
      if (outcome.terminal) {
        terminal = true;
        return true;
      }
    }
    return false;
  };
  for (;;) {
    const read = await read_next(reader, watchdog);
    if (read.done) {
      consume([...parser.feed(decoder.decode()), ...parser.end()]);
      return terminal;
    }
    const stop = consume(parser.feed(decoder.decode(read.value, { stream: true })));
    hooks.after_chunk();
    if (stop) {
      return terminal;
    }
  }
};

export const note_rejected_model = (error: unknown, model_id: string) => {
  if (error instanceof ModelError && error.kind === "plan_model") {
    plan_source().model_rejected(model_id);
  }
};

const partial_result = (accumulator: PlanAccumulator | null): RoundResult => ({
  status: "cancelled",
  content: accumulator?.content() ?? "",
  reasoning: accumulator?.reasoning() ?? "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "",
  usage: null,
});

const run_attempt = async (body: string, accumulator: PlanAccumulator, callbacks: RoundCallbacks, signal: AbortSignal, transport: Transport): Promise<RoundResult> => {
  const watchdog = create_watchdog(signal);
  const drafts = create_draft_reporter(accumulator, callbacks, transport.now);
  const on_push = (outcome: PlanPush) => {
    if (outcome.reasoning || outcome.text) {
      drafts.flush(true);
    }
    if (outcome.reasoning) {
      callbacks.on_reasoning(outcome.reasoning);
    }
    if (outcome.text) {
      callbacks.on_text(outcome.text);
    }
    drafts.note(outcome.drafted);
  };
  let terminal = false;
  watchdog.arm(transport.first_byte_ms, "first_byte");
  try {
    const reply = await send_plan(body, watchdog, transport);
    terminal = await read_plan_stream(reply, accumulator, watchdog, { idle_ms: transport.idle_ms, on_push, after_chunk: () => drafts.flush(false) });
  } catch (error) {
    if (signal.aborted) {
      return partial_result(accumulator);
    }
    throw error;
  } finally {
    watchdog.dispose();
  }
  if (signal.aborted) {
    return partial_result(accumulator);
  }
  if (!terminal) {
    throw new ModelError("stream_interrupted", "The ChatGPT plan closed the stream before the answer was complete.");
  }
  drafts.flush(true);
  const assembly = accumulator.finish(make_call_id);
  return {
    status: "completed",
    content: assembly.content,
    reasoning: assembly.reasoning,
    reasoning_details: assembly.reasoning_details,
    tool_calls: assembly.tool_calls,
    finish_reason: assembly.finish_reason,
    usage: assembly.usage,
  };
};

export const stream_plan_round = async (
  request: RoundRequest,
  callbacks: RoundCallbacks,
  signal: AbortSignal,
  overrides: Partial<Transport> = {},
): Promise<RoundResult> => {
  const transport = transport_with(overrides);
  try {
    const body = JSON.stringify(round_plan_body(request));
    let current: PlanAccumulator | null = null;
    return await with_retries({
      transport,
      signal,
      run: () => {
        current = create_plan_accumulator();
        return run_attempt(body, current, callbacks, signal, transport);
      },
      cancelled: () => partial_result(current),
      on_retry: (attempt, max, reason, wait_ms) => {
        current = null;
        callbacks.on_retry(attempt, max, reason, wait_ms);
      },
    });
  } catch (error) {
    note_rejected_model(error, request.model.id);
    throw error;
  }
};
