import { useState, type ReactNode } from "react";
import type { ContextUsage } from "../../shared/chat.ts";
import type { CompactResult } from "../../shared/ipc/chats.ts";
import { Button } from "./Button.tsx";
import type { Placement } from "./placement.ts";
import { Popover } from "./Popover.tsx";
import { use_t, type MessageKey } from "../i18n/index.ts";
import "./ContextRing.css";

const radius = 7;
const circumference = 2 * Math.PI * radius;

export const compact_tokens = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
};

const result_keys: Record<CompactResult["status"], MessageKey> = {
  done: "context.compacted_manual",
  nothing: "context.compact_nothing",
  busy: "context.compact_busy",
  failed: "context.compaction_failed",
};

export type ContextCompact = { run: () => Promise<CompactResult["status"]>; busy: boolean };

type ContextRingProps = { usage: ContextUsage; compact?: ContextCompact; mark?: number; placement?: Placement; children?: ReactNode };

export const ContextRing = ({ usage, compact, mark, placement = "top-end", children }: ContextRingProps) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const [running, set_running] = useState(false);
  const [result, set_result] = useState<CompactResult["status"] | null>(null);
  const ratio = usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;
  const percent = Math.round(ratio * 100);
  const label = t("composer.context_usage", { used: compact_tokens(usage.used), limit: compact_tokens(usage.limit), percent });

  const run_compact = async (action: ContextCompact) => {
    set_running(true);
    set_result(null);
    set_result(await action.run());
    set_running(false);
  };

  return (
    <>
      <button
        ref={set_anchor}
        type="button"
        className="context-ring"
        aria-label={label}
        aria-expanded={open}
        data-level={ratio >= 0.9 ? "high" : "normal"}
        onClick={() => {
          set_result(null);
          set_open((value) => !value);
        }}
      >
        <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
          <circle className="context-ring-track" cx="9" cy="9" r={radius} />
          <circle
            className="context-ring-value"
            cx="9"
            cy="9"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            transform="rotate(-90 9 9)"
          />
        </svg>
      </button>
      <Popover open={open} anchor={anchor} label={t("context.title")} on_close={() => set_open(false)} placement={placement} className="context-popover">
        <div className="context-popover-title">{t("context.title")}</div>
        <div className="context-popover-usage">{label}</div>
        <div className="context-popover-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} data-level={ratio >= 0.9 ? "high" : "normal"} />
          {mark !== undefined && <i className="context-popover-mark" style={{ left: `${mark * 100}%` }} title={t("context.compact_mark")} />}
        </div>
        {children}
        {result && (
          <p className="context-popover-result" data-status={result}>
            {t(result_keys[result])}
          </p>
        )}
        {compact && (
          <Button className={running ? "is-working" : undefined} disabled={compact.busy || running} onClick={() => void run_compact(compact)}>
            {running ? t("context.compacting") : t("context.compact_now")}
          </Button>
        )}
      </Popover>
    </>
  );
};
