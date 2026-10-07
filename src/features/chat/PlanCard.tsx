import { memo, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { CheckIcon, ClipboardListIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { accept_plan } from "../../state/chat-actions.ts";

type PlanCardProps = { chat_id: string; message_id: string; text: string; can_accept: boolean; accepted: boolean };

export const PlanCard = memo(({ chat_id, message_id, text, can_accept, accepted }: PlanCardProps) => {
  const t = use_t();
  const [pending, set_pending] = useState(false);
  const [error, set_error] = useState("");

  const accept = async () => {
    set_pending(true);
    const result = await accept_plan(chat_id, message_id);
    set_error(result.ok ? "" : result.error);
    set_pending(false);
  };

  return (
    <div className="plan-card enter-fade-up">
      <div className="plan-card-head">
        <ClipboardListIcon size={15} />
        <span className="section-label">{t("plan.title")}</span>
      </div>
      <Markdown text={text} className="plan-card-body" />
      {accepted && (
        <div className="plan-card-accepted">
          <CheckIcon size={14} />
          <span>{t("plan.accepted")}</span>
        </div>
      )}
      {!accepted && can_accept && (
        <div className="plan-card-actions">
          <span className="plan-card-question">{t("plan.question")}</span>
          <Button variant="secondary" disabled={pending} onClick={() => void accept()}>
            {t("plan.yes")}
          </Button>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </div>
  );
});
