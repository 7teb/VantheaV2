import { useState } from "react";
import { parse_report_events, parse_update_batch, type AgentNote } from "../../../shared/agent-notes.ts";
import type { CommandOrigin, UserMessage, UserOrigin } from "../../../shared/chat.ts";
import { parse_workflow_notice, split_workflow_notices } from "../../../shared/workflow-notes.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, ClipboardListIcon, CritterMark, LayersIcon, MessageSquareIcon, RetryIcon, UndoIcon, WorkflowIcon, type IconComponent } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { AgentNoteRow } from "./AgentNoteRow.tsx";
import { WorkflowNoteRow } from "./WorkflowNoteRow.tsx";

const notes: Record<Exclude<UserOrigin, "user" | CommandOrigin>, { icon: IconComponent; label: MessageKey }> = {
  plan_accept: { icon: ClipboardListIcon, label: "chat.origin_plan_accept" },
  undo: { icon: UndoIcon, label: "chat.origin_undo" },
  continue: { icon: RetryIcon, label: "chat.origin_continue" },
  background: { icon: LayersIcon, label: "chat.origin_background" },
  agent_report: { icon: CritterMark, label: "chat.origin_agent_report" },
  agent_update: { icon: MessageSquareIcon, label: "chat.origin_agent_update" },
  workflow: { icon: WorkflowIcon, label: "chat.origin_workflow" },
};

const agent_notes_of = (message: UserMessage): AgentNote[] => {
  if (message.origin === "agent_report") {
    return parse_report_events(message.text);
  }
  if (message.origin === "agent_update") {
    return parse_update_batch(message.text);
  }
  return [];
};

export const OriginNote = ({ message }: { message: UserMessage }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  if (message.origin === "user" || message.origin === "init" || message.origin === "git_init" || message.origin === "review") {
    return null;
  }
  const workflow_notes = message.origin === "workflow" ? split_workflow_notices(message.text).flatMap((text) => parse_workflow_notice(text) ?? []) : [];
  if (workflow_notes.length) {
    return (
      <>
        {workflow_notes.map((workflow_note) => (
          <WorkflowNoteRow key={workflow_note.run_id} note={workflow_note} />
        ))}
      </>
    );
  }
  const agent_notes = agent_notes_of(message);
  if (agent_notes.length) {
    return (
      <>
        {agent_notes.map((agent_note, index) => (
          <AgentNoteRow key={`${agent_note.agent_id}:${index}`} note={agent_note} />
        ))}
      </>
    );
  }
  const note = notes[message.origin];
  const Icon = note.icon;
  const expandable = message.origin === "background" || message.origin === "agent_report" || message.origin === "agent_update";
  return (
    <div className="origin-note enter-fade-up" data-origin={message.origin} data-open={open}>
      <button type="button" className="origin-note-head" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => set_open(!open)}>
        <Icon size={14} />
        <span>{t(note.label)}</span>
        {expandable && <ChevronRightIcon size={12} className="origin-note-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="origin-note-text">{message.text}</div>
        </CollapsibleBody>
      )}
    </div>
  );
};
