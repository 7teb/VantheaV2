import type { CSSProperties } from "react";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/translate.ts";
import { clock_label } from "./scheduled-time.ts";
import type { TrailMark, TrailResult } from "./task-state.ts";
import "./RunTrail.css";

export const result_keys: Record<TrailResult, MessageKey> = {
  quiet: "scheduled.no_new_activity",
  new: "scheduled.result_new",
  failed: "scheduled.result_failed",
  stopped: "scheduled.result_stopped",
  running: "scheduled.result_running",
};

export const RunTrail = ({ marks, now }: { marks: TrailMark[]; now: number }) => {
  const t = use_t();
  const language = use_language();
  const count = (result: TrailResult) => marks.filter((mark) => mark.result === result).length;
  const label = t("scheduled.trail_label", { n: marks.length, quiet: count("quiet"), fresh: count("new"), failed: count("failed") });
  return (
    <span className="run-trail" role="img" aria-label={label}>
      {marks.map((mark, index) => (
        <Tooltip key={mark.started_at} label={`${t(result_keys[mark.result])} · ${clock_label(mark.started_at, now, language)}`} placement="top-center">
          <span className="run-mark" data-result={mark.result} style={{ "--mark": index } as CSSProperties} />
        </Tooltip>
      ))}
    </span>
  );
};
