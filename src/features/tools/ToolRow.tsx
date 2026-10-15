import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { is_shell_run } from "../../../shared/shell.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CircleAlertIcon, ShieldTerminalIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_agent_run } from "../../state/agents.ts";
import { AgentCritter } from "./AgentCritter.tsx";
import { AgentRunMark } from "./AgentRunMark.tsx";
import { DraftLines } from "./DraftLines.tsx";
import { tool_icon, ToolBody } from "./registry.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewingLabel } from "./ReviewPending.tsx";
import { CommandTime, RowDetail } from "./RowMeta.tsx";
import { has_body, opens_by_itself } from "./tool-body.ts";
import { is_active_status, started_run, tool_label, tool_meta } from "./tool-meta.ts";
import { step_hint } from "./tool-summary.ts";
import "./tools.css";
import "./tool-motion.css";

const StatusMark = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  switch (step.status) {
    case "failed":
      return (
        <span className="tool-row-status is-failed" title={t("tools.status_failed")}>
          <CircleAlertIcon size={13} />
        </span>
      );
    case "cancelled":
      return <span className="tool-row-status">{t("tools.status_cancelled")}</span>;
    case "queued":
      return <span className="tool-row-status">{t("tools.status_queued")}</span>;
    case "awaiting_approval":
      return <span className="tool-row-status">{t("tools.awaiting")}</span>;
    case "denied":
    case "drafting":
    case "running":
    case "done":
      return null;
  }
};

type ToolRowProps = { chat_id: string; step: ToolStep; running?: boolean; main_chat?: boolean };

export const ToolRow = memo(({ chat_id, step, running = false, main_chat = false }: ToolRowProps) => {
  const t = use_t();
  const [chosen, set_chosen] = useState<boolean | null>(null);
  const [seen, set_seen] = useState(false);
  const Icon = tool_icon(step);
  const active = is_active_status(step.status);
  const edit = step.view?.kind === "edit" ? step.view : null;
  const drafted = step.status === "drafting" ? (step.progress?.lines ?? 0) : 0;
  const reviewing = is_reviewing(step);
  const expandable = has_body(t, step);
  const run = !expandable && step.view?.kind === "agent" ? step.view : null;
  const started = started_run(step);
  const open = expandable && (chosen ?? (running && opens_by_itself(step, main_chat)));
  if (open && !seen) {
    set_seen(true);
  }
  return (
    <div className="tool-row" data-status={step.status} data-open={open} data-review={reviewing || undefined}>
      <button
        type="button"
        className="tool-row-head"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable && !run}
        title={run ? t("agent.view_transcript") : step_hint(step) || undefined}
        onClick={() => (run ? open_agent_run({ agent_id: run.agent_id, run_id: run.run_id }) : set_chosen(!open))}
      >
        <span className="tool-row-icon">
          {step.status !== "denied" && tool_meta(step).icon === "agent" ? <AgentCritter step={step} /> : <Icon size={14} />}
        </span>
        <span className={class_names("tool-row-label", active && step.status !== "queued" && !reviewing && "is-working")}>
          {reviewing ? <ReviewingLabel step={step} /> : tool_label(t, step)}
        </span>
        {reviewing && <ShieldTerminalIcon size={16} className="tool-row-shield" />}
        {edit && <span className="tool-stat-add">+{edit.added}</span>}
        {edit && <span className="tool-stat-remove">-{edit.removed}</span>}
        {drafted > 0 && <DraftLines count={drafted} />}
        {!edit && !drafted && <RowDetail chat_id={chat_id} step={step} />}
        {started && <AgentRunMark run_id={started.run_id} />}
        <StatusMark step={step} />
        {is_shell_run(step.name) && <CommandTime step={step} />}
        {expandable && <ChevronRightIcon size={12} className="tool-row-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="tool-row-body">{seen && <ToolBody step={step} open={open} chat_id={chat_id} />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
});
