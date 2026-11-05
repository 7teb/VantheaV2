import type { AssistantMessage, UserMessage } from "../../../shared/chat.ts";
import type { TurnSegment } from "../../state/turn-groups.ts";

export type QuietRunPair = { prompt: UserMessage; answer: AssistantMessage };

export type ChatRow = { kind: "segment"; segment: TurnSegment; scheduled_run: boolean } | { kind: "quiet"; id: string; runs: QuietRunPair[] };

export const quiet_answer = (message: AssistantMessage): boolean => message.quiet === true && message.status === "done";

const scheduled_prompt = (segment: TurnSegment | undefined): boolean => segment?.kind === "user" && segment.message.origin === "scheduled";

const quiet_pair = (segment: TurnSegment, next: TurnSegment | undefined, keep: string | null): QuietRunPair | null => {
  if (segment.kind !== "user" || !scheduled_prompt(segment) || next?.kind !== "turn" || next.messages.length !== 1) {
    return null;
  }
  const answer = next.members[0];
  if (!answer || !quiet_answer(answer) || keep === segment.message.id || keep === answer.id) {
    return null;
  }
  return { prompt: segment.message, answer };
};

export const chat_rows = (segments: TurnSegment[], keep: string | null): ChatRow[] => {
  const rows: ChatRow[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as TurnSegment;
    const pair = quiet_pair(segment, segments[index + 1], keep);
    if (!pair) {
      rows.push({ kind: "segment", segment, scheduled_run: segment.kind === "turn" && scheduled_prompt(segments[index - 1]) });
      continue;
    }
    index += 1;
    const last = rows.at(-1);
    if (last?.kind === "quiet") {
      last.runs.push(pair);
      continue;
    }
    rows.push({ kind: "quiet", id: pair.prompt.id, runs: [pair] });
  }
  return rows;
};
