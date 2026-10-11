import { memo, useState } from "react";
import { CheckIcon, ClipboardListIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { QuestionForm } from "../../components/QuestionForm.tsx";
import { use_t } from "../../i18n/index.ts";
import { accept_plan, type ActionResult } from "../../state/chat-actions.ts";
import { send_plan_feedback } from "../../state/composer.ts";

type PlanCardProps = { chat_id: string; message_id: string; text: string; can_accept: boolean; accepted: boolean };

export const PlanCard = memo(({ chat_id, message_id, text, can_accept, accepted }: PlanCardProps) => {
  const t = use_t();
  const [dismissed, set_dismissed] = useState(false);

  const answer_other = async (feedback: string): Promise<ActionResult> => {
    set_dismissed(true);
    if (feedback) {
      await send_plan_feedback(chat_id, feedback);
    }
    return { ok: true };
  };

  return (
    <>
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
      </div>
      {!accepted && can_accept && !dismissed && (
        <QuestionForm title={t("plan.question")} options={[t("plan.yes")]} on_choose={() => accept_plan(chat_id, message_id)} on_other={answer_other} />
      )}
    </>
  );
});
