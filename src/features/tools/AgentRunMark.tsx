import { LoaderIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store, is_waiting } from "../../state/agent-approvals.ts";
import { agents_store } from "../../state/agents.ts";
import { use_store } from "../../state/use-store.ts";

export const AgentRunMark = ({ run_id }: { run_id: string }) => {
  const t = use_t();
  const running = use_store(agents_store, (state) => state.agents.some((agent) => agent.runs.some((run) => run.run_id === run_id && run.status === "running")));
  const waiting = use_store(agent_approvals_store, (state) => is_waiting(state, run_id));
  if (waiting) {
    return (
      <span className="tool-row-agent is-waiting">
        <span className="wait-dot" aria-hidden="true" />
        {t("agent.waiting_approval")}
      </span>
    );
  }
  if (running) {
    return (
      <span className="tool-row-agent" title={t("agent.status_running")}>
        <LoaderIcon size={13} className="spin" />
      </span>
    );
  }
  return null;
};
