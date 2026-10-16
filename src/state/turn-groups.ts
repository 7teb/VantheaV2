import type { AssistantMessage, Message, UserMessage, UserOrigin } from "../../shared/chat.ts";

export type TurnSegment = { kind: "user"; message: UserMessage } | { kind: "turn"; members: AssistantMessage[]; messages: Message[] };

const joins_turn = (origin: UserOrigin) => origin === "agent_report" || origin === "agent_update";

export const turn_segments = (messages: Message[]): TurnSegment[] => {
  const segments: TurnSegment[] = [];
  let open: Extract<TurnSegment, { kind: "turn" }> | null = null;
  let joined = false;
  for (const message of messages) {
    if (message.role === "user") {
      if (open && joins_turn(message.origin)) {
        open.messages.push(message);
        joined = true;
        continue;
      }
      open = null;
      joined = false;
      segments.push({ kind: "user", message });
      continue;
    }
    if (open && joined) {
      open.members.push(message);
      open.messages.push(message);
      joined = false;
      continue;
    }
    open = { kind: "turn", members: [message], messages: [message] };
    joined = false;
    segments.push(open);
  }
  return segments;
};

export const turn_leader = (messages: Message[], message_id: string): string | null => {
  for (const segment of turn_segments(messages)) {
    if (segment.kind === "turn" && segment.members.some((member) => member.id === message_id)) {
      return segment.members[0]?.id ?? null;
    }
  }
  return null;
};
