import type { ChatSummary, CompactionErrorKind, CompactionStep, Message } from "../../../shared/chat.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";

export const slow_notice_ms = 10_000;

const reason_keys: Record<CompactionErrorKind, MessageKey> = {
  rate_limited: "context.reason_rate_limited",
  provider_unavailable: "context.reason_provider_unavailable",
  stream_interrupted: "context.reason_stream_interrupted",
  timeout: "context.reason_timeout",
  context_limit: "context.reason_context_limit",
  policy: "context.reason_policy",
  auth: "context.reason_auth",
  credits: "context.reason_credits",
  bad_request: "context.reason_bad_request",
  app_closed: "context.reason_app_closed",
  internal: "context.reason_internal",
  empty_note: "context.reason_empty_note",
};

export const compaction_key = (step: CompactionStep): MessageKey => {
  switch (step.status) {
    case "running":
    case "waiting":
      return (step.attempt ?? 1) > 1 ? "context.compacting_attempt" : "context.compacting";
    case "done":
      return step.source === "manual" ? "context.compacted_manual" : "context.compacted_auto";
    case "failed":
      return step.error ? "context.compaction_failed_reason" : "context.compaction_failed";
    case "interrupted":
      return "context.compaction_interrupted";
  }
};

const reason_text = (t: Translate, step: CompactionStep): string => (step.error ? t(reason_keys[step.error.kind]) : "");

export const compaction_text = (t: Translate, step: CompactionStep): string =>
  t(compaction_key(step), {
    n: step.attempt ?? 1,
    total: step.attempts ?? 1,
    reason: reason_text(t, step),
  });

export const compaction_wait_text = (t: Translate, step: CompactionStep, now: number): string => {
  const reason = reason_text(t, step);
  const seconds = step.retry_at === undefined ? 0 : Math.ceil((step.retry_at - now) / 1000);
  if (seconds <= 0) {
    return reason;
  }
  const wait = t("chat.retry_in", { n: seconds });
  return reason ? `${reason} · ${wait}` : wait;
};

export const slow_notice_delay = (step: CompactionStep, now: number): number => Math.max(0, slow_notice_ms - (now - (step.started_at ?? now)));

export const summary_line_step: CompactionStep = { id: "chat-summary", round: 0, kind: "compaction", status: "done", source: "manual" };

export const stepless_summary_after = (messages: Message[], summary: ChatSummary | null): string | null => {
  if (!summary) {
    return null;
  }
  const at = messages.findIndex((message) => message.id === summary.through_message_id);
  if (at < 0) {
    return null;
  }
  const stepped = messages
    .slice(at)
    .some((message) => message.role === "assistant" && message.steps.some((step) => step.kind === "compaction" && step.status === "done"));
  return stepped ? null : summary.through_message_id;
};
