import { report_file_notice, report_notice_context, report_notice_text, update_notice_text } from "../../shared/agent-notes.ts";
import type { AgentRunStatus } from "../../shared/ipc/work.ts";
import { peer_alert_intro, peer_alert_text, type PeerAlertCause } from "../../shared/peer-notes.ts";
import { has_steers, is_active, user_stopped } from "../turn/active.ts";
import type { TurnNote } from "../turn/session.ts";
import { running_in_chat } from "./store.ts";

export type AgentReport = {
  chat_id: string;
  agent_id: string;
  run_id: string;
  name: string;
  profile: string;
  model: string;
  status: AgentRunStatus;
  started_at: string;
  ended_at: string;
  report_path: string | null;
  report_error?: string;
  stop_reason: string;
};

export type AgentUpdate = { chat_id: string; agent_id: string; run_id: string; name: string; text: string };

export type AgentAlert = { chat_id: string; agent_id: string; run_id: string; name: string; cause: PeerAlertCause; body: string };

export type AgentNotice = { kind: "report"; report: AgentReport } | { kind: "update"; update: AgentUpdate } | { kind: "alert"; alert: AgentAlert };

export const major_wait_ms = 30 * 60 * 1000;

const pending = new Map<string, AgentNotice[]>();

const digests = new Map<string, string[]>();

const waiters = new Map<string, Set<() => void>>();

let continuation: ((notice: AgentNotice) => void) | null = null;

export const set_agent_continuation = (fn: (notice: AgentNotice) => void): void => {
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

const notice_source = (notice: AgentNotice): { chat_id: string; run_id: string } => {
  switch (notice.kind) {
    case "report":
      return notice.report;
    case "update":
      return notice.update;
    case "alert":
      return notice.alert;
  }
};

const continue_with = (notice: AgentNotice) => {
  const { chat_id, run_id } = notice_source(notice);
  if (!continuation) {
    console.error(`[agents] ${notice.kind} of run ${run_id} in chat ${chat_id} has no continuation path and was dropped`);
    return;
  }
  try {
    continuation(notice);
  } catch (error) {
    console.error(`[agents] delivering the ${notice.kind} of run ${run_id} to chat ${chat_id} failed:`, error);
  }
};

const set_pending = (chat_id: string, queue: AgentNotice[]) => {
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
    continue_with({ kind: "report", report });
  }
  wake_idle(report.chat_id);
};

export const deliver_alert = (alert: AgentAlert): void => {
  if (is_active(alert.chat_id)) {
    set_pending(alert.chat_id, [...(pending.get(alert.chat_id) ?? []), { kind: "alert", alert }]);
  } else {
    continue_with({ kind: "alert", alert });
  }
  wake_idle(alert.chat_id);
};

export const queue_digest = (chat_id: string, line: string): void => {
  digests.set(chat_id, [...(digests.get(chat_id) ?? []), line]);
};

export const hold_update = (update: AgentUpdate): void => {
  set_pending(update.chat_id, [...(pending.get(update.chat_id) ?? []), { kind: "update", update }]);
};

export const deliver_update = (update: AgentUpdate): void => {
  if (!is_active(update.chat_id) && !user_stopped(update.chat_id)) {
    continue_with({ kind: "update", update });
    return;
  }
  hold_update(update);
  wake_idle(update.chat_id);
};

export const has_agent_notes = (chat_id: string): boolean => Boolean(pending.get(chat_id)?.length);

export const report_note_content = (text: string, agent_tools = true): string =>
  `[Internal app event, not a user message. One of your sub-agents finished. Its full report is saved in a file. Read the complete report before using its findings or writing your final answer. If it remains unread, identify it and explain why. Read it silently when no visible update is useful. This notification does not require an acknowledgment or a recap. You may defer reading while other useful work is in progress, but you must not silently skip the report. If other agents are still running and no visible update is useful, end the response with one short sentence that says what you are still waiting for.]\n\n${report_notice_context(text, agent_tools)}`;

export const update_note_content = (text: string): string =>
  `[Internal app event, not a user message. One of your sub-agents is still running and sent you this update. Use it to avoid duplicating its work or to adjust your plan; do not redo what it says it covers. Routine updates need no acknowledgment or fresh summary of the task; when nothing changes, end the response with one short sentence that says what you are waiting for. Speak at length only if a new result, changed action, blocker or user decision makes an update useful. Its final report notification still arrives when it finishes.]\n\n${text}`;

export const alert_text = (alert: AgentAlert): string => peer_alert_text({ cause: alert.cause, name: alert.name, agent_id: alert.agent_id, body: alert.body });

export const alert_note_content = (text: string): string => `${peer_alert_intro}\n\n${text}`;

export const digest_note_content = (text: string): string =>
  `[Internal app event, not a user message and not a task. A short line about messages between your sub-agents; get_agent_status shows the full texts. It needs no reply and no action unless it changes your plan.]\n\n${text}`;

const turn_note = (note: AgentNotice, agent_tools: boolean): TurnNote => {
  if (note.kind === "alert") {
    const text = alert_text(note.alert);
    return { kind: "notice", notice: "agent_update", text, content: alert_note_content(text) };
  }
  if (note.kind === "update") {
    const text = update_notice_text(note.update.name, note.update.agent_id, note.update.text);
    return { kind: "notice", notice: "agent_update", text, content: update_note_content(text) };
  }
  const { report } = note;
  const text = report_notice_text(report.name, report.agent_id, report.status, report_seconds(report), report_file_notice(report.agent_id, report.run_id, report.report_path, report.report_error, report.stop_reason, agent_tools));
  return { kind: "notice", notice: "agent_report", text, content: report_note_content(text, agent_tools) };
};

const digest_note = (text: string): TurnNote => ({ kind: "notice", notice: "peer_digest", text, content: digest_note_content(text) });

export const take_agent_notes = (chat_id: string, agent_tools = true): TurnNote[] => {
  const queue = pending.get(chat_id) ?? [];
  const lines = digests.get(chat_id) ?? [];
  pending.delete(chat_id);
  digests.delete(chat_id);
  return [...queue.map((note) => turn_note(note, agent_tools)), ...lines.map(digest_note)];
};

export const flush_reports = (chat_id: string): void => {
  const queue = pending.get(chat_id);
  if (!queue || is_active(chat_id)) {
    return;
  }
  const kept: AgentNotice[] = user_stopped(chat_id) ? queue.filter((note) => note.kind === "update") : [];
  const due = queue.filter((note) => !kept.includes(note));
  set_pending(chat_id, kept);
  for (const [at, note] of due.entries()) {
    if (is_active(chat_id)) {
      set_pending(chat_id, [...(pending.get(chat_id) ?? []), ...due.slice(at)]);
      return;
    }
    continue_with(note);
  }
};

export const drop_agent_notes = (chat_id: string): void => {
  pending.delete(chat_id);
  digests.delete(chat_id);
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
