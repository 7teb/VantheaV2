import { useState } from "react";
import { parse_report_events } from "../../../shared/agent-notes.ts";
import type { UserMessage, UserOrigin } from "../../../shared/chat.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { BotIcon, ChevronRightIcon, ClipboardListIcon, LayersIcon, RetryIcon, type IconComponent } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { AgentNoteRow } from "./AgentNoteRow.tsx";

const notes: Record<Exclude<UserOrigin, "user">, { icon: IconComponent; label: MessageKey }> = {
  plan_accept: { icon: ClipboardListIcon, label: "chat.origin_plan_accept" },
  continue: { icon: RetryIcon, label: "chat.origin_continue" },
  background: { icon: LayersIcon, label: "chat.origin_background" },
  agent_report: { icon: BotIcon, label: "chat.origin_agent_report" },
};

export const OriginNote = ({ message }: { message: UserMessage }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  if (message.origin === "user") {
    return null;
  }
  const reports = message.origin === "agent_report" ? parse_report_events(message.text) : [];
  if (reports.length) {
    return (
      <>
        {reports.map((report, index) => (
          <AgentNoteRow key={`${report.agent_id}:${index}`} note={report} />
        ))}
      </>
    );
  }
  const note = notes[message.origin];
  const Icon = note.icon;
  const expandable = message.origin === "background" || message.origin === "agent_report";
  return (
    <div className="origin-note enter-fade-up" data-open={open}>
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
