import { manual_compaction_only, type AssistantMessage, type Message, type UserOrigin } from "./chat.ts";
import type { TurnSpan } from "./turn-diff.ts";

export const joins_turn = (origin: UserOrigin): boolean => origin === "agent_report" || origin === "agent_update";

const turn_groups = (messages: Message[]): AssistantMessage[][] => {
  const groups: AssistantMessage[][] = [];
  let open: AssistantMessage[] | null = null;
  let joined = false;
  for (const message of messages) {
    if (message.role === "user") {
      joined = open !== null && joins_turn(message.origin);
      if (!joined) open = null;
      continue;
    }
    if (open && joined) {
      open.push(message);
      joined = false;
      continue;
    }
    open = [message];
    joined = false;
    groups.push(open);
  }
  return groups;
};

const span_from = (group: AssistantMessage[]): TurnSpan | null => {
  const first = group[0];
  const last = group.at(-1);
  return first && last ? { from_id: first.id, to_id: last.id } : null;
};

export const span_of = (messages: Message[], message_id: string): TurnSpan | null => {
  const group = turn_groups(messages).find((members) => members.some((member) => member.id === message_id));
  return group ? span_from(group) : null;
};

export const newest_span = (messages: Message[]): TurnSpan | null => {
  const group = turn_groups(messages).findLast((members) => members[0] !== undefined && !manual_compaction_only(members[0]));
  return group ? span_from(group) : null;
};

export const turn_ran_before = (messages: Message[], message_id: string): boolean => {
  const at = messages.findIndex((message) => message.id === message_id);
  return messages.slice(0, Math.max(at, 0)).some((message) => message.role === "assistant" && !manual_compaction_only(message));
};
