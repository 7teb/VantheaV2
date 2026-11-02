import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { DotSpinner } from "../../components/DotSpinner.tsx";
import { ChevronRightIcon, SquareTerminalIcon } from "../../components/icons.tsx";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { use_t } from "../../i18n/index.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { MainMessageRow } from "../chat/MainMessageRow.tsx";
import { NoticeRow } from "../chat/StepRows.tsx";
import { AgentCritter } from "./AgentCritter.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { group_head, open_head } from "./group-head.ts";
import { ReviewingLabel } from "./ReviewPending.tsx";
import { Elapsed } from "./RowMeta.tsx";
import { ThoughtRow } from "./ThoughtRow.tsx";
import { tool_icons } from "./registry.tsx";
import { is_active_status, tool_meta } from "./tool-meta.ts";
import { ToolRow } from "./ToolRow.tsx";
import { format_duration } from "./tool-summary.ts";
import { use_held_label } from "./use-held-label.ts";
import { use_live_workflow } from "./use-live-workflow.ts";
import { use_pinned_bottom } from "./use-pinned-bottom.ts";
import { group_span, group_start, shown_step, work_tools, type WorkStep } from "./work-steps.ts";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import "./tools.css";
import "./tools-touch.css";
import "./tool-motion.css";
import "./WorkGroup.css";

type ApprovalsProps = { chat_id: string; steps: ToolStep[]; run?: RunRef };

const Approvals = ({ chat_id, steps, run }: ApprovalsProps) => (
  <>
    {steps.map((step) =>
      step.status === "awaiting_approval" && step.approval ? (
        <ApprovalCard key={step.id} chat_id={chat_id} call_id={step.call_id} request={step.approval} run={run} />
      ) : null,
    )}
  </>
);

type SingleStepProps = { chat_id: string; step: ToolStep; streaming: boolean; tail: boolean; run?: RunRef };

const SingleStep = ({ chat_id, step, streaming, tail, run }: SingleStepProps) => (
  <div className="work-single" data-live={streaming || undefined}>
    <CollapsibleBody open>
      <div>
        <ToolRow chat_id={chat_id} step={step} running={streaming && (tail || is_active_status(step.status))} main_chat={run === undefined} />
      </div>
    </CollapsibleBody>
    <Approvals chat_id={chat_id} steps={[step]} run={run} />
  </div>
);

const GroupMeta = ({ steps, running, live_start }: { steps: WorkStep[]; running: boolean; live_start: number | null }) => {
  const start = live_start ?? group_start(steps);
  if (running) {
    return start === null ? null : <Elapsed started_at={start} />;
  }
  const span = group_span(steps);
  return span === null ? null : <span className="tool-row-duration">{format_duration(span)}</span>;
};

const GroupCounts = ({ failed, denied }: { failed: number; denied: number }) => {
  const t = use_t();
  return (
    <>
      {failed > 0 && <span className="tool-row-status is-failed">{t(failed === 1 ? "tools.group_failed_one" : "tools.group_failed_other", { n: failed })}</span>}
      {denied > 0 && <span className="tool-row-status is-denied">{t(denied === 1 ? "tools.group_denied_one" : "tools.group_denied_other", { n: denied })}</span>}
    </>
  );
};

const GroupIcon = ({ chat_id, steps }: { chat_id: string; steps: WorkStep[] }) => {
  const first = work_tools(steps)[0];
  if (!first) {
    return <SquareTerminalIcon />;
  }
  const icon = tool_meta(first).icon;
  if (icon === "agent" && first.status !== "denied") {
    return <AgentCritter chat_id={chat_id} step={first} />;
  }
  const Icon = tool_icons[icon];
  return <Icon />;
};

type GroupRowProps = { chat_id: string; step: WorkStep; streaming: boolean; main_chat: boolean };

const GroupRow = ({ chat_id, step, streaming, main_chat }: GroupRowProps) => {
  if (step.kind === "tool") {
    return <ToolRow chat_id={chat_id} step={step} main_chat={main_chat} />;
  }
  if (step.kind === "notice") {
    return <NoticeRow step={step} />;
  }
  if (step.kind === "steer") {
    return <MainMessageRow chat_id={chat_id} />;
  }
  return <ThoughtRow step={step} live={streaming} />;
};

type StepGroupProps = { chat_id: string; steps: WorkStep[]; streaming: boolean; pending: boolean; run?: RunRef };

const StepGroup = ({ chat_id, steps, streaming, pending, run }: StepGroupProps) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const live = use_live_workflow(steps);
  const latest = group_head(t, steps, streaming, pending, live);
  const head = use_held_label(latest.key, latest);
  const { scroller, content } = use_pinned_bottom(streaming);
  const running = head.kind !== "done";
  const reviewing = head.kind === "review";
  const progress = open && running ? open_head(t, steps) : null;
  const shown = progress ?? head;
  const working = shown.kind !== "done";
  return (
    <div className="work-group" data-open={open} data-live={streaming || undefined} data-running={running || undefined} data-review={reviewing || undefined}>
      <button type="button" className="work-group-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">
          <LabelMorph morph_key={running ? "spinner" : "icon"}>{running ? <DotSpinner /> : <GroupIcon chat_id={chat_id} steps={steps} />}</LabelMorph>
        </span>
        {(shown.kind === "review" || shown.label !== "") && (
          <span className={class_names("tool-row-label", working && shown.kind !== "review" && "is-working")}>
            <LabelMorph morph_key={shown.kind === "review" ? shown.key : `${working}:${shown.label}`}>
              {shown.kind === "review" ? <ReviewingLabel step={shown.step} /> : <WorkingLetters text={shown.label} active={working} />}
            </LabelMorph>
          </span>
        )}
        {shown.kind === "done" && <GroupCounts failed={shown.failed} denied={shown.denied} />}
        <LabelMorph morph_key={running ? "elapsed" : "duration"}>
          <GroupMeta steps={steps} running={running} live_start={head.kind === "workflow" ? head.started_at : null} />
        </LabelMorph>
        <ChevronRightIcon className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div ref={scroller} className="work-group-scroll">
          <div ref={content} className="work-group-body">
            {steps.filter(shown_step).map((step) => (
              <GroupRow key={step.id} chat_id={chat_id} step={step} streaming={streaming} main_chat={run === undefined} />
            ))}
          </div>
        </div>
      </CollapsibleBody>
      <Approvals chat_id={chat_id} steps={work_tools(steps)} run={run} />
    </div>
  );
};

type WorkGroupProps = { chat_id: string; steps: WorkStep[]; streaming: boolean; tail: boolean; pending?: boolean; run?: RunRef };

const WorkGroupView = ({ chat_id, steps, streaming, tail, pending = false, run }: WorkGroupProps) => {
  const single = steps.length === 1 ? steps[0] : undefined;
  if (single?.kind === "tool") {
    return <SingleStep chat_id={chat_id} step={single} streaming={streaming} tail={tail} run={run} />;
  }
  return <StepGroup chat_id={chat_id} steps={steps} streaming={streaming} pending={pending} run={run} />;
};

const same_steps = (left: WorkStep[], right: WorkStep[]) => left.length === right.length && left.every((step, index) => step === right[index]);

export const WorkGroup = memo(
  WorkGroupView,
  (previous, next) =>
    previous.chat_id === next.chat_id &&
    previous.streaming === next.streaming &&
    previous.tail === next.tail &&
    previous.pending === next.pending &&
    previous.run === next.run &&
    same_steps(previous.steps, next.steps),
);
