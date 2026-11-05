import { permission_modes } from "../../shared/chat.ts";
import { kept_run_marks, run_results, schedule_intervals, type RunMark, type ScheduledTask, type TaskRun } from "../../shared/scheduled.ts";
import { parse_choice } from "../chats/files.ts";
import { as_array, as_boolean, as_iso, as_record, as_string, pick } from "../storage/coerce.ts";

export type ParsedTasks = { tasks: ScheduledTask[]; changed: boolean };

const result_of = (value: unknown) => run_results.find((entry) => entry === value) ?? null;

const parse_run = (value: unknown, now: string): { run: TaskRun | null; settled: boolean } => {
  if (value === null || value === undefined) {
    return { run: null, settled: false };
  }
  const raw = as_record(value);
  const started_at = as_iso(raw.started_at, now);
  const result = result_of(raw.result);
  const run: TaskRun = {
    message_id: typeof raw.message_id === "string" && raw.message_id ? raw.message_id : null,
    started_at,
    ended_at: typeof raw.ended_at === "string" ? as_iso(raw.ended_at, now) : null,
    result,
    error: typeof raw.error === "string" ? raw.error : null,
  };
  return result === null ? { run: { ...run, result: "stopped", ended_at: now }, settled: true } : { run, settled: false };
};

const parse_marks = (value: unknown, now: string): RunMark[] =>
  as_array(value)
    .flatMap((entry): RunMark[] => {
      const raw = as_record(entry);
      const result = result_of(raw.result);
      return result ? [{ started_at: as_iso(raw.started_at, now), result }] : [];
    })
    .slice(-kept_run_marks);

const dropped = (id: string, reason: string): null => {
  console.error(`[scheduled] dropping the stored task ${id || "(no id)"}: ${reason}`);
  return null;
};

const parse_task = (value: unknown, now: string, known_chat: (chat_id: string) => boolean): { task: ScheduledTask; settled: boolean } | null => {
  const raw = as_record(value);
  const id = as_string(raw.id);
  const chat_id = as_string(raw.chat_id);
  const prompt = as_string(raw.prompt);
  if (!id || !chat_id || !prompt.trim()) {
    return dropped(id, "id, chat id or prompt is missing");
  }
  if (!known_chat(chat_id)) {
    return dropped(id, `its chat ${chat_id} is not in the chat index`);
  }
  const interval = schedule_intervals.find((entry) => entry === raw.interval);
  if (!interval) {
    return dropped(id, `the schedule ${String(raw.interval)} is not one of ${schedule_intervals.join(", ")}`);
  }
  const choice = parse_choice(raw.choice);
  if (!choice) {
    return dropped(id, "it has no model");
  }
  const created_at = as_iso(raw.created_at, now);
  const { run, settled } = parse_run(raw.last_run, now);
  const marks = parse_marks(raw.runs, now);
  const settled_mark: RunMark[] = settled && run ? [{ started_at: run.started_at, result: "stopped" }] : [];
  return {
    task: {
      id,
      chat_id,
      prompt,
      interval,
      enabled: as_boolean(raw.enabled, false),
      choice,
      mode: pick(raw.mode, permission_modes, "ask"),
      created_at,
      updated_at: as_iso(raw.updated_at, created_at),
      next_run_at: as_iso(raw.next_run_at, now),
      last_run: run,
      runs: [...marks, ...settled_mark].slice(-kept_run_marks),
    },
    settled,
  };
};

export const parse_stored_file = (value: unknown, now: string, known_chat: (chat_id: string) => boolean): ParsedTasks => {
  const raw = as_array(as_record(value).tasks);
  const parsed = raw.map((entry) => parse_task(entry, now, known_chat));
  const kept = parsed.filter((entry) => entry !== null);
  const tasks: ScheduledTask[] = [];
  for (const { task } of kept) {
    if (tasks.some((entry) => entry.id === task.id)) {
      dropped(task.id, "another stored task has the same id");
      continue;
    }
    if (tasks.some((entry) => entry.chat_id === task.chat_id)) {
      dropped(task.id, `its chat ${task.chat_id} already belongs to another stored task`);
      continue;
    }
    tasks.push(task);
  }
  return { tasks, changed: kept.length !== raw.length || tasks.length !== kept.length || kept.some((entry) => entry.settled) };
};

export const stored_file = (tasks: Iterable<ScheduledTask>) => ({ version: 1, tasks: [...tasks] });
