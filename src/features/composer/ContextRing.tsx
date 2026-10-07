import { useState } from "react";
import type { ContextUsage } from "../../../shared/chat.ts";
import type { CompactResult } from "../../../shared/ipc/chats.ts";
import { Button } from "../../components/Button.tsx";
import { Popover } from "../../components/Popover.tsx";
import { use_t, type MessageKey } from "../../i18n/index.ts";
import { compact_chat_now } from "../../state/chat-view.ts";
import "./ContextRing.css";

const radius = 7;
const circumference = 2 * Math.PI * radius;

const compact_tokens = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
};

const result_keys: Record<CompactResult["status"], MessageKey> = {
  done: "context.compact_done",
  nothing: "context.compact_nothing",
  busy: "context.compact_busy",
  failed: "context.compaction_failed",
};

type ContextRingProps = { usage: ContextUsage; chat_id: string; busy: boolean };

export const ContextRing = ({ usage, chat_id, busy }: ContextRingProps) => {
  const t = use_t();
  const [anchor, set_anchor] = useState<HTMLButtonElement | null>(null);
  const [open, set_open] = useState(false);
  const [running, set_running] = useState(false);
  const [result, set_result] = useState<CompactResult["status"] | null>(null);
  const ratio = usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 0;
  const percent = Math.round(ratio * 100);
  const label = t("composer.context_usage", { used: compact_tokens(usage.used), limit: compact_tokens(usage.limit), percent });

  const compact = async () => {
    set_running(true);
    set_result(null);
    set_result(await compact_chat_now(chat_id));
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
      <Popover open={open} anchor={anchor} label={t("context.title")} on_close={() => set_open(false)} placement="top-end" className="context-popover">
        <div className="context-popover-title">{t("context.title")}</div>
        <div className="context-popover-usage">{label}</div>
        <div className="context-popover-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} data-level={ratio >= 0.9 ? "high" : "normal"} />
        </div>
        <p className="context-popover-note">{t("context.auto_note")}</p>
        {result && (
          <p className="context-popover-result" data-status={result}>
            {t(result_keys[result])}
          </p>
        )}
        <Button className={running ? "is-working" : undefined} disabled={busy || running} onClick={() => void compact()}>
          {running ? t("context.compressing") : t("context.compact_now")}
        </Button>
      </Popover>
    </>
  );
};
