import { background_event_labels, background_event_marker } from "../../shared/background-notes.ts";
import type { BackgroundTask } from "../../shared/ipc/work.ts";
import { shell_labels } from "../../shared/shell.ts";
import { result_cap_tokens } from "../context/estimate.ts";
import type { OutputView } from "../shell/output.ts";

const output_cap = 6000;

const duration_seconds = (task: BackgroundTask) => {
  const started = Date.parse(task.started_at);
  const ended = task.ended_at ? Date.parse(task.ended_at) : Date.now();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};

const output_text = (output: OutputView): string => {
  const shown = output.tail(output_cap).trim();
  if (!shown) {
    return `${background_event_labels.output}: empty`;
  }
  const before = output.chars() - output_cap;
  if (before <= 0) {
    return `${background_event_labels.output}:\n${shown}`;
  }
  return `${background_event_labels.output}, the last ${output_cap} characters (the ${before} characters before them are omitted here; get_background_task returns the output with its start and end up to the ${result_cap_tokens}-token cap per tool result):\n${shown}`;
};

export const background_event_text = (task: BackgroundTask, output: OutputView): string =>
  [
    background_event_marker,
    "This is an internal app event, not a message written by the user. A long-running task you started earlier in this chat has finished.",
    `ID: ${task.id}`,
    `Name: ${task.name}`,
    `${background_event_labels.shell}: ${shell_labels[task.shell]}`,
    `${background_event_labels.command}: ${task.command}`,
    `${background_event_labels.status}: ${task.status}`,
    `${background_event_labels.exit_code}: ${task.exit_code ?? "none"}`,
    `Duration: ${duration_seconds(task)}s`,
    output_text(output),
    "Use this as new evidence and continue the original work if it is still relevant. Do not say the user sent this event. If nothing is left to do, reply briefly.",
  ].join("\n\n");
