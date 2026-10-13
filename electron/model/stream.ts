import { randomUUID } from "node:crypto";
import { create_accumulator, type Accumulator } from "./accumulator.ts";
import { reasoning_fields } from "./catalog.ts";
import type { DraftTake } from "./draft-decoder.ts";
import { classify_provider_error, is_retryable, ModelError } from "./errors.ts";
import { prompt_cache_fields } from "./prompt-cache.ts";
import { safety_fields } from "./safety.ts";
import { create_sse_parser } from "./sse.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "./transport.ts";
import { to_api_tools, wire_messages, type RoundCallbacks, type RoundRequest, type RoundResult, type ToolDraftUpdate } from "./types.ts";

type Reader = ReadableStreamDefaultReader<Uint8Array>;

type ReadResult = Awaited<ReturnType<Reader["read"]>>;

type DraftReport = { name: string; at: number };

type DraftReporter = { note(indices: number[]): void; flush(force: boolean): void };

export const draft_interval_ms = 80;

const fallback_after_attempts = 3;

export const make_call_id = () => `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

export const round_body = (request: RoundRequest): Record<string, unknown> => {
  const { model } = request;
  return {
    model: model.id,
    messages: wire_messages(request.messages, model.reasoning_passback),
    stream: true,
    temperature: 0.2,
    ...(request.tools.length ? { tools: to_api_tools(request.tools), tool_choice: request.tool_choice ?? "auto" } : {}),
    ...(model.efforts.length ? { reasoning: reasoning_fields(model, request.effort) } : {}),
    ...(model.provider_order.length ? { provider: { order: model.provider_order, allow_fallbacks: false } } : {}),
    ...safety_fields(model.id),
    ...prompt_cache_fields(model.id),
  };
};

const read_chunk = (reader: Reader, signal: AbortSignal) =>
  new Promise<ReadResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });

const partial_result = (accumulator: Accumulator | null): RoundResult => ({
  status: "cancelled",
  content: accumulator?.content() ?? "",
  reasoning: accumulator?.reasoning() ?? "",
  reasoning_details: [],
  tool_calls: [],
  finish_reason: "",
  usage: null,
});

const draft_update = (take: DraftTake | null): ToolDraftUpdate => {
  if (!take) {
    return { lines: null };
  }
  return {
    lines: take.lines,
    ...(take.delta ? { delta: take.delta } : {}),
    ...(take.path !== null ? { path: take.path } : {}),
    ...(take.old_text !== null ? { old_text: take.old_text } : {}),
  };
};

const create_draft_reporter = (accumulator: Accumulator, callbacks: RoundCallbacks, now: () => number): DraftReporter => {
  const reports = new Map<number, DraftReport>();
  const report = (index: number, name: string) => callbacks.on_tool_draft(index, name, draft_update(accumulator.draft(index)?.take() ?? null));
  return {
    note: (indices) => {
      for (const index of indices) {
        const name = accumulator.tool(index)?.name ?? "";
        if (!name || reports.get(index)?.name === name) {
          continue;
        }
        reports.set(index, { name, at: now() });
        report(index, name);
      }
    },
    flush: (force) => {
      const time = now();
      for (const [index, entry] of reports) {
        if (!accumulator.draft(index)?.pending() || (!force && time - entry.at < draft_interval_ms)) {
          continue;
        }
        entry.at = time;
        report(index, entry.name);
      }
    },
  };
};

const run_attempt = async (
  body: string,
  known_tools: Set<string>,
  accumulator: Accumulator,
  callbacks: RoundCallbacks,
  signal: AbortSignal,
  transport: Transport,
): Promise<RoundResult> => {
  const watchdog = create_watchdog(signal);
  const parser = create_sse_parser();
  const decoder = new TextDecoder();
  const drafts = create_draft_reporter(accumulator, callbacks, transport.now);
  let finished = false;
  let done = false;
  const consume = (data: string) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch (error) {
      console.warn(`[model] malformed stream chunk (${String(error)}): ${data.slice(0, 200)}`);
      if (finished) {
        done = true;
        return;
      }
      throw new ModelError("stream_interrupted", "OpenRouter sent a malformed stream chunk before the answer was complete.");
    }
    const outcome = accumulator.push(chunk);
    if (outcome.error) {
      throw classify_provider_error(null, outcome.error, "");
    }
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
    finished ||= Boolean(outcome.finish_reason);
  };
  watchdog.arm(transport.first_byte_ms, "first_byte");
  try {
    const response = await send("POST", "/chat/completions", body, watchdog, transport);
    if (!response.body) {
      throw new ModelError("stream_interrupted", "OpenRouter answered without a stream body.");
    }
    const reader = response.body.getReader();
    while (!done) {
      let read: ReadResult;
      try {
        read = await read_chunk(reader, watchdog.signal);
      } catch (error) {
        if (signal.aborted || !finished) {
          throw attempt_failure(error, watchdog, "read");
        }
        console.warn(`[model] stream ended uncleanly after its finish chunk, keeping the answer: ${String(error)}`);
        break;
      }
      if (read.done) {
        break;
      }
      for (const item of parser.feed(decoder.decode(read.value, { stream: true }))) {
        watchdog.arm(transport.idle_ms, "idle");
        if (item.kind === "event") {
          consume(item.data);
        }
        if (done) {
          break;
        }
      }
      drafts.flush(false);
    }
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
  if (!finished) {
    throw new ModelError("stream_interrupted", "OpenRouter closed the stream before the answer was complete.");
  }
  drafts.flush(true);
  const assembly = accumulator.finish(known_tools, make_call_id);
  if (assembly.flushed_reasoning) {
    callbacks.on_reasoning(assembly.flushed_reasoning);
  }
  if (assembly.flushed_text) {
    callbacks.on_text(assembly.flushed_text);
  }
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

export const stream_round = async (
  request: RoundRequest,
  callbacks: RoundCallbacks,
  signal: AbortSignal,
  overrides: Partial<Transport> = {},
): Promise<RoundResult> => {
  const transport = transport_with(overrides);
  const known_tools = new Set(request.tools.map((tool) => tool.name));
  const fallback = request.model.fallback;
  const primary = fallback ? { ...transport, max_attempts: Math.min(transport.max_attempts, fallback_after_attempts) } : transport;
  const total = fallback ? primary.max_attempts + transport.max_attempts : transport.max_attempts;
  const attempt_route = (model: RoundRequest["model"], offset: number, route: Transport) => {
    const body = JSON.stringify(round_body({ ...request, model }));
    let current: Accumulator | null = null;
    return with_retries({
      transport: route,
      signal,
      run: () => {
        current = create_accumulator();
        return run_attempt(body, known_tools, current, callbacks, signal, transport);
      },
      cancelled: () => partial_result(current),
      on_retry: (attempt, ...[, reason, wait_ms]) => {
        current = null;
        callbacks.on_retry(attempt + offset, total, reason, wait_ms);
      },
    });
  };
  if (!fallback) {
    return attempt_route(request.model, 0, transport);
  }
  try {
    return await attempt_route(request.model, 0, primary);
  } catch (error) {
    if (signal.aborted || !(error instanceof ModelError) || !is_retryable(error)) {
      throw error;
    }
    console.warn(`[model] ${request.model.id} failed after ${primary.max_attempts} attempts (${error.kind}), switching to ${fallback.id}: ${error.message}`);
    callbacks.on_retry(primary.max_attempts + 1, total, fallback.label, 0);
    return attempt_route({ ...request.model, id: fallback.id, provider_order: fallback.provider_order }, primary.max_attempts, transport);
  }
};
