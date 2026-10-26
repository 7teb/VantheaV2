import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { DotSpinner } from "../../components/DotSpinner.tsx";
import { ChevronRightIcon, SquareTerminalIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { group_head } from "./group-head.ts";
import { ReviewingLabel } from "./ReviewPending.tsx";
import { Elapsed } from "./RowMeta.tsx";
import { ThoughtRow } from "./ThoughtRow.tsx";
import { is_active_status } from "./tool-meta.ts";
import { ToolRow } from "./ToolRow.tsx";
import { format_duration } from "./tool-summary.ts";
import { use_held_label } from "./use-held-label.ts";
import { use_pinned_bottom } from "./use-pinned-bottom.ts";
import { group_span, group_start, shown_step, work_tools, type WorkStep } from "./work-steps.ts";
import "./tools.css";
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

const GroupMeta = ({ steps, running }: { steps: WorkStep[]; running: boolean }) => {
  const start = group_start(steps);
  if (running) {
    return start === null ? null : <Elapsed started_at={start} />;
  }
  const span = group_span(steps);
  return span === null ? null : <span className="tool-row-duration">{format_duration(span)}</span>;
};

type StepGroupProps = { chat_id: string; steps: WorkStep[]; streaming: boolean; pending: boolean; run?: RunRef };

const StepGroup = ({ chat_id, steps, streaming, pending, run }: StepGroupProps) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const latest = group_head(t, steps, streaming, pending);
  const head = use_held_label(latest.key, latest);
  const { scroller, content } = use_pinned_bottom(streaming);
  const running = head.kind !== "done";
  const reviewing = head.kind === "review";
  return (
    <div className="work-group" data-open={open} data-live={streaming || undefined} data-running={running || undefined} data-review={reviewing || undefined}>
      <button type="button" className="work-group-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="tool-row-icon">{running ? <DotSpinner /> : <SquareTerminalIcon size={14} />}</span>
        <span className={class_names("tool-row-label", running && !reviewing && "is-working")}>
          {head.kind === "review" ? <ReviewingLabel step={head.step} /> : head.label}
        </span>
        <GroupMeta steps={steps} running={running} />
        <ChevronRightIcon size={12} className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div ref={scroller} className="work-group-scroll">
          <div ref={content} className="work-group-body">
            {steps
              .filter(shown_step)
              .map((step) =>
                step.kind === "tool" ? (
                  <ToolRow key={step.id} chat_id={chat_id} step={step} main_chat={run === undefined} />
                ) : (
                  <ThoughtRow key={step.id} step={step} live={streaming} />
                ),
              )}
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
