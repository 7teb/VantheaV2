import { useState } from "react";
import type { AssistantMessage, RetryState, TurnError, TurnErrorKind } from "../../../shared/chat.ts";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { CircleAlertIcon, CloudAlertIcon } from "../../components/icons.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { continue_turn } from "../../state/chat-actions.ts";

export const RetryBanner = ({ retry }: { retry: RetryState }) => {
  const t = use_t();
  const now = use_clock(true);
  const seconds = Math.ceil((retry.until - now) / 1000);
  return (
    <div className="retry-banner enter-fade-up">
      <CloudAlertIcon size={14} />
      <span className="is-working">{t("status.retrying", { n: retry.attempt, total: retry.max })}</span>
      {seconds > 0 && <span className="retry-banner-wait">{t("chat.retry_in", { n: seconds })}</span>}
      {retry.reason && <span className="retry-banner-reason">{retry.reason}</span>}
    </div>
  );
};

const error_keys: Record<TurnErrorKind, MessageKey> = {
  rate_limited: "chat.error_rate_limited",
  provider_unavailable: "chat.error_provider_unavailable",
  stream_interrupted: "chat.error_stream_interrupted",
  timeout: "chat.error_timeout",
  context_limit: "chat.error_context_limit",
  policy: "chat.error_policy",
  auth: "chat.error_auth",
  credits: "chat.error_credits",
  bad_request: "chat.error_bad_request",
  app_closed: "chat.error_app_closed",
  internal: "chat.error_internal",
};

export const ErrorCard = ({ error }: { error: TurnError }) => {
  const t = use_t();
  return (
    <div className="error-card enter-fade-up">
      <div className="error-card-head">
        <CircleAlertIcon size={15} />
        <span>{t(error_keys[error.kind])}</span>
      </div>
      {error.message && (
        <Collapsible header={t("chat.error_details")} className="error-card-details">
          <pre className="error-card-raw">{error.message}</pre>
        </Collapsible>
      )}
    </div>
  );
};

type InterruptedRowProps = { chat_id: string; error: TurnError | null; can_continue: boolean };

const InterruptedRow = ({ chat_id, error, can_continue }: InterruptedRowProps) => {
  const t = use_t();
  const [pending, set_pending] = useState(false);
  const [failure, set_failure] = useState("");
  const resume = async () => {
    set_pending(true);
    const result = await continue_turn(chat_id);
    set_failure(result.ok ? "" : result.error);
    set_pending(false);
  };
  return (
    <div className="interrupted-row enter-fade-up" title={error?.message || undefined}>
      <CloudAlertIcon size={14} />
      <span className="interrupted-text">{t(error?.kind === "app_closed" ? "chat.interrupted_restart" : "chat.interrupted_note_once")}</span>
      {can_continue && (
        <Button variant="secondary" disabled={pending} onClick={() => void resume()}>
          {t("chat.interrupted_continue")}
        </Button>
      )}
      {failure && <span className="inline-error">{failure}</span>}
    </div>
  );
};

type TurnOutcomeProps = { chat_id: string; message: AssistantMessage; has_content: boolean; can_continue: boolean };

export const TurnOutcome = ({ chat_id, message, has_content, can_continue }: TurnOutcomeProps) => {
  const t = use_t();
  switch (message.status) {
    case "streaming":
      return null;
    case "interrupted":
      return <InterruptedRow chat_id={chat_id} error={message.error} can_continue={can_continue} />;
    case "failed":
      return <ErrorCard error={message.error ?? { kind: "internal", message: "" }} />;
    case "blocked":
      return message.error ? <ErrorCard error={message.error} /> : <div className="assistant-note">{t("chat.blocked")}</div>;
    case "stopped":
      return <div className="assistant-note">{t("status.stopped")}</div>;
    case "done":
      return has_content ? null : <div className="assistant-note">{t("chat.empty_answer")}</div>;
  }
};
