import { memo, useState, type CSSProperties } from "react";
import { parse_agent_notice } from "../../../shared/agent-notes.ts";
import { parse_peer_alerts, parse_peer_notice } from "../../../shared/peer-notes.ts";
import { parse_workflow_notice } from "../../../shared/workflow-notes.ts";
import type { CompactionStep, NoticeKind, NoticeStep, SteerStep } from "../../../shared/chat.ts";
import { InfoIcon, TextSelectIcon } from "../../components/icons.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { AgentNoteRow } from "./AgentNoteRow.tsx";
import { compaction_text, compaction_wait_text, slow_notice_delay } from "./compaction-line.ts";
import { PeerMessageRow } from "./PeerMessageRow.tsx";
import { UserAttachments } from "./UserAttachments.tsx";
import { WorkflowNoteRow } from "./WorkflowNoteRow.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import "./UserMessage.css";

export const SteerRow = memo(({ step }: { step: SteerStep }) => (
  <div className="user-message steer-message enter-fade-up">
    {step.attachments?.length ? <UserAttachments attachments={step.attachments} /> : null}
    {step.text && <div className="user-bubble inset-surface">{step.text}</div>}
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
  agent_roster: "chat.notice_agent_roster",
  peer_message: "chat.notice_peer_message",
  peer_status: "chat.notice_peer_status",
  peer_digest: "chat.notice_peer_digest",
  workflow_result: "chat.notice_workflow_result",
};

const agent_note_of = (step: NoticeStep) => {
  if (step.notice !== "agent_report" && step.notice !== "agent_update") {
    return null;
  }
  return parse_agent_notice(step.text) ?? parse_peer_alerts(step.text)[0] ?? null;
};

export const NoticeRow = memo(({ step }: { step: NoticeStep }) => {
  const t = use_t();
  const note = agent_note_of(step);
  if (note) {
    return <AgentNoteRow note={note} />;
  }
  const peer = step.notice === "peer_message" ? parse_peer_notice(step.text) : null;
  if (peer) {
    return <PeerMessageRow message={peer} />;
  }
  const workflow = step.notice === "workflow_result" ? parse_workflow_notice(step.text) : null;
  if (workflow) {
    return <WorkflowNoteRow note={workflow} />;
  }
  return (
    <div className="notice-row enter-fade-up" data-notice={step.notice}>
      <InfoIcon size={14} />
      <div className="notice-row-text">
        <span>{t(notice_titles[step.notice])}</span>
        {step.text && <span className="notice-row-detail">{step.text}</span>}
      </div>
    </div>
  );
});

const SlowNotice = ({ step }: { step: CompactionStep }) => {
  const t = use_t();
  const [delay] = useState(() => slow_notice_delay(step, Date.now()));
  return <span className="delayed-reveal" style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}> · {t("context.compacting_slow")}</span>;
};

const WaitDetail = ({ step }: { step: CompactionStep }) => {
  const t = use_t();
  const now = use_clock(true);
  return <span className="compaction-detail">{compaction_wait_text(t, step, now)}</span>;
};

export const CompactionRow = memo(({ step }: { step: CompactionStep }) => {
  const t = use_t();
  const text = compaction_text(t, step);
  const live = step.status === "running" || step.status === "waiting";
  return (
    <div className="compaction-row enter-fade-up" data-status={step.status} title={step.error?.message}>
      <TextSelectIcon size={16} />
      {live ? (
        <span className="compaction-text is-working">
          <WorkingLetters text={text} />
          {step.status === "running" && <SlowNotice step={step} />}
        </span>
      ) : (
        <span className="compaction-text">{text}</span>
      )}
      {step.status === "waiting" && <WaitDetail step={step} />}
    </div>
  );
});
