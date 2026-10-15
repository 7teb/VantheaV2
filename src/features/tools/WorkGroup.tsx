import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, SquareTerminalIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import type { RunRef } from "../../state/agents-reduce.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { is_reviewing } from "./review-phase.ts";
import { ReviewingLabel } from "./ReviewPending.tsx";
import { is_active_status, tool_label } from "./tool-meta.ts";
import { ToolRow } from "./ToolRow.tsx";
import { group_current, group_label } from "./tool-summary.ts";
import "./tools.css";
import "./tool-motion.css";

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

type WorkGroupProps = { chat_id: string; steps: ToolStep[]; streaming: boolean; tail: boolean; run?: RunRef };

const WorkGroupView = ({ chat_id, steps, streaming, tail, run }: WorkGroupProps) => {
  const t = use_t();
  const [chosen, set_chosen] = useState<boolean | null>(null);
  const single = steps.length === 1;
  const current = streaming && !single ? group_current(steps) : null;
  const running = current !== null;
  const open = single || (chosen ?? (streaming && (tail || running)));
  const reviewing = current !== null && is_reviewing(current);
  const label = current ? tool_label(t, current) : group_label(t, steps);
  return (
    <div
      className={single ? "work-single" : "work-group"}
      data-open={single ? undefined : open}
      data-live={streaming || undefined}
      data-running={running || undefined}
      data-review={reviewing || undefined}
    >
      {!single && (
        <button type="button" className="work-group-head" aria-expanded={open} onClick={() => set_chosen(!open)}>
          <span className="tool-row-icon">
            <SquareTerminalIcon size={14} />
          </span>
          <span className={class_names("tool-row-label", running && !reviewing && "is-working")}>
            {reviewing ? <ReviewingLabel step={current} /> : label}
          </span>
          <ChevronRightIcon size={12} className="tool-row-chevron" />
        </button>
      )}
      <CollapsibleBody open={open}>
        <div className={single ? undefined : "work-group-body"}>
          {steps.map((step) => (
            <ToolRow
              key={step.id}
              chat_id={chat_id}
              step={step}
              running={single && streaming && (tail || is_active_status(step.status))}
              main_chat={run === undefined}
            />
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
    previous.chat_id === next.chat_id &&
    previous.streaming === next.streaming &&
    previous.tail === next.tail &&
    previous.run === next.run &&
    same_steps(previous.steps, next.steps),
);
