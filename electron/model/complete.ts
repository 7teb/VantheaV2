import { read_usage } from "./accumulator.ts";
import { classify_provider_error, ModelError, read_provider_error } from "./errors.ts";
import { completion_body, type CompleteRequest } from "./completion-body.ts";
import { as_number, as_record, as_string } from "./json.ts";
import { attempt_failure, create_watchdog, send, transport_with, with_retries, type Transport } from "./transport.ts";
import type { RoundResult } from "./types.ts";

export type CompletionMeta = { id: string | null; finish_reason: string | null; cached_tokens: number; cache_write_tokens: number; cost: number | null };

export type CompleteResult = { text: string; usage: RoundResult["usage"]; meta: CompletionMeta };

const message_text = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((part) => (as_record(part)?.type === "text" ? as_string(as_record(part)?.text) : "")).join("");
};

const read_meta = (body: Record<string, unknown> | null, choice: Record<string, unknown>): CompletionMeta => {
  const usage = as_record(body?.usage);
  const prompt = as_record(usage?.prompt_tokens_details);
  return {
    id: as_string(body?.id) || null,
    finish_reason: as_string(choice.finish_reason) || null,
    cached_tokens: as_number(prompt?.cached_tokens) ?? 0,
    cache_write_tokens: as_number(prompt?.cache_write_tokens) ?? 0,
    cost: as_number(usage?.cost),
  };
};

export const read_completion = (text: string): CompleteResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.warn(`[model] completion body is not JSON (${String(error)}): ${text.slice(0, 200)}`);
    throw new ModelError("provider_unavailable", "OpenRouter returned an unreadable completion.");
  }
  const body = as_record(parsed);
  const top_error = read_provider_error(body?.error);
  if (top_error) {
    throw classify_provider_error(null, top_error, "");
  }
  const choice = as_record(Array.isArray(body?.choices) ? body.choices[0] : null);
  if (!choice) {
    throw new ModelError("provider_unavailable", "OpenRouter returned a completion without choices.");
  }
  const choice_error = read_provider_error(choice.error);
  if (choice_error) {
    throw classify_provider_error(null, choice_error, "");
  }
  return { text: message_text(as_record(choice.message)?.content).trim(), usage: read_usage(body?.usage), meta: read_meta(body, choice) };
};

const run_attempt = async (body: string, signal: AbortSignal, transport: Transport): Promise<CompleteResult> => {
  const watchdog = create_watchdog(signal);
  watchdog.arm(transport.first_byte_ms, "complete");
  try {
    const response = await send("POST", "/chat/completions", body, watchdog, transport);
    return read_completion(await response.text());
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw attempt_failure(error, watchdog, "read");
  } finally {
    watchdog.dispose();
  }
};

export const complete = async (request: CompleteRequest, signal?: AbortSignal, overrides: Partial<Transport> = {}): Promise<CompleteResult> => {
  const transport = transport_with(overrides);
  const active = signal ?? new AbortController().signal;
  const body = JSON.stringify(completion_body(request));
  return with_retries({
    transport,
    signal: active,
    run: () => run_attempt(body, active, transport),
    cancelled: () => {
      throw active.reason ?? new Error(`completion with ${request.model_id} was cancelled`);
    },
  });
};
