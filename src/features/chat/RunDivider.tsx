import { useState, type ReactNode } from "react";
import type { UserMessage } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { CalendarClockIcon, ChevronRightIcon } from "../../components/icons.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import { clock_label } from "../scheduled/scheduled-time.ts";
import "./ScheduledRun.css";

export const use_lazy_open = () => {
  const [open, set_open] = useState(false);
  const [mounted, set_mounted] = useState(false);
  const toggle = () => {
    set_mounted(true);
    set_open(!open);
  };
  return { open, mounted, toggle, closed: () => set_mounted(false) };
};

type RunDividerProps = {
  label: string;
  open: boolean;
  expandable: boolean;
  on_toggle: () => void;
  on_closed: () => void;
  className?: string;
  group?: boolean;
  children?: ReactNode;
};

export const RunDivider = ({ label, open, expandable, on_toggle, on_closed, className, group = false, children }: RunDividerProps) => (
  <div className={class_names("origin-note", "run-divider", "enter-fade-up", className)} data-origin="scheduled" data-group={group || undefined} data-open={open}>
    <div className="run-divider-line">
      <button type="button" className="run-divider-head" disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={on_toggle}>
        <CalendarClockIcon />
        <span>{label}</span>
        {expandable && <ChevronRightIcon className="run-divider-chevron" />}
      </button>
    </div>
    {expandable && (
      <CollapsibleBody open={open} on_closed={on_closed}>
        {children}
      </CollapsibleBody>
    )}
  </div>
);

export const ScheduledRunNote = ({ message }: { message: UserMessage }) => {
  const t = use_t();
  const language = use_language();
  const fold = use_lazy_open();
  return (
    <RunDivider
      label={t("chat.origin_scheduled", { time: clock_label(message.created_at, Date.now(), language) })}
      open={fold.open}
      expandable={message.text.trim() !== ""}
      on_toggle={fold.toggle}
      on_closed={fold.closed}
    >
      {fold.mounted && <div className="run-divider-prompt inset-surface">{message.text}</div>}
    </RunDivider>
  );
};
