import { memo, useState } from "react";
import type { ToolStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, CircleAlertIcon, CircleSlashIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { has_body, tool_icon, ToolBody } from "./registry.tsx";
import { is_active_status, tool_label } from "./tool-meta.ts";
import { format_duration, step_detail, step_duration } from "./tool-summary.ts";
import "./tools.css";

const StatusMark = ({ status }: { status: ToolStep["status"] }) => {
  const t = use_t();
  switch (status) {
    case "failed":
      return (
        <span className="tool-row-status is-failed" title={t("tools.status_failed")}>
          <CircleAlertIcon size={13} />
        </span>
      );
    case "denied":
      return (
        <span className="tool-row-status" title={t("tools.status_denied")}>
          <CircleSlashIcon size={13} />
        </span>
      );
    case "cancelled":
      return <span className="tool-row-status">{t("tools.status_cancelled")}</span>;
    case "queued":
      return <span className="tool-row-status">{t("tools.status_queued")}</span>;
    case "awaiting_approval":
      return <span className="tool-row-status">{t("tools.awaiting")}</span>;
    case "drafting":
    case "running":
    case "done":
      return null;
  }
};

type ToolRowProps = { step: ToolStep; running?: boolean };

export const ToolRow = memo(({ step, running = false }: ToolRowProps) => {
  const t = use_t();
  const [chosen, set_chosen] = useState<boolean | null>(null);
  const [seen, set_seen] = useState(false);
  const Icon = tool_icon(step);
  const active = is_active_status(step.status);
  const detail = step_detail(t, step);
  const duration = step_duration(step);
  const expandable = has_body(step);
  const open = expandable && (chosen ?? running);
  if (open && !seen) {
    set_seen(true);
  }
  return (
    <div className="tool-row" data-status={step.status} data-open={open}>
      <button
        type="button"
        className="tool-row-head"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => set_chosen(!open)}
      >
        <span className="tool-row-icon">
          <Icon size={14} />
        </span>
        <span className={class_names("tool-row-label", active && "is-working")}>{tool_label(t, step)}</span>
        {detail && <span className="tool-row-detail">{detail}</span>}
        <StatusMark status={step.status} />
        {duration !== null && !active && <span className="tool-row-duration">{format_duration(duration)}</span>}
        {expandable && <ChevronRightIcon size={12} className="tool-row-chevron" />}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="tool-row-body">{seen && <ToolBody step={step} />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
});
