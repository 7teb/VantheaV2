import type { BackgroundStatus, BackgroundTask } from "../../shared/ipc/work.ts";
import { shell_kinds } from "../../shared/shell.ts";
import { result_cap_tokens } from "../context/estimate.ts";
import { output_collector, type OutputCollector } from "../shell/output.ts";
import { as_array, as_iso, as_number, as_record, as_string, pick } from "../storage/coerce.ts";

export type TaskRecord = Omit<BackgroundTask, "output_tail"> & { project_root: string; turn_id: string; pid: number | null; output: OutputCollector };

const max_stored_tasks = 200;

const statuses: readonly BackgroundStatus[] = ["running", "completed", "failed", "cancelled", "interrupted"];

export const public_task = (record: TaskRecord): BackgroundTask => ({
  id: record.id,
  chat_id: record.chat_id,
  name: record.name,
  command: record.command,
  shell: record.shell,
  cwd: record.cwd,
  status: record.status,
  exit_code: record.exit_code,
  started_at: record.started_at,
  ended_at: record.ended_at,
  output_tail: record.output.text(result_cap_tokens),
});

const newest_first = (a: TaskRecord, b: TaskRecord) => b.started_at.localeCompare(a.started_at);

export const listing_order = (a: TaskRecord, b: TaskRecord) =>
  Number(b.status === "running") - Number(a.status === "running") || newest_first(a, b);

export const stored_file = (records: Iterable<TaskRecord>) => ({
  version: 1,
  tasks: [...records]
    .sort(newest_first)
    .slice(0, max_stored_tasks)
    .map(({ output, pid, ...stored }) => ({ ...stored, output: output.pieces() })),
});

const legacy_tail_chars = 8_000;

const legacy_note = `[Stored by an older VantheaX version that kept only the last ${legacy_tail_chars} characters of the output; everything before them is lost.]`;

const stored_output = (raw: Record<string, unknown>): OutputCollector => {
  const output = as_record(raw.output);
  if (typeof output.head === "string") {
    return output_collector({ head: output.head, tail: as_string(output.tail), chars: as_number(output.chars, 0) });
  }
  const legacy = as_string(raw.output_tail);
  const collector = output_collector();
  collector.append(legacy.length >= legacy_tail_chars ? `${legacy_note}\n${legacy}` : legacy);
  return collector;
};

const parse_record = (value: unknown, now: string): TaskRecord | null => {
  const raw = as_record(value);
  const id = as_string(raw.id);
  const chat_id = as_string(raw.chat_id);
  if (!id || !chat_id) {
    return null;
  }
  const status = pick(raw.status, statuses, "interrupted");
  const exit_code = as_number(raw.exit_code, Number.NaN);
  const ended_at = typeof raw.ended_at === "string" ? as_iso(raw.ended_at, now) : null;
  return {
    id,
    chat_id,
    name: as_string(raw.name, "Background task"),
    command: as_string(raw.command),
    shell: pick(raw.shell, shell_kinds, "powershell"),
    cwd: as_string(raw.cwd, "."),
    status: status === "running" ? "interrupted" : status,
    exit_code: Number.isInteger(exit_code) ? exit_code : null,
    started_at: as_iso(raw.started_at, now),
    ended_at: status === "running" ? now : ended_at,
    project_root: as_string(raw.project_root),
    turn_id: as_string(raw.turn_id),
    pid: null,
    output: stored_output(raw),
  };
};

export const parse_stored_file = (value: unknown, now: string): { records: TaskRecord[]; interrupted: number } => {
  const entries = as_array(as_record(value).tasks);
  const records = entries.map((entry) => parse_record(entry, now)).filter((record): record is TaskRecord => record !== null);
  const interrupted = entries.filter((entry) => as_record(entry).status === "running").length;
  return { records: records.slice(0, max_stored_tasks), interrupted };
};
