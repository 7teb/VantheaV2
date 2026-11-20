import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store, is_waiting } from "../../state/agent-approvals.ts";
import { use_store } from "../../state/use-store.ts";

export const AgentRunMark = ({ run_id }: { run_id: string }) => {
  const t = use_t();
  const waiting = use_store(agent_approvals_store, (state) => is_waiting(state, run_id));
  if (!waiting) {
    return null;
  }
  return (
    <span className="tool-row-agent is-waiting">
      <span className="wait-dot" aria-hidden="true" />
      {t("agent.waiting_approval")}
    </span>
  );
};
