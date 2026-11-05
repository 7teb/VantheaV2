import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { is_shell_run } from "../../../shared/shell.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, ShieldTerminalIcon } from "../../components/icons.tsx";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { use_t } from "../../i18n/index.ts";
import { open_agent_run } from "../../state/agents.ts";
import { AgentCritter } from "./AgentCritter.tsx";
import { AgentRunMark } from "./AgentRunMark.tsx";
import { DraftLines } from "./DraftLines.tsx";
import { tool_icon, ToolBody } from "./registry.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewingLabel } from "./ReviewPending.tsx";
import { CommandTime, RowDetail } from "./RowMeta.tsx";
import { has_body, is_agent_message, opens_by_itself } from "./tool-body.ts";
import { is_active_status, started_run, tool_label, tool_meta } from "./tool-meta.ts";
import { step_hint } from "./tool-summary.ts";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { WebSearchRow, shows_web_row } from "./WebSearchRow.tsx";
import { workflow_view } from "./workflow-model.ts";
import { WorkflowRow } from "./WorkflowRow.tsx";
import "./tools.css";
import "./tool-motion.css";

const StatusMark = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  switch (step.status) {
    case "cancelled":
      return <span className="tool-row-status">{t("tools.status_cancelled")}</span>;
    case "queued":
      return <span className="tool-row-status">{t("tools.status_queued")}</span>;
    case "awaiting_approval":
      return <span className="tool-row-status">{t("tools.awaiting")}</span>;
    case "failed":
    case "denied":
    case "drafting":
    case "running":
    case "done":
      return null;
  }
};

type ToolRowProps = { chat_id: string; step: ToolStep; running?: boolean; main_chat?: boolean };

const PlainToolRow = ({ chat_id, step, running = false, main_chat = false }: ToolRowProps) => {
  const t = use_t();
  const [chosen, set_chosen] = useState<boolean | null>(null);
  const [seen, set_seen] = useState(false);
  const Icon = tool_icon(step);
  const active = is_active_status(step.status);
  const working = active && step.status !== "queued";
  const label = tool_label(t, step);
  const edit = step.view?.kind === "edit" ? step.view : null;
  const drafted = step.status === "drafting" ? (step.progress?.lines ?? 0) : 0;
  const reviewing = is_reviewing(step);
  const expandable = has_body(t, step);
  const run = !expandable && step.view?.kind === "agent" && !is_agent_message(step) ? step.view : null;
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
          {step.status !== "denied" && tool_meta(step).icon === "agent" ? <AgentCritter chat_id={chat_id} step={step} /> : <Icon />}
        </span>
        <span className={class_names("tool-row-label", working && !reviewing && "is-working")}>
          <LabelMorph morph_key={reviewing ? "review" : `${working}:${label}`}>
            {reviewing ? <ReviewingLabel step={step} /> : <WorkingLetters text={label} active={working} />}
          </LabelMorph>
        </span>
        {reviewing && <ShieldTerminalIcon className="tool-row-shield" />}
        {edit && <span className="tool-stat-add">+{edit.added}</span>}
        {edit && <span className="tool-stat-remove">-{edit.removed}</span>}
        {drafted > 0 && <DraftLines count={drafted} />}
        {started && <AgentRunMark run_id={started.run_id} />}
        <StatusMark step={step} />
        <span className="tool-row-meta">
          {!edit && !drafted && <RowDetail chat_id={chat_id} step={step} />}
          {is_shell_run(step.name) && (
            <LabelMorph morph_key={step.status === "running" ? "elapsed" : "duration"}>
              <CommandTime step={step} />
            </LabelMorph>
          )}
        </span>
        {expandable && <ChevronRightIcon className="tool-row-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="tool-row-body">{seen && <ToolBody step={step} chat_id={chat_id} />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
};

export const ToolRow = memo((props: ToolRowProps) => {
  const view = workflow_view(props.step);
  if (view) {
    return <WorkflowRow chat_id={props.chat_id} view={view} />;
  }
  return shows_web_row(props.step) ? <WebSearchRow chat_id={props.chat_id} step={props.step} /> : <PlainToolRow {...props} />;
});
