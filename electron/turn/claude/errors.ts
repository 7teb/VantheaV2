import type { SDKAssistantMessageError, SDKRateLimitInfo, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { context_phrase, ModelError } from "../../model/errors.ts";

export type ClaudeFacts = { assistant_error: SDKAssistantMessageError | null; assistant_text: string; limit: SDKRateLimitInfo | null };

const missing_session_text = "No conversation found with session ID";

const auth_texts = ["Not logged in", "Please run /login", "Failed to authenticate"];

const auth_errors: ReadonlySet<SDKAssistantMessageError> = new Set(["authentication_failed", "oauth_org_not_allowed", "verification_required"]);

const blocked_errors: ReadonlySet<SDKAssistantMessageError> = new Set(["account_on_hold", "billing_error"]);

const unavailable_errors: ReadonlySet<SDKAssistantMessageError> = new Set(["overloaded", "server_error"]);

const pad = (value: number) => String(value).padStart(2, "0");

const local_time = (seconds: number): string => {
  const at = new Date(seconds * 1000);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

export const result_text = (result: SDKResultMessage): string => (result.subtype === "success" ? result.result : result.errors.join("\n"));

export const is_error_result = (result: SDKResultMessage): boolean => result.subtype !== "success" || result.is_error;

export const names_missing_session = (texts: string[]): boolean => texts.some((text) => text.includes(missing_session_text));

export const process_error = (detail: string): ModelError => new ModelError("claude_process", `Claude Code did not start or exited early: ${detail}`);

export const key_error = (source: string): ModelError =>
  new ModelError("claude_auth", `Claude Code would use an API key (${source}), the Claude plan runs only on the subscription login.`);

export const provider_error = (provider: string): ModelError =>
  new ModelError("claude_auth", `Claude Code would run on the ${provider} API backend, the Claude plan runs only on the subscription login.`);

export const refusal_error = (): ModelError => new ModelError("policy", "Claude declined to continue this answer (stop reason refusal).");

export const blocked_limit = (info: SDKRateLimitInfo): boolean =>
  info.status === "rejected" && info.isUsingOverage !== true && info.overageInUse !== true && info.overageStatus !== "allowed" && info.overageStatus !== "allowed_warning";

export const extra_usage = (info: SDKRateLimitInfo): boolean => info.isUsingOverage === true || info.overageInUse === true;

export const limit_error = (text: string, info: SDKRateLimitInfo | null): ModelError => {
  const details = [info?.rateLimitType ? `limit ${info.rateLimitType}` : "", info?.resetsAt ? `resets at ${local_time(info.resetsAt)}` : ""].filter(Boolean).join(", ");
  const fallback =
    info && extra_usage(info)
      ? "The Claude plan usage limit is reached and Claude Code would go on with the account's extra usage credits, so the turn stopped."
      : "Claude Code reports that the Claude plan usage limit is reached.";
  const base = text || fallback;
  return new ModelError("claude_limit", details ? `${base} (${details})` : base, 429);
};

const usage_limit_text = (texts: string[], prefixes: readonly string[]): boolean => texts.some((text) => prefixes.some((prefix) => text.startsWith(prefix)));

export const result_error = (result: SDKResultMessage, facts: ClaudeFacts, prefixes: readonly string[]): ModelError => {
  if (result.subtype !== "success" && result.startup_failure_reason) {
    return new ModelError("claude_process", `Claude Code did not start (${result.startup_failure_reason}): ${result.errors.join("; ")}`);
  }
  const texts = [result_text(result), facts.assistant_text].filter(Boolean);
  const text = texts[0] ?? `Claude Code ended the turn with ${result.subtype}${result.terminal_reason ? ` (${result.terminal_reason})` : ""}.`;
  if (names_missing_session(texts)) {
    return process_error(text);
  }
  const error = facts.assistant_error;
  const status = result.subtype === "success" ? (result.api_error_status ?? null) : null;
  const limited = usage_limit_text(texts, prefixes);
  if ((error && auth_errors.has(error)) || texts.some((entry) => auth_texts.some((needle) => entry.includes(needle)))) {
    return new ModelError("claude_auth", text, status);
  }
  if (error && blocked_errors.has(error) && !limited) {
    return new ModelError("claude_blocked", text, status);
  }
  if ((facts.limit && blocked_limit(facts.limit)) || limited || result.terminal_reason === "blocking_limit") {
    return limit_error(texts.find((entry) => prefixes.some((prefix) => entry.startsWith(prefix))) ?? text, facts.limit);
  }
  if (error === "rate_limit") {
    return new ModelError("rate_limited", text, status);
  }
  if (error === "model_not_found") {
    return new ModelError("claude_model", text, status);
  }
  if ((error && unavailable_errors.has(error)) || (status !== null && status >= 500)) {
    return new ModelError("provider_unavailable", text, status);
  }
  if (result.terminal_reason === "prompt_too_long" || texts.some((entry) => context_phrase.test(entry))) {
    return new ModelError("context_limit", text, status);
  }
  if (error === "invalid_request") {
    return new ModelError("bad_request", text, status);
  }
  return new ModelError("internal", text, status);
};
