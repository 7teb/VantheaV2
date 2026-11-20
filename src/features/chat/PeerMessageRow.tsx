import { memo } from "react";
import { AgentMessageIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./AgentNoteRow.css";
import "../tools/tools.css";

export const PeerMessageRow = memo(() => {
  const t = use_t();
  return (
    <div className="agent-note tool-row enter-fade-up">
      <button type="button" className="tool-row-head" disabled>
        <span className="tool-row-icon">
          <AgentMessageIcon plain />
        </span>
        <span className="tool-row-label">{t("agent.peer_from")}</span>
      </button>
    </div>
  );
});
