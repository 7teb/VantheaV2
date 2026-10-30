import { useState } from "react";
import type { WorkflowSummary } from "../../../../shared/workflow.ts";
import { Button, IconButton } from "../../../components/Button.tsx";
import { ArrowLeftIcon, CircleStopIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { close_workflow, stop_workflow } from "../../../state/workflows.ts";
import { WorkflowSkeleton, WorkflowView } from "../../tools/WorkflowView.tsx";
import { DockEmpty, DockPanel, DockTitle } from "../DockPanel.tsx";
import { workflow_state } from "./WorkflowEntry.tsx";
import "../agents/agents.css";

type WorkflowPanelProps = { summary: WorkflowSummary | null; failed: boolean; now: number };

export const WorkflowPanel = ({ summary, failed, now }: WorkflowPanelProps) => {
  const t = use_t();
  const [stopping, set_stopping] = useState(false);
  const [error, set_error] = useState("");

  const stop = async (run_id: string) => {
    set_stopping(true);
    const result = await stop_workflow(run_id);
    set_error(result.ok ? "" : result.error);
    set_stopping(false);
  };

  const body = () => {
    if (summary) {
      return <WorkflowView summary={summary} />;
    }
    return failed ? <DockEmpty text={t("workflow.load_failed")} /> : <WorkflowSkeleton />;
  };

  return (
    <DockPanel
      title={
        <div className="agent-head">
          <IconButton label={t("agent.back")} onClick={close_workflow}>
            <ArrowLeftIcon size={16} />
          </IconButton>
          <DockTitle label={summary?.name || t("workflow.kind")} meta={summary ? workflow_state(t, summary, now) : undefined} />
        </div>
      }
      close_label={t("background.close")}
      actions={
        summary?.status === "running" && (
          <Button variant="ghost" icon={<CircleStopIcon size={14} />} disabled={stopping} onClick={() => void stop(summary.run_id)}>
            {t("agent.stop")}
          </Button>
        )
      }
    >
      {error && <div className="agent-panel-error">{error}</div>}
      <div className="dock-scroll agent-scroll">{body()}</div>
    </DockPanel>
  );
};
