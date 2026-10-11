import { useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { shell_name } from "../../../shared/tool-view.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon } from "../../components/icons.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { CommandCard } from "./CommandCard.tsx";
import { is_command_step, reviewing_label } from "./review-phase.ts";
import "./ReviewPending.css";

export const ReviewingLabel = ({ step }: { step: ToolStep }) => {
  const t = use_t();
  const now = use_clock(true);
  return reviewing_label(t, step, now);
};

const ReviewLine = ({ row_open }: { row_open: boolean }) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  if (open && !row_open) {
    set_open(false);
  }
  return (
    <div className="review-pending" data-open={open}>
      <button type="button" className="review-pending-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <span className="review-pending-title">{t("review.pending_title")}</span>
        <ChevronRightIcon size={14} className="review-pending-chevron" />
      </button>
      <CollapsibleBody open={open} className="review-pending-motion">
        <p className="review-pending-detail">{t("review.pending_detail")}</p>
      </CollapsibleBody>
    </div>
  );
};

export const ReviewBody = ({ step, row_open }: { step: ToolStep; row_open: boolean }) => (
  <>
    <ReviewLine row_open={row_open} />
    {is_command_step(step) && <CommandCard shell={shell_name} command={String(step.args.command ?? "")} output={null} footer={null} />}
  </>
);
