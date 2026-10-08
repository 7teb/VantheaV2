import { randomUUID } from "node:crypto";
import { create_accumulator, draft_lines, type Accumulator, type ChunkOutcome } from "./accumulator.ts";
import { api_effort } from "./catalog.ts";
import { classify_provider_error, is_retryable, ModelError } from "./errors.ts";
import { safety_fields } from "./safety.ts";
import { create_sse_parser } from "./sse.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "./transport.ts";
import { to_api_tools, wire_messages, type RoundCallbacks, type RoundRequest, type RoundResult } from "./types.ts";

type Reader = ReadableStreamDefaultReader<Uint8Array>;

type ReadResult = Awaited<ReturnType<Reader["read"]>>;

type Draft = { name: string; lines: number | null };


export const make_call_id = () => `call_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

export const round_body = (request: RoundRequest): Record<string, unknown> => {
  const { model } = request;
  return {
    model: model.id,
    messages: wire_messages(request.messages, model.reasoning_passback),
    stream: true,
    temperature: 0.2,
    ...(request.tools.length ? { tools: to_api_tools(request.tools), tool_choice: "auto" } : {}),
    ...(model.efforts.length ? { reasoning: { effort: api_effort(model, request.effort) } } : {}),
    ...(model.provider_order.length ? { provider: { order: model.provider_order, allow_fallbacks: false } } : {}),
    ...safety_fields(model.id),
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

const report_drafts = (outcome: ChunkOutcome, accumulator: Accumulator, drafts: Map<number, Draft>, callbacks: RoundCallbacks) => {
  for (const index of outcome.drafted) {
    const call = accumulator.tool(index);
    if (!call?.name) {
      continue;
    }
    const lines = draft_lines(call.name, call.arguments);
    const previous = drafts.get(index);
    const grew = lines !== null && typeof previous?.lines === "number" && lines > previous.lines;
    if (previous && previous.name === call.name && !grew) {
      continue;
    }
    drafts.set(index, { name: call.name, lines });
    callbacks.on_tool_draft(index, call.name, lines);
  }
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
  const drafts = new Map<number, Draft>();
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
    if (outcome.reasoning) {
      callbacks.on_reasoning(outcome.reasoning);
    }
    if (outcome.text) {
      callbacks.on_text(outcome.text);
    }
    report_drafts(outcome, accumulator, drafts, callbacks);
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
  const total = fallback ? transport.max_attempts * 2 : transport.max_attempts;
  const attempt_route = (model: RoundRequest["model"], offset: number) => {
    const body = JSON.stringify(round_body({ ...request, model }));
    let current: Accumulator | null = null;
    return with_retries({
      transport,
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
    return attempt_route(request.model, 0);
  }
  try {
    return await attempt_route(request.model, 0);
  } catch (error) {
    if (signal.aborted || !(error instanceof ModelError) || !is_retryable(error)) {
      throw error;
    }
    console.warn(`[model] ${request.model.id} failed after ${transport.max_attempts} attempts (${error.kind}), switching to ${fallback.id}: ${error.message}`);
    callbacks.on_retry(transport.max_attempts + 1, total, fallback.label, 0);
    return attempt_route({ ...request.model, id: fallback.id, provider_order: fallback.provider_order }, transport.max_attempts);
  }
};
