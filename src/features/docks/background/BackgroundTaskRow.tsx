import { useLayoutEffect, useRef } from "react";
import type { BackgroundStatus, BackgroundTask } from "../../../../shared/ipc/work.ts";
import { shell_labels } from "../../../../shared/shell.ts";
import { IconButton } from "../../../components/Button.tsx";
import { Collapsible } from "../../../components/Collapsible.tsx";
import { CircleAlertIcon, CircleCheckIcon, CircleSlashIcon, CircleStopIcon, CircleSpinnerIcon, type IconComponent } from "../../../components/icons.tsx";
import { use_t } from "../../../i18n/index.ts";
import { cancel_background_task } from "../../../state/background.ts";
import { background_status_keys } from "../../tools/background-status.ts";
import { format_duration } from "../../tools/tool-summary.ts";

const status_icons: Record<BackgroundStatus, IconComponent> = {
  running: CircleSpinnerIcon,
  completed: CircleCheckIcon,
  failed: CircleAlertIcon,
  cancelled: CircleSlashIcon,
  interrupted: CircleAlertIcon,
};

const OutputTail = ({ text }: { text: string }) => {
  const element = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [text]);
  return (
    <pre ref={element} className="bg-task-output inset-surface">
      {text}
    </pre>
  );
};

type BackgroundTaskRowProps = { task: BackgroundTask; now: number };

export const BackgroundTaskRow = ({ task, now }: BackgroundTaskRowProps) => {
  const t = use_t();
  const StatusIcon = status_icons[task.status];
  const running = task.status === "running";
  const end = task.ended_at ? Date.parse(task.ended_at) : now;
  const meta = [shell_labels[task.shell], t(background_status_keys[task.status]), format_duration(end - Date.parse(task.started_at))];
  if (task.exit_code !== null) {
    meta.push(t("background.exit_code", { code: task.exit_code }));
  }

  return (
    <article className="bg-task" data-status={task.status}>
      <div className="bg-task-head">
        <StatusIcon size={15} className={running ? "bg-task-icon spin" : "bg-task-icon"} />
        <code className="bg-task-command" title={task.command}>
          {task.command}
        </code>
        {running && (
          <IconButton size="sm" label={t("background.cancel")} onClick={() => void cancel_background_task(task.id)}>
            <CircleStopIcon size={15} />
          </IconButton>
        )}
      </div>
      <div className="bg-task-meta">{meta.join(" · ")}</div>
      {task.output_tail && (
        <Collapsible className="bg-task-details" header={t("background.output")} default_open={running}>
          <OutputTail text={task.output_tail} />
        </Collapsible>
      )}
    </article>
  );
};
