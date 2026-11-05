import type { ReactNode } from "react";
import type { ScheduledTaskView } from "../../../shared/scheduled.ts";
import { DotSpinner } from "../../components/DotSpinner.tsx";
import { PauseIcon } from "../../components/icons.tsx";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { ProgressRing } from "../../components/ProgressRing.tsx";
import { Tooltip } from "../../components/Tooltip.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import { clock_label, dial_ratio, dial_text } from "./scheduled-time.ts";
import type { DialState } from "./task-state.ts";
import "./ScheduleDial.css";

type DialProps = { task: ScheduledTaskView; state: DialState; now: number };

const dial_label = (t: Translate, task: ScheduledTaskView, state: DialState, now: number, language: string): string => {
  switch (state) {
    case "running":
      return t("scheduled.result_running");
    case "waiting":
      return t("scheduled.result_waiting");
    case "off":
      return t("scheduled.paused");
    case "idle":
      return t("scheduled.next_run", { time: clock_label(task.next_run_at, now, language) });
  }
};

const dial_centre = (t: Translate, task: ScheduledTaskView, state: DialState, now: number): ReactNode => {
  switch (state) {
    case "running":
      return <DotSpinner />;
    case "waiting":
      return <span className="wait-dot" />;
    case "off":
      return <PauseIcon />;
    case "idle":
      return <span className="schedule-dial-text">{dial_text(t, Date.parse(task.next_run_at) - now)}</span>;
  }
};

export const ScheduleDial = ({ task, state, now }: DialProps) => {
  const t = use_t();
  const language = use_language();
  const label = dial_label(t, task, state, now, language);
  return (
    <Tooltip label={label}>
      <span className="schedule-dial" role="img" aria-label={label} data-state={state}>
        <ProgressRing ratio={state === "idle" ? dial_ratio(task, now) : 0} size={40} />
        <LabelMorph morph_key={state}>
          <span className="schedule-dial-centre">{dial_centre(t, task, state, now)}</span>
        </LabelMorph>
      </span>
    </Tooltip>
  );
};
