import { memo, useState } from "react";
import { parse_agent_notice } from "../../../shared/agent-notes.ts";
import type { CompactionStep, NoticeKind, NoticeStep, SteerStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CornerDownRightIcon, FoldVerticalIcon, InfoIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { AgentNoteRow } from "./AgentNoteRow.tsx";
import { UserAttachments } from "./UserAttachments.tsx";

export const SteerRow = memo(({ step }: { step: SteerStep }) => (
  <div className="steer-row enter-fade-up">
    <CornerDownRightIcon size={14} />
    <div className="steer-row-body">
      {step.text && <span>{step.text}</span>}
      {step.attachments?.length ? <UserAttachments attachments={step.attachments} /> : null}
    </div>
  </div>
));

const notice_titles: Record<NoticeKind, MessageKey> = {
  agent_report: "chat.notice_agent_report",
  agent_update: "chat.notice_agent_update",
  update_reminder: "chat.notice_update_reminder",
  plan_blocked: "chat.notice_plan_blocked",
  output_limit: "chat.notice_output_limit",
  todos_carried: "chat.notice_todos_carried",
  context_trimmed: "chat.notice_context_trimmed",
};

const agent_note_of = (step: NoticeStep) => (step.notice === "agent_report" || step.notice === "agent_update" ? parse_agent_notice(step.text) : null);

export const NoticeRow = memo(({ step }: { step: NoticeStep }) => {
  const t = use_t();
  const note = agent_note_of(step);
  if (note) {
    return <AgentNoteRow note={note} />;
  }
  return (
    <div className="notice-row enter-fade-up" data-notice={step.notice}>
      <InfoIcon size={14} />
      <div className="notice-row-text">
        <span className="notice-row-title">{t(notice_titles[step.notice])}</span>
        {step.text && <span className="notice-row-detail">{step.text}</span>}
      </div>
    </div>
  );
});

const compaction_labels: Record<CompactionStep["status"], MessageKey> = {
  running: "context.compressing",
  done: "context.compacted_here",
  failed: "context.compaction_failed",
};

export const CompactionRow = memo(({ step }: { step: CompactionStep }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const expandable = step.status === "done" && step.summary.trim().length > 0;
  return (
    <div className="compaction-row" data-open={expandable && open}>
      <button type="button" className="reasoning-head" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => set_open(!open)}>
        <FoldVerticalIcon size={14} />
        <span className={class_names(step.status === "running" && "is-working")}>{t(compaction_labels[step.status])}</span>
        {expandable && <ChevronRightIcon size={12} className="reasoning-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="reasoning-body">
            <Markdown text={step.summary} className="reasoning-markdown" />
          </div>
        </CollapsibleBody>
      )}
    </div>
  );
});
