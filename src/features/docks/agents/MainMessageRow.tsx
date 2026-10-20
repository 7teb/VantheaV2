import { memo } from "react";
import { MainAgentIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import "../../chat/AgentNoteRow.css";
import "../../tools/tools.css";

export const MainMessageRow = memo(({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  return (
    <div className="agent-note tool-row enter-fade-up">
      <button type="button" className="tool-row-head" disabled>
        <span className="tool-row-icon">
          <MainAgentIcon chat_id={chat_id} />
        </span>
        <span className="tool-row-label">{t("agent.main_message")}</span>
      </button>
    </div>
  );
});
