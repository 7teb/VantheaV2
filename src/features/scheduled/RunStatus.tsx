import type { ReactNode } from "react";
import type { ScheduledTaskView } from "../../../shared/scheduled.ts";
import { class_names } from "../../components/class-names.ts";
import { ChevronRightIcon, CircleAlertIcon } from "../../components/icons.tsx";
import { LabelMorph } from "../../components/LabelMorph.tsx";
import { use_clock } from "../../components/use-clock.ts";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import type { Translate } from "../../i18n/translate.ts";
import { format_duration } from "../tools/tool-summary.ts";
import { clock_label } from "./scheduled-time.ts";
import type { StatusKind } from "./task-state.ts";

type Shown = { tone: string; mark: ReactNode; label: ReactNode; timed: boolean };

const shown_status = (t: Translate, kind: StatusKind, unread: boolean): Shown => {
  switch (kind) {
    case "running":
      return {
        tone: "",
        mark: null,
        label: (
          <span className="is-working">
            <WorkingLetters text={t("scheduled.result_running")} />
          </span>
        ),
        timed: true,
      };
    case "waiting":
      return { tone: "is-waiting", mark: <span className="wait-dot" />, label: t("scheduled.result_waiting"), timed: false };
    case "new":
      return { tone: unread ? "is-new" : "is-new-read", mark: unread ? <span className="scheduled-status-unread" /> : null, label: t("scheduled.result_new"), timed: true };
    case "quiet":
      return { tone: "", mark: null, label: t("scheduled.no_new_activity"), timed: true };
    case "failed":
      return { tone: "is-failed", mark: <CircleAlertIcon />, label: t("scheduled.result_failed"), timed: true };
    case "stopped":
      return { tone: "", mark: null, label: t("scheduled.result_stopped"), timed: true };
    case "never":
      return { tone: "", mark: null, label: t("scheduled.result_never"), timed: false };
  }
};

const Elapsed = ({ started_at }: { started_at: string }) => {
  const now = use_clock(true);
  return <span className="scheduled-status-time">{format_duration(now - Date.parse(started_at))}</span>;
};

type StatusProps = {
  task: ScheduledTaskView;
  kind: StatusKind;
  unread: boolean;
  now: number;
  error_id: string | null;
  error_open: boolean;
  on_error_toggle: () => void;
};

export const RunStatus = ({ task, kind, unread, now, error_id, error_open, on_error_toggle }: StatusProps) => {
  const t = use_t();
  const language = use_language();
  const shown = shown_status(t, kind, unread);
  const run = task.last_run;
  const time = () => {
    if (!run || !shown.timed) {
      return null;
    }
    if (kind === "running") {
      return <Elapsed started_at={run.started_at} />;
    }
    return <span className="scheduled-status-time">{clock_label(run.ended_at ?? run.started_at, now, language)}</span>;
  };
  const content = (
    <>
      {shown.mark}
      <LabelMorph morph_key={kind}>
        <span>{shown.label}</span>
      </LabelMorph>
      {time()}
      {error_id !== null && <ChevronRightIcon className="scheduled-status-chevron" />}
    </>
  );
  if (error_id !== null) {
    return (
      <button type="button" className={class_names("scheduled-status", shown.tone, "is-toggle")} aria-expanded={error_open} aria-controls={error_id} onClick={on_error_toggle}>
        {content}
      </button>
    );
  }
  return (
    <span className={class_names("scheduled-status", shown.tone)} role="status">
      {content}
    </span>
  );
};
