import { memo } from "react";
import { class_names } from "../../components/class-names.ts";
import { WorkflowToolIcon } from "../../components/icons.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_t } from "../../i18n/index.ts";
import { use_store } from "../../state/use-store.ts";
import { list_status, run_status } from "../../state/workflows-reduce.ts";
import { open_workflow, workflows_store } from "../../state/workflows.ts";
import { row_tone, workflow_label, type WorkflowToolView } from "./workflow-model.ts";
import "./tools.css";

type WorkflowRowProps = { chat_id: string; view: WorkflowToolView };

export const WorkflowRow = memo(({ chat_id, view }: WorkflowRowProps) => {
  const t = use_t();
  const summary = use_store(workflows_store, (state) => state.runs[view.run_id] ?? null);
  const status = use_store(workflows_store, (state) => run_status(state, view.run_id));
  const gone = use_store(workflows_store, (state) => list_status(state, chat_id) === "ready" && !state.runs[view.run_id]);
  const running = status === "running";
  const label = workflow_label(t, summary?.name || view.name, status);
  return (
    <div className="tool-row workflow-row" data-status={row_tone(status)}>
      <button
        type="button"
        className="tool-row-head"
        disabled={gone}
        title={summary?.description ? `${summary.description}\n${t("workflow.view")}` : t("workflow.view")}
        onClick={() => open_workflow(view.run_id)}
      >
        <span className="tool-row-icon">
          <WorkflowToolIcon plain />
        </span>
        <span className={class_names("tool-row-label", running && "is-working")}>
          <WorkingLetters text={label} active={running} />
        </span>
      </button>
    </div>
  );
});
