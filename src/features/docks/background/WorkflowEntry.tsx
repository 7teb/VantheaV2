import { useState } from "react";
import type { AgentRunStatus } from "../../../../shared/ipc/work.ts";
import type { WorkflowStatus, WorkflowSummary } from "../../../../shared/workflow.ts";
import { IconButton } from "../../../components/Button.tsx";
import { class_names } from "../../../components/class-names.ts";
import { ChevronRightIcon, CircleStopIcon, WorkflowIcon } from "../../../components/icons.tsx";
import { use_t, type Translate } from "../../../i18n/index.ts";
import { open_workflow, stop_workflow } from "../../../state/workflows.ts";
import { agent_status_keys } from "../../tools/background-status.ts";
import { agents_line, end_label } from "../../tools/workflow-model.ts";
import { first_line, run_duration, status_icons } from "../agents/agent-meta.ts";
import "../agents/agents.css";

const run_tones: Record<WorkflowStatus, AgentRunStatus> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  stopped: "cancelled",
  interrupted: "interrupted",
};

export const workflow_tone = (status: WorkflowStatus): AgentRunStatus => run_tones[status];

export const workflow_state = (t: Translate, summary: WorkflowSummary, now: number): string =>
  [summary.status === "running" ? t(agent_status_keys.running) : end_label(t, summary.status), agents_line(t, summary), run_duration(summary, now)].filter(Boolean).join(" · ");

const activity = (summary: WorkflowSummary): string => first_line(summary.logs.at(-1)?.text ?? "") || summary.description || summary.name;

export const WorkflowEntry = ({ summary, now }: { summary: WorkflowSummary; now: number }) => {
  const t = use_t();
  const [stopping, set_stopping] = useState(false);
  const [error, set_error] = useState("");
  const running = summary.status === "running";
  const tone = workflow_tone(summary.status);
  const StatusIcon = status_icons[tone];

  const stop = async () => {
    set_stopping(true);
    const result = await stop_workflow(summary.run_id);
    set_error(result.ok ? "" : result.error);
    set_stopping(false);
  };

  return (
    <section className="agent-entry workflow-entry" data-running={running}>
      <header className="agent-entry-head">
        <WorkflowIcon size={16} />
        <span className="agent-entry-name" title={summary.description || summary.name}>
          {summary.name}
        </span>
        <span className="agent-entry-meta">{t("workflow.kind")}</span>
        {running && (
          <IconButton size="sm" label={t("workflow.stop")} disabled={stopping} onClick={() => void stop()}>
            <CircleStopIcon size={15} />
          </IconButton>
        )}
      </header>
      {error && <div className="agent-entry-error">{error}</div>}
      <ul className="agent-runs">
        <li>
          <button type="button" className="agent-run" data-status={tone} onClick={() => open_workflow(summary.run_id)}>
            <StatusIcon size={14} className={class_names("agent-run-icon", running && "spin")} />
            <span className="agent-run-prompt" title={activity(summary)}>
              {activity(summary)}
            </span>
            <span className="agent-run-meta">{workflow_state(t, summary, now)}</span>
            <ChevronRightIcon size={12} className="agent-run-chevron" />
          </button>
        </li>
      </ul>
    </section>
  );
};
