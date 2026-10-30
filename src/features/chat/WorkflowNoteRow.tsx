import { memo } from "react";
import type { WorkflowNote } from "../../../shared/workflow-notes.ts";
import { class_names } from "../../components/class-names.ts";
import { WorkflowIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import "../tools/tools.css";
import "./AgentNoteRow.css";

const status_keys: Partial<Record<string, MessageKey>> = {
  failed: "agent.status_failed",
  stopped: "workflow.status_stopped",
  interrupted: "agent.status_interrupted",
};

export const WorkflowNoteRow = memo(({ note }: { note: WorkflowNote }) => {
  const t = use_t();
  const status = status_keys[note.status];
  const failed = note.status === "failed" || note.status === "interrupted";
  return (
    <div className="agent-note tool-row enter-fade-up" data-status={failed ? "failed" : note.status}>
      <button type="button" className="tool-row-head" disabled>
        <span className="tool-row-icon">
          <WorkflowIcon size={14} />
        </span>
        <span className="tool-row-label">{t("workflow.note_result", { x: note.name })}</span>
        {status && <span className={class_names("tool-row-status", failed && "is-failed")}>{t(status)}</span>}
      </button>
    </div>
  );
});
