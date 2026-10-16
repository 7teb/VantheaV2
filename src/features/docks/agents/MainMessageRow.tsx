import { memo, useState } from "react";
import type { SteerStep } from "../../../../shared/chat.ts";
import { CollapsibleBody } from "../../../components/Collapsible.tsx";
import { ChevronRightIcon, MainAgentIcon } from "../../../components/icons.tsx";
import { Markdown } from "../../../components/Markdown.tsx";
import { use_t } from "../../../i18n/index.ts";
import "../../chat/AgentNoteRow.css";
import "../../tools/tools.css";

export const MainMessageRow = memo(({ chat_id, step }: { chat_id: string; step: SteerStep }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  if (open && !seen) {
    set_seen(true);
  }
  return (
    <div className="agent-note tool-row enter-fade-up" data-open={open}>
      <button type="button" className="tool-row-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">
          <MainAgentIcon chat_id={chat_id} />
        </span>
        <span className="tool-row-label">{t("agent.main_message")}</span>
        <ChevronRightIcon size={12} className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div className="agent-note-body">{seen && <Markdown text={step.text} className="agent-note-markdown" />}</div>
      </CollapsibleBody>
    </div>
  );
});
