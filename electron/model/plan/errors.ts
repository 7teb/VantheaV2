import { context_limit_message, context_phrase, ModelError } from "../errors.ts";
import { as_record, as_string, type JsonRecord } from "../json.ts";

export type PlanErrorBody = { code: string; message: string; param: string; type: string };

type PlanErrorContext = { retry_after_ms: number; request_id: string; token: string };

type PlanErrorKind = ModelError["kind"];

const legacy_prefix = "subscription_sharing_v2_";

const unsupported_code = "subscription_sharing_unsupported_capability";

const auth_codes = new Set(["subscription_sharing_invalid_user", "invalid_token", "invalid_api_key"]);

const blocked_codes = new Set([
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_route_not_supported",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "subscription_sharing_client_not_enabled",
]);

const unavailable_codes = new Set(["subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable", "server_error"]);

const policy_codes = new Set(["content_policy_violation", "cyber_policy"]);

const as_text = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

const text_body = (message: string): PlanErrorBody => ({ code: "", message, param: "", type: "" });

const fields_body = (record: JsonRecord): PlanErrorBody => ({
  code: as_string(record.code),
  message: as_string(record.message),
  param: as_string(record.param),
  type: as_string(record.type),
});

export const read_plan_error = (text: string): PlanErrorBody | null => {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[plan] the error body is not JSON (${String(error)}), keeping its ${raw.length} characters as the message`);
    return text_body(raw);
  }
  const record = as_record(parsed);
  if (!record) {
    return text_body(raw);
  }
  const nested = as_record(record.error);
  if (nested) {
    return fields_body(nested);
  }
  if (typeof record.error === "string") {
    return { code: record.error, message: as_string(record.error_description), param: "", type: "" };
  }
  if (record.detail !== undefined) {
    return text_body(as_text(record.detail));
  }
  if (record.message !== undefined || record.code !== undefined) {
    return fields_body(record);
  }
  return text_body(raw);
};

const normalized_code = (body: PlanErrorBody | null): string => {
  const code = body?.code || body?.type || "";
  return code.startsWith(legacy_prefix) ? `subscription_sharing_${code.slice(legacy_prefix.length)}` : code;
};

const code_kind = (code: string, body: PlanErrorBody | null): PlanErrorKind | null => {
  if (code.endsWith("usage_limit_exceeded")) {
    return "plan_limit";
  }
  if (code === "context_length_exceeded" || context_phrase.test(body?.message ?? "")) {
    return "context_limit";
  }
  if (code === "model_not_found" || (code === unsupported_code && body?.param === "model")) {
    return "plan_model";
  }
  if (auth_codes.has(code)) {
    return "plan_auth";
  }
  if (blocked_codes.has(code)) {
    return "plan_blocked";
  }
  if (unavailable_codes.has(code)) {
    return "provider_unavailable";
  }
  if (code === "rate_limit_exceeded") {
    return "rate_limited";
  }
  if (policy_codes.has(code)) {
    return "policy";
  }
  return code === unsupported_code ? "bad_request" : null;
};

const status_kind = (status: number | null): PlanErrorKind => {
  if (status === 401) {
    return "plan_auth";
  }
  if (status === 403) {
    return "plan_blocked";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  return status !== null && status >= 500 ? "provider_unavailable" : "bad_request";
};

const error_detail = (body: PlanErrorBody | null): string => {
  const message = body?.message || "no detail returned";
  const facts = [body?.code ?? "", body?.param ? `parameter ${body.param}` : ""].filter(Boolean).join(", ");
  return facts ? `${message} (${facts})` : message;
};

export const plan_error = (status: number | null, body: PlanErrorBody | null, context: PlanErrorContext): ModelError => {
  const kind = code_kind(normalized_code(body), body) ?? status_kind(status);
  const prefix = status === null ? "ChatGPT plan" : `ChatGPT plan ${status}`;
  const request = context.request_id ? ` (request ${context.request_id})` : "";
  const text = `${prefix}: ${error_detail(body)}${request}`;
  const core = (context.token ? text.replaceAll(context.token, "[redacted]") : text).slice(0, 1200);
  const retry_after_ms = kind === "rate_limited" || kind === "provider_unavailable" ? context.retry_after_ms : 0;
  return new ModelError(kind, kind === "context_limit" ? context_limit_message(core) : core, status, retry_after_ms);
};
