import type { ChatMeta } from "../../../shared/chat.ts";
import { row_status, type ChatMarks, type RowStatus } from "../../state/chat-marks-rules.ts";

export type ActivityStatus = Exclude<RowStatus, "idle">;

export type ActivityEntry = { chat: ChatMeta; status: ActivityStatus };

const rank: Record<ActivityStatus, number> = { waiting: 0, unread: 1, running: 2 };

export const activity_entries = (chats: ChatMeta[], marks: ChatMarks): ActivityEntry[] =>
  chats
    .filter((chat) => !chat.archived)
    .map((chat) => ({ chat, status: row_status(marks[chat.id], chat.streaming) }))
    .filter((entry): entry is ActivityEntry => entry.status !== "idle")
    .sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(b.chat.updated_at) - Date.parse(a.chat.updated_at));

export const needs_attention = (entries: ActivityEntry[]): boolean => entries.some((entry) => entry.status !== "running");

export type DayGroup = { kind: "today" | "yesterday" | "weekday" | "older"; day_start: number; chats: ChatMeta[] };

const day_ms = 86_400_000;

const start_of_day = (time: number) => new Date(time).setHours(0, 0, 0, 0);

const day_kind = (age: number): DayGroup["kind"] => {
  if (age <= 0) {
    return "today";
  }
  if (age === 1) {
    return "yesterday";
  }
  return age < 7 ? "weekday" : "older";
};

export const day_groups = (chats: ChatMeta[], skip: ReadonlySet<string>, now: number): DayGroup[] => {
  const today = start_of_day(now);
  const groups: DayGroup[] = [];
  const sorted = chats.filter((chat) => !chat.archived && !skip.has(chat.id)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  for (const chat of sorted) {
    const day_start = start_of_day(Date.parse(chat.updated_at));
    const kind = day_kind(Math.round((today - day_start) / day_ms));
    const last = groups.at(-1);
    if (last && last.kind === kind && (kind !== "weekday" || last.day_start === day_start)) {
      last.chats.push(chat);
      continue;
    }
    groups.push({ kind, day_start, chats: [chat] });
  }
  return groups;
};
