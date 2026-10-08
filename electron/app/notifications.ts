import { report_event_text } from "../../shared/agent-notes.ts";
import type { UserOrigin } from "../../shared/chat.ts";
import type { BackgroundTask } from "../../shared/ipc/work.ts";
import { report_seconds, type AgentReport } from "../agents/reports.ts";
import { start_internal_turn } from "../turn/run.ts";

type PendingEvent = { origin: Extract<UserOrigin, "background" | "agent_report">; text: string };

const pending = new Map<string, PendingEvent[]>();

const delivering = new Set<string>();

const output_cap = 6000;

const duration_seconds = (task: BackgroundTask) => {
  const started = Date.parse(task.started_at);
  const ended = task.ended_at ? Date.parse(task.ended_at) : Date.now();
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : 0;
};

export const background_event_text = (task: BackgroundTask): string => {
  const output = task.output_tail.trim();
  return [
    "[BACKGROUND TASK EVENT]",
    "This is an internal app event, not a message written by the user. A long-running task you started earlier in this chat has finished.",
    `ID: ${task.id}`,
    `Name: ${task.name}`,
    `Command: ${task.command}`,
    `Status: ${task.status}`,
    `Exit code: ${task.exit_code ?? "none"}`,
    `Duration: ${duration_seconds(task)}s`,
    output ? `Output tail:\n${output.slice(-output_cap)}` : "Output tail: empty",
    "Use this as new evidence and continue the original work if it is still relevant. Do not say the user sent this event. If nothing is left to do, reply briefly.",
  ].join("\n\n");
};

export const agent_event_text = (report: AgentReport): string =>
  report_event_text({
    agent_id: report.agent_id,
    run_id: report.run_id,
    name: report.name,
    model: report.model,
    profile: report.profile,
    status: report.status,
    seconds: report_seconds(report),
    report_path: report.report_path,
    report_error: report.report_error,
    stop_reason: report.stop_reason,
    has_report: report.has_report,
  });

const settle = (chat_id: string, delivered: PendingEvent[]) => {
  const rest = (pending.get(chat_id) ?? []).filter((event) => !delivered.includes(event));
  if (rest.length) {
    pending.set(chat_id, rest);
  } else {
    pending.delete(chat_id);
  }
};

const deliver = async (chat_id: string) => {
  const queue = pending.get(chat_id);
  const first = queue?.[0];
  if (!queue || !first || delivering.has(chat_id)) {
    return;
  }
  const other = queue.findIndex((event) => event.origin !== first.origin);
  const batch = other < 0 ? queue : queue.slice(0, other);
  delivering.add(chat_id);
  try {
    const started = await start_internal_turn(chat_id, first.origin, batch.map((event) => event.text).join("\n\n"));
    if (started) {
      settle(chat_id, batch);
    }
  } catch (error) {
    console.error(`[notify] continuation turn for chat ${chat_id} failed, dropping ${batch.length} event(s):`, error);
    settle(chat_id, batch);
  } finally {
    delivering.delete(chat_id);
  }
};

const queue_event = (chat_id: string, event: PendingEvent) => {
  pending.set(chat_id, [...(pending.get(chat_id) ?? []), event]);
  void deliver(chat_id);
};

export const notify_background_finished = (task: BackgroundTask): void => queue_event(task.chat_id, { origin: "background", text: background_event_text(task) });

export const notify_agent_finished = (report: AgentReport): void => queue_event(report.chat_id, { origin: "agent_report", text: agent_event_text(report) });

export const deliver_pending_events = (chat_id: string): void => {
  void deliver(chat_id);
};

export const drop_pending_events = (chat_id: string): void => {
  pending.delete(chat_id);
};
