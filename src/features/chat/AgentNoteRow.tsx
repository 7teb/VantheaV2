import { memo, useState } from "react";
import type { AgentNote } from "../../../shared/agent-notes.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { BotIcon, ChevronRightIcon, MessageSquareIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { format_duration } from "../tools/tool-summary.ts";
import "../tools/tools.css";
import "./AgentNoteRow.css";

const status_keys: Partial<Record<string, MessageKey>> = {
  failed: "agent.status_failed",
  cancelled: "agent.status_cancelled",
  interrupted: "agent.status_interrupted",
};

export const AgentNoteRow = memo(({ note }: { note: AgentNote }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const report = note.kind === "report";
  const Icon = report ? BotIcon : MessageSquareIcon;
  const status = status_keys[note.status];
  const expandable = note.body.trim().length > 0;
  if (open && !seen) {
    set_seen(true);
  }
  return (
    <div className="agent-note tool-row enter-fade-up" data-status={note.status} data-open={expandable && open}>
      <button type="button" className="tool-row-head" aria-expanded={expandable ? open : undefined} disabled={!expandable} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">
          <Icon size={14} />
        </span>
        <span className="tool-row-label">{t(report ? "chat.agent_report_from" : "chat.agent_update_from", { x: note.name || note.agent_id })}</span>
        {status && <span className={class_names("tool-row-status", note.status === "failed" && "is-failed")}>{t(status)}</span>}
        {report && note.seconds !== null && <span className="tool-row-duration">{format_duration(note.seconds * 1000)}</span>}
        {expandable && <ChevronRightIcon size={12} className="tool-row-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="agent-note-body">{seen && <Markdown text={note.body} className="agent-note-markdown" />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
});
