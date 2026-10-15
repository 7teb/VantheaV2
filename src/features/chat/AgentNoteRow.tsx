import { memo, useState } from "react";
import type { AgentNote } from "../../../shared/agent-notes.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { BotIcon, ChevronRightIcon, MessageSquareIcon, RetryIcon, ShieldAlertIcon, type IconComponent } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import "../tools/tools.css";
import "./AgentNoteRow.css";

const status_keys: Partial<Record<string, MessageKey>> = {
  failed: "agent.status_failed",
  cancelled: "agent.status_cancelled",
  interrupted: "agent.status_interrupted",
};

const alert_keys: Partial<Record<string, MessageKey>> = {
  blocked: "chat.peer_alert_blocked",
  loop: "chat.peer_alert_loop",
};

const labels: Record<AgentNote["kind"], MessageKey> = {
  report: "chat.agent_report_from",
  update: "chat.agent_update_from",
  alert: "chat.peer_alert_from",
};

const icon_of = (note: AgentNote): IconComponent => {
  if (note.kind === "report") {
    return BotIcon;
  }
  if (note.kind === "update") {
    return MessageSquareIcon;
  }
  return note.status === "loop" ? RetryIcon : ShieldAlertIcon;
};

export const AgentNoteRow = memo(({ note }: { note: AgentNote }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const Icon = icon_of(note);
  const status = note.kind === "alert" ? alert_keys[note.status] : status_keys[note.status];
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
        <span className="tool-row-label">{t(labels[note.kind], { x: note.name || note.agent_id })}</span>
        {status && <span className={class_names("tool-row-status", (note.status === "failed" || note.status === "blocked") && "is-failed")}>{t(status)}</span>}
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
