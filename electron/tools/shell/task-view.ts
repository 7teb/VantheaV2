import type { BackgroundTask } from "../../../shared/ipc/work.ts";
import { shell_labels } from "../../../shared/shell.ts";
import type { ToolView } from "../../../shared/tool-view.ts";

export const task_name = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 120);

export const background_view = (task: Pick<BackgroundTask, "id" | "command" | "status" | "shell">, output: string): ToolView => ({
  kind: "background",
  shell: shell_labels[task.shell],
  task_id: task.id,
  command: task.command,
  status: task.status,
  output_tail: output,
});
