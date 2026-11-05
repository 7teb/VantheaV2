import type { AssistantMessage } from "../../shared/chat.ts";
import { final_answer, kept_run_marks, run_outcome, silent_end, type RunResult, type ScheduledTask, type TaskRun } from "../../shared/scheduled.ts";
import { chat_meta, get_chat, unarchive_chat, update_meta } from "../chats/store.ts";
import { error_text } from "../storage/coerce.ts";
import { launch_internal_turn, type Launched } from "../turn/run.ts";
import type { TurnNote } from "../turn/session.ts";
import { answered_runs, run_note } from "./note.ts";
import { patch_task, scheduled_task, task_of_chat } from "./store.ts";
import { notify_failed, notify_new, notify_waiting, type ToastTarget } from "./toast.ts";

export type RunKind = "schedule" | "manual";

const waiting = new Map<string, Set<string>>();

const target_of = (task: ScheduledTask): ToastTarget => {
  const meta = chat_meta(task.chat_id);
  return { task_id: task.id, chat_id: task.chat_id, name: meta?.title ?? "", project_path: meta?.project_path ?? "" };
};

export const notify_run_waiting = (chat_id: string, approval_key: string): void => {
  const task = task_of_chat(chat_id);
  const seen = task ? waiting.get(task.id) : undefined;
  if (!task || !seen || seen.has(approval_key)) {
    return;
  }
  seen.add(approval_key);
  notify_waiting(target_of(task));
};

const record_end = (task_id: string, run: TaskRun, result: RunResult, expected: TaskRun | null): ScheduledTask | null =>
  patch_task(task_id, (task) => ({ ...task, last_run: task.last_run === expected ? run : task.last_run, runs: [...task.runs, { started_at: run.started_at, result }].slice(-kept_run_marks) }));

const touch_chat = (chat_id: string) =>
  Promise.all([unarchive_chat(chat_id), update_meta(chat_id, { updated_at: new Date().toISOString() })]).catch((error: unknown) =>
    console.error(`[scheduled] moving task chat ${chat_id} up after a run failed: ${error_text(error)}`),
  );

const start_failed = (task: ScheduledTask, previous: RunResult | null, started_at: string, error: unknown) => {
  const message = error_text(error);
  console.error(`[scheduled] the run of task ${task.id} did not start: ${message}`);
  const stored = record_end(task.id, { message_id: null, started_at, ended_at: new Date().toISOString(), result: "failed", error: message }, "failed", task.last_run);
  if (stored && previous !== "failed") {
    notify_failed(target_of(stored), message);
  }
};

const run_error = (answer: AssistantMessage | null, result: RunResult, message_id: string): string | null => {
  if (!answer) {
    return `the run's message ${message_id} is no longer in the task chat`;
  }
  if (answer.error) {
    return answer.error.message;
  }
  return result === "failed" ? `the run ended with status ${answer.status}` : null;
};

const finish = async (task_id: string, chat_id: string, message_id: string, started_at: string, expected: TaskRun) => {
  const message = (await get_chat(chat_id))?.messages.find((entry) => entry.id === message_id);
  if (!scheduled_task(task_id)) {
    return;
  }
  const answer = message?.role === "assistant" ? message : null;
  const result = answer ? run_outcome(answer.status, answer.error, answer.steps) : "failed";
  const error = run_error(answer, result, message_id);
  const stored = record_end(task_id, { message_id, started_at, ended_at: new Date().toISOString(), result, error }, result, expected);
  if (!stored || answer?.quiet) {
    return;
  }
  if (result === "new" && answer) {
    notify_new(target_of(stored), final_answer(answer.steps));
    await touch_chat(chat_id);
  }
  if (result === "failed") {
    notify_failed(target_of(stored), error ?? "");
    await touch_chat(chat_id);
  }
};

export type RunStart = { settled: Promise<void> };

export const start_task_run = async (task_id: string, kind: RunKind): Promise<RunStart | null> => {
  const task = scheduled_task(task_id);
  if (!task) {
    throw new Error(`scheduled task ${task_id} not found`);
  }
  const previous = task.last_run?.result ?? null;
  const started = new Date();
  const started_at = started.toISOString();
  let launched: Launched | null;
  try {
    const chat = await get_chat(task.chat_id);
    if (!chat) {
      throw new Error(`the task chat ${task.chat_id} is not available`);
    }
    const earlier_runs = answered_runs(chat.messages) > 0;
    launched = await launch_internal_turn(task.chat_id, "scheduled", task.prompt, {
      choice: task.choice,
      mode: task.mode,
      keep_order: true,
      notes: (tool_names): TurnNote[] => {
        const text = run_note({ name: chat.title, interval: task.interval, started_at: started, earlier_runs, tool_names });
        return [{ kind: "notice", notice: "scheduled_run", text, content: text }];
      },
      quiet_end: (message, end) => scheduled_task(task.id) !== null && silent_end(run_outcome(end.status, end.error, message.steps), previous),
      watch: (body) => {
        if (body.type === "tool_approval") {
          notify_run_waiting(task.chat_id, `main:${body.call_id}`);
        }
      },
    });
  } catch (error) {
    start_failed(task, previous, started_at, error);
    return null;
  }
  if (!launched) {
    if (kind === "manual") {
      throw new Error("the task chat has a turn running");
    }
    console.info(`[scheduled] skipped the due run of task ${task.id}, a turn in its chat is still running`);
    return null;
  }
  const { message_id } = launched.started;
  const seen = new Set<string>();
  const active: TaskRun = { message_id, started_at, ended_at: null, result: null, error: null };
  waiting.set(task.id, seen);
  patch_task(task.id, (current) => ({ ...current, last_run: active }));
  const settled = launched.finished
    .then(() => finish(task.id, task.chat_id, message_id, started_at, active))
    .catch((error: unknown) => console.error(`[scheduled] recording the end of the run of task ${task.id} failed: ${error_text(error)}`))
    .finally(() => {
      if (waiting.get(task.id) === seen) {
        waiting.delete(task.id);
      }
    });
  return { settled };
};

export const run_scheduled_task = (task_id: string): void => {
  start_task_run(task_id, "schedule").catch((error: unknown) => console.error(`[scheduled] the scheduled run of task ${task_id} failed: ${error_text(error)}`));
};
