import { memo } from "react";
import type { PeerMessage } from "../../../shared/peer-notes.ts";
import { MessageSquareIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./AgentNoteRow.css";
import "../tools/tools.css";

export const PeerMessageRow = memo(({ message }: { message: PeerMessage }) => {
  const t = use_t();
  return (
    <div className="agent-note tool-row enter-fade-up">
      <button type="button" className="tool-row-head" disabled>
        <span className="tool-row-icon">
          <MessageSquareIcon size={16} />
        </span>
        <span className="tool-row-label">{t("agent.peer_from", { x: message.sender_name, summary: message.summary })}</span>
      </button>
    </div>
  );
});
