import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CombineIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { is_active_status, tool_label } from "./tool-meta.ts";
import { ToolRow } from "./ToolRow.tsx";
import { format_duration, group_duration, group_label } from "./tool-summary.ts";
import "./tools.css";

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

type WorkGroupProps = { chat_id: string; steps: ToolStep[]; running: boolean; run?: RunRef };

const WorkGroupView = ({ chat_id, steps, running, run }: WorkGroupProps) => {
  const t = use_t();
  const [chosen, set_chosen] = useState<boolean | null>(null);
  if (steps.length === 1) {
    return (
      <div className="work-single">
        <ToolRow step={steps[0]} running={running} />
        <Approvals chat_id={chat_id} steps={steps} run={run} />
      </div>
    );
  }
  const open = chosen ?? running;
  const current = steps.findLast((step) => is_active_status(step.status)) ?? steps[steps.length - 1];
  const duration = group_duration(steps);
  return (
    <div className="work-group" data-open={open}>
      <button type="button" className="work-group-head" aria-expanded={open} onClick={() => set_chosen(!open)}>
        <span className="tool-row-icon">
          <CombineIcon size={14} />
        </span>
        <span className={class_names("tool-row-label", running && "is-working")}>{running ? tool_label(t, current) : group_label(t, steps)}</span>
        {!running && duration !== null && <span className="tool-row-duration">{format_duration(duration)}</span>}
        <ChevronRightIcon size={12} className="tool-row-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div className="work-group-body">
          {steps.map((step) => (
            <ToolRow key={step.id} step={step} />
          ))}
        </div>
      </CollapsibleBody>
      <Approvals chat_id={chat_id} steps={steps} run={run} />
    </div>
  );
};

const same_steps = (left: ToolStep[], right: ToolStep[]) => left.length === right.length && left.every((step, index) => step === right[index]);

export const WorkGroup = memo(
  WorkGroupView,
  (previous, next) =>
    previous.chat_id === next.chat_id && previous.running === next.running && previous.run === next.run && same_steps(previous.steps, next.steps),
);
