import { memo, useRef } from "react";
import type { ApprovalDecision, PendingApprovalRequest } from "../../../shared/approval.ts";
import { QuestionForm } from "../../components/QuestionForm.tsx";
import { use_t } from "../../i18n/index.ts";
import { answer_agent_approval, hold_agent_approval } from "../../state/agents.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { answer_approval, hold_approval } from "../../state/chat-actions.ts";
import { ApprovalDetail, ApprovalHead } from "./ApprovalDetail.tsx";
import { approval_question, grant_options } from "./approval-options.ts";
import { approval_lines } from "./review-notes.ts";
import { ReviewLines } from "./ReviewNote.tsx";
import "./approval.css";

type ApprovalCardProps = { chat_id: string; request: PendingApprovalRequest; run?: RunRef; actor?: string };

export const ApprovalCard = memo(({ chat_id, request, run, actor = "" }: ApprovalCardProps) => {
  const t = use_t();
  const options = grant_options(request);
  const question = approval_question(request);
  const lines = approval_lines(t, request);
  const held = useRef(false);
  const { request_id } = request;
  const answer = async (decision: ApprovalDecision) => {
    const result = run ? await answer_agent_approval(run, request_id, decision) : await answer_approval(chat_id, request_id, decision);
    return result ?? { ok: false, error: t("approval.no_longer_pending") };
  };
  const hold = (text: string) => {
    if (held.current || request.expires_at === undefined || !text.trim()) {
      return;
    }
    held.current = true;
    void (run ? hold_agent_approval(run, request_id) : hold_approval(chat_id, request_id));
  };
  const has_head = actor !== "" || request.kind === "mcp";
  const has_preview = request.kind !== "mcp" || Boolean(request.args_preview || request.scope);
  return (
    <QuestionForm
      head={has_head ? <ApprovalHead request={request} actor={actor} /> : null}
      title={t(question.key, question.vars)}
      subtitle={lines.length ? <ReviewLines lines={lines} /> : null}
      preview={has_preview ? <ApprovalDetail request={request} /> : null}
      options={options.map((option) => t(option.label, option.vars))}
      on_choose={(index) => answer({ approved: true, grant: options[index].grant, feedback: "" })}
      on_other={(feedback) => answer({ approved: false, grant: "once", feedback })}
      on_edit={hold}
      skip_at={request.expires_at}
    />
  );
});
