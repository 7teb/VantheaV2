import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../../../shared/approval.ts";
import { Button } from "../../components/Button.tsx";
import { ShieldCheckIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { answer_agent_approval } from "../../state/agents.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { answer_approval } from "../../state/chat-actions.ts";
import { ApprovalDetail } from "./ApprovalDetail.tsx";
import { approval_key_action, approval_question, grant_options, type ApprovalKeySource } from "./approval-options.ts";
import "./approval.css";

type ApprovalCardProps = { chat_id: string; call_id: string; request: ApprovalRequest; run?: RunRef };

export const ApprovalCard = memo(({ chat_id, call_id, request, run }: ApprovalCardProps) => {
  const t = use_t();
  const options = grant_options(request);
  const deny_index = options.length;
  const [choice, set_choice] = useState(0);
  const [feedback, set_feedback] = useState("");
  const [sending, set_sending] = useState(false);
  const [error, set_error] = useState("");
  const option_refs = useRef<(HTMLButtonElement | null)[]>([]);
  const question = approval_question(request);

  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) {
      option_refs.current[0]?.focus({ preventScroll: true });
    }
  }, []);

  const select = (index: number) => {
    set_choice(index);
    option_refs.current[index]?.focus();
  };

  const submit = async () => {
    if (sending) {
      return;
    }
    set_sending(true);
    set_error("");
    const decision: ApprovalDecision =
      choice === deny_index ? { approved: false, grant: "once", feedback: feedback.trim() } : { approved: true, grant: options[choice].grant, feedback: "" };
    const result = run ? await answer_agent_approval(run, call_id, decision) : await answer_approval(chat_id, call_id, decision);
    if (!result.ok) {
      set_error(result.error);
      set_sending(false);
    }
  };

  const key_source = (target: EventTarget): ApprovalKeySource => {
    if (target instanceof HTMLTextAreaElement) {
      return "feedback";
    }
    return option_refs.current.some((node) => node === target) ? "option" : "other";
  };

  const on_key_down = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = approval_key_action({
      key: event.key,
      shift: event.shiftKey,
      composing: event.nativeEvent.isComposing,
      source: key_source(event.target),
    });
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action === "submit") {
      void submit();
      return;
    }
    if (action === "deny") {
      select(deny_index);
      return;
    }
    const step = action === "next" ? 1 : -1;
    select((choice + step + deny_index + 1) % (deny_index + 1));
  };

  const labels = [...options.map((option) => t(option.label, option.vars)), t("approval.no")];

  return (
    <div className="approval-card enter-fade-up" onKeyDown={on_key_down}>
      <div className="approval-question">
        <ShieldCheckIcon size={15} />
        <span>{t(question.key, question.vars)}</span>
      </div>
      <ApprovalDetail request={request} />
      <div className="approval-options" role="radiogroup" aria-label={t(question.key, question.vars)}>
        {labels.map((label, index) => (
          <button
            key={index}
            ref={(node) => {
              option_refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={choice === index}
            tabIndex={choice === index ? 0 : -1}
            className="approval-option"
            data-deny={index === deny_index}
            onClick={() => select(index)}
          >
            <span className="approval-radio" />
            <span className="approval-option-label">{label}</span>
          </button>
        ))}
      </div>
      {choice === deny_index && (
        <textarea
          className="approval-feedback inset-surface"
          rows={2}
          value={feedback}
          placeholder={t("approval.feedback_placeholder")}
          onChange={(event) => set_feedback(event.target.value)}
        />
      )}
      <div className="approval-actions">
        {error && <span className="approval-error">{error}</span>}
        <Button variant="secondary" disabled={sending} onClick={() => void submit()}>
          {t("approval.submit")}
        </Button>
      </div>
    </div>
  );
});
