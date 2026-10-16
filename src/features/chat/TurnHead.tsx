import { useState, type MouseEvent } from "react";
import { ChevronRightIcon } from "../../components/icons.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { use_t } from "../../i18n/index.ts";
import { set_turn_folded } from "../../state/turn-folds.ts";
import { format_seconds } from "../tools/tool-summary.ts";
import type { HeadState } from "./turn-shape.ts";
import { keep_in_view } from "./use-follow-bottom.ts";
import "./TurnHead.css";

const whole_seconds = (ms: number) => format_seconds(Math.floor(ms / 1000));

export const use_turn_head = (head: HeadState | null, streaming: boolean, holding: boolean): HeadState | null => {
  const [working, set_working] = useState(false);
  if (streaming && head !== null && !working) {
    set_working(true);
  }
  if (holding && (head === null || head.kind === "worked")) {
    return { kind: "working" };
  }
  return head ?? (streaming && working ? { kind: "working" } : null);
};

const Working = ({ started_at }: { started_at: number }) => {
  const t = use_t();
  const elapsed = use_clock(true) - started_at;
  return <span className="turn-head-label">{elapsed < 1000 ? t("chat.turn_working") : t("chat.turn_working_for", { time: whole_seconds(elapsed) })}</span>;
};

const Label = ({ head, created_at }: { head: HeadState; created_at: string }) => {
  const t = use_t();
  switch (head.kind) {
    case "working":
      return <Working started_at={Date.parse(created_at)} />;
    case "worked":
      return <span className="turn-head-label">{t("chat.turn_worked_for", { time: whole_seconds(head.ms) })}</span>;
    case "stopped":
      return <span className="turn-head-label">{t("chat.turn_stopped_after", { time: whole_seconds(head.ms) })}</span>;
    case "activity":
      return <span className="turn-head-label">{t("chat.turn_activity")}</span>;
  }
};

type TurnHeadProps = { chat_id: string; message_id: string; created_at: string; head: HeadState; foldable: boolean; folded: boolean };

export const TurnHead = ({ chat_id, message_id, created_at, head, foldable, folded }: TurnHeadProps) => {
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    keep_in_view(event.currentTarget, "always");
    set_turn_folded(chat_id, message_id, !folded);
  };
  return (
    <div className="turn-head">
      {foldable ? (
        <button type="button" className="turn-toggle" aria-expanded={!folded} onClick={toggle}>
          <Label head={head} created_at={created_at} />
          <ChevronRightIcon size={12} className="turn-toggle-chevron" />
        </button>
      ) : (
        <Label head={head} created_at={created_at} />
      )}
      <div className="turn-head-rule" />
    </div>
  );
};
