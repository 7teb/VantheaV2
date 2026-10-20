import { memo } from "react";
import type { NoticeStep } from "../../../../shared/chat.ts";
import { parse_peer_notice } from "../../../../shared/peer-notes.ts";
import { MessageSquareIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { NoticeRow } from "../../chat/StepRows.tsx";
import "../../chat/AgentNoteRow.css";
import "../../tools/tools.css";

export const PeerMessageRow = memo(({ step }: { step: NoticeStep }) => {
  const t = use_t();
  const message = parse_peer_notice(step.text);
  if (!message) {
    return <NoticeRow step={step} />;
  }
  return (
    <div className="agent-note tool-row enter-fade-up">
      <button type="button" className="tool-row-head" disabled>
        <span className="tool-row-icon">
          <MessageSquareIcon size={14} />
        </span>
        <span className="tool-row-label">{t("agent.peer_from", { x: message.sender_name, summary: message.summary })}</span>
      </button>
    </div>
  );
});
