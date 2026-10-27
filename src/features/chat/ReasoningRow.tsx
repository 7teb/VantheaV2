import { memo, useState } from "react";
import type { ReasoningStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t } from "../../i18n/index.ts";
import { reasoning_head } from "./reasoning-head.ts";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import "./ReasoningRow.css";

type ReasoningRowProps = { step: ReasoningStep; live: boolean };

export const ReasoningRow = memo(({ step, live }: ReasoningRowProps) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const { label, meta, status, expandable, working } = reasoning_head(t, step, live);
  return (
    <div className="reasoning-row" data-open={expandable && open}>
      <button
        type="button"
        className="reasoning-head"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => {
          set_seen(true);
          set_open(!open);
        }}
      >
        {expandable && <ChevronRightIcon size={14} className="reasoning-chevron" />}
        <span key={status ?? ""} className={class_names("reasoning-label", status && "is-status")} title={status}>
          <span className={class_names("reasoning-label-text", working && "is-working")}><WorkingLetters text={label} active={working} /></span>
        </span>
        {meta && <span className="reasoning-meta">{meta}</span>}
      </button>
      {expandable && (
        <CollapsibleBody open={open}>
          <div className="reasoning-body">{seen && <Markdown text={step.text} className="reasoning-markdown" />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
});
