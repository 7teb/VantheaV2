import type { TurnEvent } from "../../shared/events.ts";
import { chime_for } from "./chime-rules.ts";

export type ChatMark = { pending: string[]; asking: boolean; unread: boolean };

export type ChatMarks = Record<string, ChatMark>;

export type RowStatus = "waiting" | "running" | "unread" | "idle";

const blank: ChatMark = { pending: [], asking: false, unread: false };

const same = (a: ChatMark, b: ChatMark) =>
  a.asking === b.asking && a.unread === b.unread && a.pending.length === b.pending.length && a.pending.every((id, index) => id === b.pending[index]);

const patch = (marks: ChatMarks, chat_id: string, change: (mark: ChatMark) => ChatMark): ChatMarks => {
  const current = marks[chat_id] ?? blank;
  const next = change(current);
  if (same(current, next)) {
    return marks;
  }
  const rest = Object.fromEntries(Object.entries(marks).filter(([id]) => id !== chat_id));
  return same(next, blank) ? rest : { ...rest, [chat_id]: next };
};

const without = (pending: string[], call_id: string) => pending.filter((id) => id !== call_id);

export const mark_event = (marks: ChatMarks, event: TurnEvent, viewing: boolean): ChatMarks => {
  switch (event.type) {
    case "tool_approval":
      return patch(marks, event.chat_id, (mark) => ({ ...mark, pending: [...without(mark.pending, event.call_id), event.call_id] }));
    case "tool_start":
      return patch(marks, event.chat_id, (mark) => ({ ...mark, pending: without(mark.pending, event.call_id) }));
    case "tool_end":
      return patch(marks, event.chat_id, (mark) => ({
        ...mark,
        pending: without(mark.pending, event.call_id),
        asking: mark.asking || (!viewing && event.view?.kind === "questions"),
      }));
    case "end":
      return patch(marks, event.chat_id, (mark) => ({ ...mark, pending: [], unread: mark.unread || (!viewing && chime_for(event) === "finished") }));
    default:
      return marks;
  }
};

export const mark_seen = (marks: ChatMarks, chat_id: string): ChatMarks => patch(marks, chat_id, (mark) => ({ ...mark, asking: false, unread: false }));

export const mark_all_read = (marks: ChatMarks): ChatMarks => Object.keys(marks).reduce((next, chat_id) => mark_seen(next, chat_id), marks);

export const row_status = (mark: ChatMark | undefined, streaming: boolean): RowStatus => {
  if (mark && (mark.pending.length > 0 || mark.asking)) {
    return "waiting";
  }
  if (streaming) {
    return "running";
  }
  return mark?.unread ? "unread" : "idle";
};
