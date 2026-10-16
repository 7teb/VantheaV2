import { report_event_text, update_event_text } from "../../shared/agent-notes.ts";
import type { UserOrigin } from "../../shared/chat.ts";
import type { BackgroundTask } from "../../shared/ipc/work.ts";
import { alert_note_content, alert_text, hold_update, report_seconds, type AgentNotice, type AgentReport, type AgentUpdate } from "../agents/reports.ts";
import { background_event_text } from "../background/event-text.ts";
import { result_was_read } from "../background/manager.ts";
import type { OutputView } from "../shell/output.ts";
import { user_stopped } from "../turn/active.ts";
import { start_internal_turn } from "../turn/run.ts";

type PendingEvent = { origin: Extract<UserOrigin, "background" | "agent_report" | "agent_update">; text: string; task_id?: string; update?: AgentUpdate };

const pending = new Map<string, PendingEvent[]>();

const delivering = new Set<string>();

let held = new Set<string>();

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
  });

const settle = (chat_id: string, delivered: PendingEvent[]) => {
  const rest = (pending.get(chat_id) ?? []).filter((event) => !delivered.includes(event));
  if (rest.length) {
    pending.set(chat_id, rest);
  } else {
    pending.delete(chat_id);
  }
};

const hold_updates = (chat_id: string) => {
  const queue = pending.get(chat_id) ?? [];
  for (const event of queue) {
    if (event.update) {
      hold_update(event.update);
    }
  }
  settle(chat_id, queue.filter((event) => event.update));
};

const deliver = async (chat_id: string) => {
  const live = (pending.get(chat_id) ?? []).filter((event) => !event.task_id || !result_was_read(event.task_id));
  if (live.length) {
    pending.set(chat_id, live);
  } else {
    pending.delete(chat_id);
  }
  if (user_stopped(chat_id)) {
    hold_updates(chat_id);
  }
  const queue = pending.get(chat_id) ?? [];
  const first = queue[0];
  if (!first || delivering.has(chat_id) || held.has(chat_id)) {
    return;
  }
  const other = queue.findIndex((event) => event.origin !== first.origin);
  const batch = other < 0 ? queue : queue.slice(0, other);
  delivering.add(chat_id);
  try {
    const started = await start_internal_turn(chat_id, first.origin, batch.map((event) => event.text).join("\n\n"));
    if (started) {
      settle(chat_id, batch);
      hold_updates(chat_id);
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

export const notify_background_finished = (task: BackgroundTask, output: OutputView): void =>
  queue_event(task.chat_id, { origin: "background", text: background_event_text(task, output), task_id: task.id });

const notify_agent_finished = (report: AgentReport): void => {
  const superseded = (pending.get(report.chat_id) ?? []).filter((event) => event.update?.run_id !== report.run_id);
  pending.set(report.chat_id, superseded);
  queue_event(report.chat_id, { origin: "agent_report", text: agent_event_text(report) });
};

const notify_agent_update = (update: AgentUpdate): void =>
  queue_event(update.chat_id, {
    origin: "agent_update",
    text: update_event_text({ agent_id: update.agent_id, run_id: update.run_id, name: update.name, text: update.text }),
    update,
  });

export const notify_agent = (notice: AgentNotice): void => {
  switch (notice.kind) {
    case "report":
      notify_agent_finished(notice.report);
      return;
    case "update":
      notify_agent_update(notice.update);
      return;
    case "alert":
      queue_event(notice.alert.chat_id, { origin: "agent_update", text: alert_note_content(alert_text(notice.alert)) });
  }
};

export const deliver_pending_events = (chat_id: string): void => {
  void deliver(chat_id);
};

export const hold_events_for = (chat_ids: string[]): void => {
  const released = [...held].filter((chat_id) => !chat_ids.includes(chat_id));
  held = new Set(chat_ids);
  for (const chat_id of released) {
    void deliver(chat_id);
  }
};

export const drop_pending_events = (chat_id: string): void => {
  pending.delete(chat_id);
};
