import { memo, useState } from "react";
import type { NoticeStep } from "../../../../shared/chat.ts";
import { parse_peer_notice } from "../../../../shared/peer-notes.ts";
import { CollapsibleBody } from "../../../components/Collapsible.tsx";
import { ChevronRightIcon, MessageSquareIcon } from "../../../components/icons.tsx";
import { Markdown } from "../../../components/Markdown.tsx";
import { use_t } from "../../../i18n/index.ts";
import { NoticeRow } from "../../chat/StepRows.tsx";
import "../../chat/AgentNoteRow.css";
import "../../tools/tools.css";

export const PeerMessageRow = memo(({ step }: { step: NoticeStep }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const message = parse_peer_notice(step.text);
  if (!message) {
    return <NoticeRow step={step} />;
  }
  if (open && !seen) {
    set_seen(true);
  }
  const meta = [
    t(`agent.peer_type_${message.type}`),
    t("agent.peer_about", { x: message.about }),
    ...(message.in_reply_to ? [t("agent.peer_reply_to", { x: message.in_reply_to })] : []),
    message.message_id,
  ];
  return (
    <div className="agent-note tool-row enter-fade-up" data-open={open}>
      <button type="button" className="tool-row-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">
          <MessageSquareIcon size={14} />
        </span>
        <span className="tool-row-label">{t("agent.peer_from", { x: message.sender_name, summary: message.summary })}</span>
        <ChevronRightIcon size={12} className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div className="agent-note-body tool-body-stack">
          {seen && (
            <>
              <div className="tool-body-muted">{meta.join(" · ")}</div>
              <div>{message.summary}</div>
              <Markdown text={message.text} className="agent-note-markdown" />
            </>
          )}
        </div>
      </CollapsibleBody>
    </div>
  );
});
