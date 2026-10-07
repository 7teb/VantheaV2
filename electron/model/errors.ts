import type { TurnErrorKind } from "../../shared/chat.ts";
import { as_number, as_record, as_string } from "./json.ts";
import { redact_key } from "./key.ts";

export class ModelError extends Error {
  readonly kind: TurnErrorKind;
  readonly status: number | null;
  readonly retry_after_ms: number;

  constructor(kind: TurnErrorKind, message: string, status: number | null = null, retry_after_ms = 0) {
    super(message);
    this.name = "ModelError";
    this.kind = kind;
    this.status = status;
    this.retry_after_ms = retry_after_ms;
  }
}

export type ProviderError = {
  code: number | null;
  message: string;
  error_type: string;
  provider_code: string;
  limit_source: string;
  moderation: boolean;
  provider_name: string;
  raw: string;
};

const retryable_kinds = new Set<TurnErrorKind>(["rate_limited", "provider_unavailable", "stream_interrupted", "timeout"]);

const policy_types = new Set(["content_policy_violation", "refusal", "permission_denied"]);

const unavailable_types = new Set(["provider_overloaded", "provider_unavailable", "server", "unmapped"]);

const context_phrase = /maximum context length|context[ _]length[ _]exceeded|prompt is too long|exceeds the context window/i;

const backoff_ms = [2000, 6000];

export const max_retry_wait_ms = 60000;

export const is_retryable = (error: ModelError) => retryable_kinds.has(error.kind);

export const retry_delay = (failed_attempt: number, error: ModelError, random: () => number): number => {
  const planned = backoff_ms[Math.min(failed_attempt, backoff_ms.length) - 1] ?? 2000;
  const wanted = error.retry_after_ms > 0 ? error.retry_after_ms : planned;
  return Math.min(max_retry_wait_ms, wanted) + Math.floor(random() * 250);
};

export const parse_retry_after = (value: string | null, now = Date.now()): number => {
  const raw = (value ?? "").trim();
  if (!raw) {
    return 0;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
};

const raw_text = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
};

export const read_provider_error = (value: unknown): ProviderError | null => {
  const error = as_record(value);
  if (!error) {
    return null;
  }
  const metadata = as_record(error.metadata) ?? {};
  const code = as_number(error.code);
  return {
    code,
    message: as_string(error.message),
    error_type: as_string(metadata.error_type),
    provider_code: as_string(metadata.provider_code) || (typeof error.code === "string" ? error.code : ""),
    limit_source: as_string(metadata.limit_source),
    moderation: Array.isArray(metadata.reasons),
    provider_name: as_string(metadata.provider_name),
    raw: raw_text(metadata.raw),
  };
};

const error_detail = (error: ProviderError | null, fallback_text: string): string => {
  const message = error?.message || fallback_text || "no detail returned";
  if (!error) {
    return message;
  }
  const facts = [error.provider_name, error.error_type, error.provider_code].filter(Boolean).join(", ");
  const raw = error.raw && error.raw !== message ? `: ${error.raw}` : "";
  return `${message}${facts ? ` (${facts})` : ""}${raw}`;
};

export const parse_error_body = (text: string): ProviderError | null => {
  if (!text.trim()) {
    return null;
  }
  try {
    return read_provider_error(as_record(JSON.parse(text))?.error);
  } catch (error) {
    console.warn(`[model] error body is not JSON (${String(error)}): ${redact_key(text).slice(0, 200)}`);
    return null;
  }
};

const kind_for = (status: number | null, error: ProviderError | null, retry_after_ms: number): TurnErrorKind => {
  const type = error?.error_type ?? "";
  const provider_code = error?.provider_code ?? "";
  if (type === "context_length_exceeded" || provider_code === "context_length_exceeded" || context_phrase.test(error?.message ?? "")) {
    return "context_limit";
  }
  if (status === 401 || type === "authentication") {
    return "auth";
  }
  if (status === 402 || type === "payment_required") {
    return error?.limit_source === "openrouter_in_flight_budget" && retry_after_ms > 0 ? "rate_limited" : "credits";
  }
  if (status === 403 || policy_types.has(type) || provider_code === "cyber_policy" || error?.moderation) {
    return "policy";
  }
  if (status === 429 || type === "rate_limit_exceeded") {
    return "rate_limited";
  }
  if (status === 408 || status === 504 || type === "timeout") {
    return "timeout";
  }
  if ((status !== null && status >= 500) || unavailable_types.has(type)) {
    return "provider_unavailable";
  }
  if ((status !== null && status >= 400) || type) {
    return "bad_request";
  }
  return status === null ? "stream_interrupted" : "internal";
};

export const classify_provider_error = (
  status: number | null,
  error: ProviderError | null,
  fallback_text: string,
  retry_after_ms = 0,
): ModelError => {
  const effective_status = status ?? error?.code ?? null;
  const kind = kind_for(effective_status, error, retry_after_ms);
  const detail = redact_key(error_detail(error, fallback_text)).slice(0, 1200);
  const prefix = effective_status === null ? "OpenRouter" : `OpenRouter ${effective_status}`;
  const message =
    kind === "context_limit"
      ? `The conversation is larger than the model's context window. Compact the chat or start a new one. (${detail})`
      : `${prefix}: ${detail}`;
  return new ModelError(kind, message, effective_status, kind === "rate_limited" || kind === "provider_unavailable" ? retry_after_ms : 0);
};

const network_code = (error: unknown): string => {
  const cause = as_record(as_record(error)?.cause);
  return as_string(cause?.code) || as_string(as_record(error)?.code);
};

export const network_error = (error: unknown, phase: "connect" | "read"): ModelError => {
  const code = network_code(error);
  const detail = redact_key(`${error instanceof Error ? error.message : String(error)}${code ? ` (${code})` : ""}`).slice(0, 240);
  return phase === "connect"
    ? new ModelError("provider_unavailable", `Lost the connection to OpenRouter before it answered: ${detail}`)
    : new ModelError("stream_interrupted", `The OpenRouter stream broke off before the answer was complete: ${detail}`);
};
