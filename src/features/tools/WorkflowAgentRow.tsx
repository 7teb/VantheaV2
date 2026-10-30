import { useState } from "react";
import { find_model } from "../../../shared/models.ts";
import type { WorkflowAgentEntry, WorkflowAgentStatus } from "../../../shared/workflow.ts";
import { IconButton } from "../../components/Button.tsx";
import { CircleAlertIcon, CircleCheckIcon, CircleIcon, CircleSlashIcon, CircleSpinnerIcon, SkipForwardIcon, type IconComponent } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store, is_waiting } from "../../state/agent-approvals.ts";
import { open_agent_run } from "../../state/agents.ts";
import { models_store } from "../../state/models.ts";
import { use_store } from "../../state/use-store.ts";
import { skip_workflow_agent } from "../../state/workflows.ts";
import { agent_hint, agent_meta, agent_transcript, can_skip, shown_error } from "./workflow-model.ts";

const status_icons: Record<WorkflowAgentStatus, IconComponent> = {
  starting: CircleIcon,
  running: CircleSpinnerIcon,
  completed: CircleCheckIcon,
  cached: CircleCheckIcon,
  failed: CircleAlertIcon,
  interrupted: CircleAlertIcon,
  skipped: CircleSlashIcon,
  stopped: CircleSlashIcon,
};

type WorkflowAgentRowProps = { run_id: string; agent: WorkflowAgentEntry; now: number };

export const WorkflowAgentRow = ({ run_id, agent, now }: WorkflowAgentRowProps) => {
  const t = use_t();
  const run = agent.agent_run_id;
  const waiting = use_store(agent_approvals_store, (state) => run !== null && agent.status === "running" && is_waiting(state, run));
  const model = use_store(models_store, (state) => find_model(state.catalog, agent.model)?.label ?? agent.model);
  const [skipping, set_skipping] = useState(false);
  const [error, set_error] = useState("");
  const transcript = agent_transcript(agent);
  const StatusIcon = status_icons[agent.status];
  const problem = error || shown_error(agent);

  const skip = async () => {
    set_skipping(true);
    const result = await skip_workflow_agent(run_id, agent.index);
    set_error(result.ok ? "" : result.error);
    set_skipping(false);
  };

  return (
    <li className="workflow-agent" data-status={agent.status} data-waiting={waiting || undefined}>
      <button type="button" className="workflow-agent-main" disabled={transcript === null} title={agent_hint(t, agent, model)} onClick={() => transcript && open_agent_run(transcript)}>
        <span className="workflow-agent-icon">
          {waiting ? <span className="wait-dot" aria-hidden="true" /> : <StatusIcon size={14} className={agent.status === "running" ? "spin" : undefined} />}
        </span>
        <span className="workflow-agent-label">{agent.label}</span>
        <span className="workflow-agent-meta">{agent_meta(t, agent, now, waiting)}</span>
      </button>
      {can_skip(agent) && (
        <IconButton size="sm" className="workflow-agent-skip" label={t("workflow.skip_agent")} disabled={skipping} onClick={() => void skip()}>
          <SkipForwardIcon size={14} />
        </IconButton>
      )}
      {problem && <div className="workflow-agent-error">{problem}</div>}
    </li>
  );
};
