import { memo } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../../../shared/approval.ts";
import { QuestionForm } from "../../components/QuestionForm.tsx";
import { use_t } from "../../i18n/index.ts";
import { answer_agent_approval } from "../../state/agents.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { answer_approval } from "../../state/chat-actions.ts";
import { ApprovalDetail, ApprovalHead } from "./ApprovalDetail.tsx";
import { approval_question, grant_options } from "./approval-options.ts";
import { approval_lines } from "./review-notes.ts";
import { ReviewLines } from "./ReviewNote.tsx";
import "./approval.css";

type ApprovalCardProps = { chat_id: string; call_id: string; request: ApprovalRequest; run?: RunRef; actor?: string };

export const ApprovalCard = memo(({ chat_id, call_id, request, run, actor = "" }: ApprovalCardProps) => {
  const t = use_t();
  const options = grant_options(request);
  const question = approval_question(request);
  const lines = approval_lines(t, request);
  const answer = (decision: ApprovalDecision) => (run ? answer_agent_approval(run, call_id, decision) : answer_approval(chat_id, call_id, decision));
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
    />
  );
});
