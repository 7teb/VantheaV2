import { parse_report_events, parse_update_batch, report_notice_text, update_notice_text, type AgentNote } from "../../../shared/agent-notes.ts";
import type { Message, NoticeStep, UserMessage } from "../../../shared/chat.ts";
import { split_workflow_notices } from "../../../shared/workflow-notes.ts";

const note_step = (message_id: string, note: AgentNote, index: number): NoticeStep | null => {
  const id = `origin:${message_id}:${index}`;
  if (note.kind === "report") {
    const seconds = typeof note.seconds === "number" && Number.isFinite(note.seconds) ? note.seconds : 0;
    return { id, round: 0, kind: "notice", notice: "agent_report", text: report_notice_text(note.name, note.agent_id, note.status, seconds, note.body) };
  }
  if (note.kind === "update") {
    return { id, round: 0, kind: "notice", notice: "agent_update", text: update_notice_text(note.name, note.agent_id, note.body) };
  }
  return null;
};

const workflow_steps = (message: UserMessage): NoticeStep[] | null => {
  const notices = split_workflow_notices(message.text);
  return notices.length ? notices.map((text, index): NoticeStep => ({ id: `origin:${message.id}:${index}`, round: 0, kind: "notice", notice: "workflow_result", text })) : null;
};

const origin_steps = (message: UserMessage): NoticeStep[] | null => {
  if (message.origin === "workflow") {
    return workflow_steps(message);
  }
  const notes = message.origin === "agent_report" ? parse_report_events(message.text) : message.origin === "agent_update" ? parse_update_batch(message.text) : [];
  if (!notes.length) {
    return null;
  }
  const steps = notes.map((note, index) => note_step(message.id, note, index));
  const kept = steps.filter((step): step is NoticeStep => step !== null);
  return kept.length === steps.length ? kept : null;
};

export type TurnLayout = { lead: ReadonlyMap<string, NoticeStep[]>; absorbed: ReadonlySet<string> };

export const turn_layout = (messages: Message[]): TurnLayout => {
  const lead = new Map<string, NoticeStep[]>();
  const absorbed = new Set<string>();
  messages.forEach((message, index) => {
    const next = messages[index + 1];
    if (message.role !== "user" || next?.role !== "assistant") {
      return;
    }
    const steps = origin_steps(message);
    if (!steps) {
      return;
    }
    lead.set(next.id, [...(lead.get(next.id) ?? []), ...steps]);
    absorbed.add(message.id);
  });
  return { lead, absorbed };
};
