import type { ScheduledCard, ScheduledTaskView } from "../../../shared/scheduled.ts";
import { CalendarClockIcon } from "../../components/icons.tsx";
import { use_language, use_t } from "../../i18n/index.ts";
import { clock_label } from "../scheduled/scheduled-time.ts";
import type { BodyProps } from "./body-types.ts";
import { ScheduledPreview } from "./ScheduledApproval.tsx";
import "./scheduled-approval.css";

const card_of = (task: ScheduledTaskView): ScheduledCard => ({
  name: task.name,
  prompt: task.prompt,
  interval: task.interval,
  enabled: task.enabled,
  mode: task.mode,
  model: task.choice.model,
  effort: task.choice.effort,
  project_path: task.project_path,
});

const TaskList = ({ tasks }: { tasks: ScheduledTaskView[] }) => {
  const t = use_t();
  const language = use_language();
  const now = Date.now();
  return (
    <ul className="tool-body-list tool-card scheduled-tool-list">
      {tasks.map((task) => (
        <li key={task.id} className="scheduled-tool-item" data-enabled={task.enabled}>
          <CalendarClockIcon className="scheduled-tool-icon" />
          <span className="scheduled-tool-name">{task.name}</span>
          <span className="scheduled-tool-every">{t(`scheduled.every_${task.interval}`)}</span>
          <span className="scheduled-tool-next">{task.enabled ? t("scheduled.next_run", { time: clock_label(task.next_run_at, now, language) }) : t("scheduled.paused")}</span>
        </li>
      ))}
    </ul>
  );
};

export const ScheduledBody = ({ view }: BodyProps<"scheduled_tasks">) => {
  const first = view.tasks[0];
  if (view.action === "list" || !first) {
    return <TaskList tasks={view.tasks} />;
  }
  return <ScheduledPreview task={card_of(first)} previous={view.previous} />;
};
