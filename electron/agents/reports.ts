import { report_file_notice, report_notice_context, report_notice_text, update_notice_text } from "../../shared/agent-notes.ts";
import type { AgentProfile, AgentRunStatus } from "../../shared/ipc/work.ts";
import { has_steers, is_active } from "../turn/active.ts";
import type { TurnNote } from "../turn/session.ts";
import { running_in_chat } from "./store.ts";

export type AgentReport = {
  chat_id: string;
  agent_id: string;
  run_id: string;
  name: string;
  profile: AgentProfile;
  model: string;
  status: AgentRunStatus;
  started_at: string;
  ended_at: string;
  report_path: string | null;
  report_error?: string;
};

export type AgentUpdate = { chat_id: string; agent_id: string; run_id: string; name: string; text: string };

type PendingNote = { kind: "report"; report: AgentReport } | { kind: "update"; update: AgentUpdate };

export const major_wait_ms = 30 * 60 * 1000;

const pending = new Map<string, PendingNote[]>();

const waiters = new Map<string, Set<() => void>>();

let continuation: ((report: AgentReport) => void) | null = null;

export const set_report_continuation = (fn: (report: AgentReport) => void): void => {
  continuation = fn;
};

export const report_seconds = (report: AgentReport): number => {
  const started = Date.parse(report.started_at);
  const ended = Date.parse(report.ended_at);
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};

export const wake_idle = (chat_id: string): void => {
  const set = waiters.get(chat_id);
  if (!set) {
    return;
  }
  waiters.delete(chat_id);
  for (const wake of set) {
    wake();
  }
};

const continue_with = (report: AgentReport) => {
  if (!continuation) {
    console.error(`[agents] report of run ${report.run_id} in chat ${report.chat_id} has no continuation path and was dropped`);
    return;
  }
  try {
    continuation(report);
  } catch (error) {
    console.error(`[agents] delivering the report of run ${report.run_id} to chat ${report.chat_id} failed:`, error);
  }
};

const set_pending = (chat_id: string, queue: PendingNote[]) => {
  if (queue.length) {
    pending.set(chat_id, queue);
  } else {
    pending.delete(chat_id);
  }
};

export const deliver_report = (report: AgentReport): void => {
  const superseded = (pending.get(report.chat_id) ?? []).filter((note) => note.kind !== "update" || note.update.run_id !== report.run_id);
  if (is_active(report.chat_id)) {
    set_pending(report.chat_id, [...superseded, { kind: "report", report }]);
  } else {
    set_pending(report.chat_id, superseded);
    continue_with(report);
  }
  wake_idle(report.chat_id);
};

export const deliver_update = (update: AgentUpdate): void => {
  set_pending(update.chat_id, [...(pending.get(update.chat_id) ?? []), { kind: "update", update }]);
  wake_idle(update.chat_id);
};

export const has_agent_notes = (chat_id: string): boolean => Boolean(pending.get(chat_id)?.length);

export const report_note_content = (text: string): string =>
  `[Internal app event, not a user message. One of your sub-agents finished. Its full report is saved in a file; read or search it when needed and use the findings to continue the work. This notification does not require an acknowledgment or a recap. If you are still waiting on other agents and it changes nothing the user needs to know now, process it silently and wait for more reports.]\n\n${report_notice_context(text)}`;

export const update_note_content = (text: string): string =>
  `[Internal app event, not a user message. One of your sub-agents is still running and sent you this update. Use it to avoid duplicating its work or to adjust your plan; do not redo what it says it covers. Routine updates need no visible reply, acknowledgment or fresh summary of the task. You may process several updates silently and wait for the remaining reports. Speak only if a new result, changed action, blocker or user decision makes an update useful. Its final report notification still arrives when it finishes.]\n\n${text}`;

const turn_note = (note: PendingNote): TurnNote => {
  if (note.kind === "update") {
    const text = update_notice_text(note.update.name, note.update.agent_id, note.update.text);
    return { kind: "notice", notice: "agent_update", text, content: update_note_content(text) };
  }
  const { report } = note;
  const text = report_notice_text(report.name, report.agent_id, report.status, report_seconds(report), report_file_notice(report.agent_id, report.run_id, report.report_path, report.report_error));
  return { kind: "notice", notice: "agent_report", text, content: report_note_content(text) };
};

export const take_agent_notes = (chat_id: string): TurnNote[] => {
  const queue = pending.get(chat_id);
  if (!queue) {
    return [];
  }
  pending.delete(chat_id);
  return queue.map(turn_note);
};

export const flush_reports = (chat_id: string): void => {
  const queue = pending.get(chat_id);
  if (!queue) {
    return;
  }
  set_pending(chat_id, queue.filter((note) => note.kind === "update"));
  for (const note of queue) {
    if (note.kind === "report") {
      continue_with(note.report);
    }
  }
};

export const drop_agent_notes = (chat_id: string): void => {
  pending.delete(chat_id);
  wake_idle(chat_id);
};

const next_wake = (chat_id: string, ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const set = waiters.get(chat_id) ?? new Set<() => void>();
    waiters.set(chat_id, set);
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      set.delete(done);
      if (!set.size && waiters.get(chat_id) === set) {
        waiters.delete(chat_id);
      }
      resolve();
    };
    const timer = setTimeout(done, ms);
    set.add(done);
    signal.addEventListener("abort", done, { once: true });
  });

const has_input = (chat_id: string) => has_agent_notes(chat_id) || has_steers(chat_id);

export const wait_for_input = async (chat_id: string, max_ms: number, signal: AbortSignal): Promise<boolean> => {
  const deadline = Date.now() + max_ms;
  while (!has_input(chat_id) && running_in_chat(chat_id) > 0 && !signal.aborted) {
    const left = deadline - Date.now();
    if (left <= 0) {
      break;
    }
    await next_wake(chat_id, left, signal);
  }
  return has_input(chat_id);
};
