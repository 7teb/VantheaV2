import { useState } from "react";
import type { AgentRunSummary, AgentSummary } from "../../../../shared/ipc/work.ts";
import { IconButton } from "../../../components/Button.tsx";
import { class_names } from "../../../components/class-names.ts";
import { BotIcon, ChevronRightIcon, CircleStopIcon } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { agent_approvals_store, is_waiting } from "../../../state/agent-approvals.ts";
import { cancel_agent, select_agent_run } from "../../../state/agents.ts";
import { find_model, models_store } from "../../../state/models.ts";
import { use_store } from "../../../state/use-store.ts";
import { agent_status_keys } from "../../tools/background-status.ts";
import { first_line, profile_labels, run_duration, status_icons } from "./agent-meta.ts";
import "./agents.css";

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
          {[
            t(waiting ? "agent.waiting_approval" : agent_status_keys[run.status]),
            ...(run.status === "running" && run.open_questions > 0
              ? [t(run.open_questions === 1 ? "agent.open_questions_one" : "agent.open_questions_other", { n: run.open_questions })]
              : []),
            run_duration(run, now),
          ].join(" · ")}
        </span>
        <ChevronRightIcon size={12} className="agent-run-chevron" />
      </button>
    </li>
  );
};

export const AgentEntry = ({ agent, now }: { agent: AgentSummary; now: number }) => {
  const t = use_t();
  const catalog = use_store(models_store, (state) => state.catalog);
  const [stopping, set_stopping] = useState(false);
  const [error, set_error] = useState("");
  const model = find_model(catalog, agent.model)?.label ?? agent.model;
  const running = agent.runs.some((run) => run.status === "running");
  const without = agent.without_tools.length ? t("agent.without_tools", { x: agent.without_tools.join(", ") }) : "";
  const meta = [agent.topic, t(profile_labels[agent.profile]), without, model].filter(Boolean).join(" · ");

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
        <span className="agent-entry-meta" title={meta}>
          {meta}
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
