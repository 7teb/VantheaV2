import { useState } from "react";
import type { AgentApproval } from "../../../shared/ipc/work.ts";
import { BotIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store } from "../../state/agent-approvals.ts";
import { open_agent_run } from "../../state/agents.ts";
import { use_store } from "../../state/use-store.ts";
import { ApprovalCard } from "../tools/ApprovalCard.tsx";
import "./AgentApprovals.css";

const approval_key = (approval: AgentApproval) => `${approval.run_id}/${approval.call_id}`;

export const AgentApprovals = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const approvals = use_store(agent_approvals_store, (state) => (state.chat_id === chat_id ? state.approvals : null));
  const [pinned, set_pinned] = useState<string | null>(null);
  const shown = approvals?.find((entry) => approval_key(entry) === pinned) ?? approvals?.[0];
  const shown_key = shown ? approval_key(shown) : null;
  if (shown_key !== pinned) {
    set_pinned(shown_key);
  }
  if (!approvals || !shown || !shown_key) {
    return null;
  }
  const run = { agent_id: shown.agent_id, run_id: shown.run_id };
  const title = t("approval.agent_request", { name: shown.name || t("agent.transcript") });
  return (
    <section className="agent-approvals enter-fade-up" aria-label={title}>
      <header className="agent-approvals-head">
        <span className="wait-dot" aria-hidden="true" />
        <span className="agent-approvals-title">{title}</span>
        {approvals.length > 1 && <span className="agent-approvals-more">{t("approval.more_waiting", { n: approvals.length - 1 })}</span>}
        <button type="button" className="agent-approvals-open" onClick={() => open_agent_run(run)}>
          <BotIcon size={13} />
          {t("agent.view_transcript")}
        </button>
      </header>
      <div className="agent-approvals-body">
        <ApprovalCard key={shown_key} chat_id={chat_id} call_id={shown.call_id} request={shown.request} run={run} />
      </div>
    </section>
  );
};
