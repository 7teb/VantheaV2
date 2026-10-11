import { useState } from "react";
import type { AgentApproval } from "../../../shared/ipc/work.ts";
import { use_t } from "../../i18n/index.ts";
import { agent_approvals_store } from "../../state/agent-approvals.ts";
import { use_store } from "../../state/use-store.ts";
import { ApprovalCard } from "../tools/ApprovalCard.tsx";

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
  return (
    <div className="composer-dock-card raised-surface enter-fade-up">
      <ApprovalCard key={shown_key} chat_id={chat_id} call_id={shown.call_id} request={shown.request} run={run} actor={shown.name || t("agent.transcript")} />
    </div>
  );
};
