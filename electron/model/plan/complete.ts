import type { CompleteResult } from "../complete.ts";
import type { CompleteRequest } from "../completion-body.ts";
import { ModelError } from "../errors.ts";
import { make_call_id } from "../stream.ts";
import { create_watchdog, transport_with, with_retries, type Transport } from "../transport.ts";
import { complete_plan_body } from "./body.ts";
import { create_plan_accumulator } from "./events.ts";
import { send_plan } from "./send.ts";
import { note_rejected_model, read_plan_stream } from "./stream.ts";

const quiet_hooks = { idle_ms: null, on_push: () => undefined, after_chunk: () => undefined };

const run_attempt = async (body: string, signal: AbortSignal, transport: Transport): Promise<CompleteResult> => {
  const watchdog = create_watchdog(signal);
  const accumulator = create_plan_accumulator();
  watchdog.arm(transport.first_byte_ms, "complete");
  try {
    const reply = await send_plan(body, watchdog, transport);
    if (!(await read_plan_stream(reply, accumulator, watchdog, quiet_hooks))) {
      throw new ModelError("stream_interrupted", "The ChatGPT plan closed the stream before the completion was complete.");
    }
    const assembly = accumulator.finish(make_call_id);
    return {
      text: assembly.content.trim(),
      usage: assembly.usage,
      meta: {
        id: assembly.response_id,
        finish_reason: assembly.finish_reason,
        cached_tokens: assembly.cached_tokens,
        cache_write_tokens: assembly.cache_write_tokens,
        cost: null,
      },
    };
  } finally {
    watchdog.dispose();
  }
};

export const complete_plan = async (request: CompleteRequest, signal?: AbortSignal, overrides: Partial<Transport> = {}): Promise<CompleteResult> => {
  const transport = transport_with(overrides);
  const active = signal ?? new AbortController().signal;
  try {
    const body = JSON.stringify(complete_plan_body(request));
    return await with_retries({
      transport,
      signal: active,
      run: () => run_attempt(body, active, transport),
      cancelled: () => {
        throw active.reason ?? new Error(`completion with ${request.model_id} was cancelled`);
      },
    });
  } catch (error) {
    note_rejected_model(error, request.model_id);
    throw error;
  }
};
