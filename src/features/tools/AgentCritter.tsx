import { match_agents } from "../../../shared/agent-match.ts";
import type { ToolStep } from "../../../shared/chat.ts";
import type { AgentSummary } from "../../../shared/ipc/work.ts";
import { CritterIcon } from "../../components/icons.tsx";
import { agents_store } from "../../state/agents.ts";
import { use_store } from "../../state/use-store.ts";
import { text_arg, view_of } from "./tool-meta.ts";

const target_id = (step: ToolStep): string =>
  view_of(step, "agent")?.agent_id || view_of(step, "peer_message")?.to_id || text_arg(step, "agent_id") || text_arg(step, "to");

const target_name = (step: ToolStep): string | null =>
  view_of(step, "agent")?.name || view_of(step, "peer_message")?.to_name || text_arg(step, "name") || null;

const step_agent = (agents: AgentSummary[], step: ToolStep): AgentSummary | null => {
  const id = target_id(step);
  if (!id) {
    return null;
  }
  const matches = match_agents(agents, id);
  return matches.length === 1 ? matches[0] : null;
};

export const AgentCritter = ({ step }: { step: ToolStep }) => {
  const agent = use_store(agents_store, (state) => step_agent(state.agents, step));
  const running = agent?.runs.some((run) => run.status === "running") ?? false;
  return <CritterIcon name={agent?.name ?? target_name(step)} running={running} />;
};
