import { memo, useState } from "react";
import type { ReasoningStep } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon } from "../../components/icons.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { use_t, type Translate } from "../../i18n/index.ts";
import { format_duration } from "../tools/tool-summary.ts";

type ReasoningRowProps = { step: ReasoningStep; live: boolean };

const reasoning_label = (t: Translate, step: ReasoningStep, thinking: boolean) => {
  if (thinking) {
    return t("chat.thinking");
  }
  if (step.ended_at === null) {
    return t("chat.thought");
  }
  return t("chat.thought_for", { time: format_duration(step.ended_at - step.started_at) });
};

export const ReasoningRow = memo(({ step, live }: ReasoningRowProps) => {
  const t = use_t();
  const [open, set_open] = useState(false);
  const [seen, set_seen] = useState(false);
  const thinking = live && step.ended_at === null;
  const has_text = step.text.trim().length > 0;
  const label = reasoning_label(t, step, thinking);
  return (
    <div className="reasoning-row" data-open={has_text && open}>
      <button
        type="button"
        className="reasoning-head"
        disabled={!has_text}
        aria-expanded={has_text ? open : undefined}
        onClick={() => {
          set_seen(true);
          set_open(!open);
        }}
      >
        <ChevronRightIcon size={14} className="reasoning-chevron" />
        <span className={class_names(thinking && "is-working")}>{label}</span>
      </button>
      {has_text && (
        <CollapsibleBody open={open}>
          <div className="reasoning-body">{seen && <Markdown text={step.text} className="reasoning-markdown" />}</div>
        </CollapsibleBody>
      )}
    </div>
  );
});
