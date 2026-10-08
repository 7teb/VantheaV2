import { useState } from "react";
import type { AgentRunSummary, AgentSummary } from "../../../../shared/ipc/work.ts";
import { IconButton } from "../../../components/Button.tsx";
import { class_names } from "../../../components/class-names.ts";
import { BotIcon, ChevronRightIcon, CircleStopIcon } from "../../../components/icons.tsx";
import { Skeleton } from "../../../components/Skeleton.tsx";
import { use_t } from "../../../i18n/index.ts";
import { agent_approvals_store, is_waiting } from "../../../state/agent-approvals.ts";
import { cancel_agent, select_agent_run } from "../../../state/agents.ts";
import { find_model, models_store } from "../../../state/models.ts";
import { use_store } from "../../../state/use-store.ts";
import { first_line, profile_labels, run_duration, status_icons, status_labels } from "./agent-meta.ts";

export const AgentListSkeleton = () => (
  <div className="agent-list" aria-busy="true">
    {[38, 52, 30].map((width, index) => (
      <div key={index} className="agent-entry">
        <div className="agent-entry-head">
          <Skeleton width={15} height={15} radius={8} />
          <Skeleton width={`${width}%`} height={12} radius={4} />
          <Skeleton width="22%" height={10} radius={4} />
        </div>
        <div className="agent-run-skeleton">
          <Skeleton width={14} height={14} radius={7} />
          <Skeleton width={`${width + 34}%`} height={11} radius={4} />
        </div>
      </div>
    ))}
  </div>
);

type RunRowProps = { agent_id: string; run: AgentRunSummary; now: number };

const RunRow = ({ agent_id, run, now }: RunRowProps) => {
  const t = use_t();
  const StatusIcon = status_icons[run.status];
  const waiting = use_store(agent_approvals_store, (state) => run.status === "running" && is_waiting(state, run.run_id));
  return (
    <li>
      <button type="button" className="agent-run" data-status={run.status} data-waiting={waiting} onClick={() => select_agent_run({ agent_id, run_id: run.run_id })}>
        {waiting ? (
          <span className="agent-run-wait" title={t("agent.waiting_approval")}>
            <span className="wait-dot" />
          </span>
        ) : (
          <StatusIcon size={14} className={class_names("agent-run-icon", run.status === "running" && "spin")} />
        )}
        <span className="agent-run-prompt" title={run.prompt}>
          {first_line(run.prompt) || t("agent.untitled_run")}
        </span>
        <span className="agent-run-meta">
          {t(waiting ? "agent.waiting_approval" : status_labels[run.status])} · {run_duration(run, now)}
        </span>
        <ChevronRightIcon size={12} className="agent-run-chevron" />
      </button>
    </li>
  );
};

const AgentEntry = ({ agent, now }: { agent: AgentSummary; now: number }) => {
  const t = use_t();
  const catalog = use_store(models_store, (state) => state.catalog);
  const [stopping, set_stopping] = useState(false);
  const [error, set_error] = useState("");
  const model = find_model(catalog, agent.model)?.label ?? agent.model;
  const running = agent.runs.some((run) => run.status === "running");

  const stop = async () => {
    set_stopping(true);
    const result = await cancel_agent(agent.agent_id);
    set_error(result.ok ? "" : result.error);
    set_stopping(false);
  };

  return (
    <section className="agent-entry" data-running={running}>
      <header className="agent-entry-head">
        <BotIcon size={15} className="agent-entry-icon" />
        <span className="agent-entry-name" title={agent.description || agent.name}>
          {agent.name}
        </span>
        <span className="agent-entry-meta">
          {t(profile_labels[agent.profile])} · {model}
        </span>
        {running && (
          <IconButton size="sm" label={t("agent.cancel")} disabled={stopping} onClick={() => void stop()}>
            <CircleStopIcon size={15} />
          </IconButton>
        )}
      </header>
      {error && <div className="agent-entry-error">{error}</div>}
      <ul className="agent-runs">
        {[...agent.runs].reverse().map((run) => (
          <RunRow key={run.run_id} agent_id={agent.agent_id} run={run} now={now} />
        ))}
      </ul>
    </section>
  );
};

export const AgentList = ({ agents, now }: { agents: AgentSummary[]; now: number }) => (
  <div className="agent-list">
    {[...agents].reverse().map((agent) => (
      <AgentEntry key={agent.agent_id} agent={agent} now={now} />
    ))}
  </div>
);
