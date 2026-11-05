import type { PermissionMode, Step, TextStep, TurnError, TurnStatus } from "./chat.ts";
import type { ModelChoice } from "./models.ts";

export const schedule_intervals = ["1h", "2h", "24h", "7d"] as const;

export type ScheduleInterval = (typeof schedule_intervals)[number];

export const interval_ms: Record<ScheduleInterval, number> = { "1h": 3_600_000, "2h": 7_200_000, "24h": 86_400_000, "7d": 604_800_000 };

export const no_new_activity = "NO_NEW_ACTIVITY";

export const run_results = ["quiet", "new", "failed", "stopped"] as const;

export type RunResult = (typeof run_results)[number];

export type TaskRun = {
  message_id: string | null;
  started_at: string;
  ended_at: string | null;
  result: RunResult | null;
  error: string | null;
};

export type RunMark = { started_at: string; result: RunResult };

export const kept_run_marks = 12;

export type ScheduledTask = {
  id: string;
  chat_id: string;
  prompt: string;
  interval: ScheduleInterval;
  enabled: boolean;
  choice: ModelChoice;
  mode: PermissionMode;
  created_at: string;
  updated_at: string;
  next_run_at: string;
  last_run: TaskRun | null;
  runs: RunMark[];
};

export type ScheduledTaskView = ScheduledTask & { name: string; project_path: string; running: boolean };

export type ScheduledInput = {
  name: string;
  prompt: string;
  interval: ScheduleInterval;
  enabled: boolean;
  choice: ModelChoice;
  mode: PermissionMode;
  project_path: string;
};

export type ScheduledAction = "create" | "change" | "delete" | "enable" | "disable";

export type ScheduledCard = {
  name: string;
  prompt: string;
  interval: ScheduleInterval;
  enabled: boolean;
  mode: PermissionMode;
  model: string;
  effort: string;
  project_path: string;
};

export const is_running = (task: ScheduledTask): boolean => task.last_run !== null && task.last_run.result === null;

export const final_answer = (steps: readonly Step[]): string => {
  const round = steps.reduce((last, step) => Math.max(last, step.round), Number.NEGATIVE_INFINITY);
  const final = steps.filter((step) => step.round === round);
  if (final.some((step) => step.kind === "tool")) {
    return "";
  }
  return final
    .filter((step): step is TextStep => step.kind === "text")
    .map((step) => step.text)
    .join("")
    .trim();
};

export const is_quiet_answer = (text: string): boolean => {
  const trimmed = text.trim();
  const unquoted = trimmed.length >= 2 && trimmed.startsWith("`") && trimmed.endsWith("`") ? trimmed.slice(1, -1) : trimmed;
  return unquoted.trim() === no_new_activity;
};

export const quiet_answer_prefix = (text: string): boolean => {
  const trimmed = text.trim();
  const unquoted = trimmed.startsWith("`") ? trimmed.slice(1).replace(/`$/, "") : trimmed;
  return no_new_activity.startsWith(unquoted);
};

export const run_outcome = (status: TurnStatus, error: TurnError | null, steps: readonly Step[]): RunResult => {
  if (status === "done") {
    return is_quiet_answer(final_answer(steps)) ? "quiet" : "new";
  }
  if (status === "stopped" || (status === "interrupted" && error?.kind === "app_closed")) {
    return "stopped";
  }
  return "failed";
};

export const notifies = (result: RunResult, previous: RunResult | null): boolean => result === "new" || (result === "failed" && previous !== "failed");

export const silent_end = (result: RunResult, previous: RunResult | null): boolean => result !== "stopped" && !notifies(result, previous);

const fence_line = /^\s*(?:```|~~~)/;

const rule_line = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

const block_prefix = (line: string): string =>
  line
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "");

const inline_marks = (line: string): string =>
  line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|\W)_(?!\s)(.+?)_(?!\w)/g, "$1$2");

export const first_plain_line = (text: string): string => {
  for (const line of text.split(/\r?\n/)) {
    if (fence_line.test(line) || rule_line.test(line)) {
      continue;
    }
    const plain = inline_marks(block_prefix(line)).trim();
    if (plain) {
      return plain;
    }
  }
  return "";
};
