import { randomUUID } from "node:crypto";
import type { AssistantMessage, PermissionMode, UserMessage, UserOrigin } from "../shared/chat.ts";
import type { StreamEventBody } from "../shared/events.ts";
import type { TurnStarted } from "../shared/ipc/chats.ts";
import type { ModelChoice } from "../shared/models.ts";
import { append_message, update_message } from "../electron/chats/store.ts";
import { create_emitter, type QuietEnd } from "../electron/turn/emit.ts";
import type { OpeningNotes, TurnNote } from "../electron/turn/session.ts";

export type Launched = { started: TurnStarted; finished: Promise<void> };

export type InternalTurn = { notes?: OpeningNotes; quiet_end?: QuietEnd; keep_order?: boolean; watch?: (body: StreamEventBody) => void; choice?: ModelChoice; mode?: PermissionMode };

export type ScriptedRun = { kind: "busy" } | { kind: "throw"; message: string } | { kind: "run"; bodies: StreamEventBody[]; tools?: string[]; hold?: boolean };

export type LaunchCall = { chat_id: string; origin: UserOrigin; text: string; turn: InternalTurn; notes: TurnNote[] };

export const script: { next: ScriptedRun[]; calls: LaunchCall[]; release: () => void } = { next: [], calls: [], release: () => undefined };

const now = () => new Date().toISOString();

export const launch_internal_turn = async (chat_id: string, origin: UserOrigin, text: string, turn: InternalTurn = {}): Promise<Launched | null> => {
  const step = script.next.shift();
  if (!step) {
    throw new Error("no scripted run left");
  }
  if (step.kind === "busy") {
    return null;
  }
  if (step.kind === "throw") {
    throw new Error(step.message);
  }
  script.calls.push({ chat_id, origin, text, turn, notes: turn.notes?.(new Set(step.tools ?? [])) ?? [] });
  const user: UserMessage = { id: randomUUID(), role: "user", text, attachments: [], origin, created_at: now() };
  await append_message(chat_id, user, !turn.keep_order);
  const message_id = randomUUID();
  const placeholder: AssistantMessage = {
    id: message_id,
    role: "assistant",
    model: turn.choice?.model ?? "",
    effort: turn.choice?.effort ?? "",
    mode: turn.mode ?? "ask",
    plan: false,
    created_at: now(),
    ended_at: null,
    status: "streaming",
    steps: [],
    reasoning_details: [],
    retry: null,
    error: null,
    context: null,
    last_seq: 0,
  };
  await append_message(chat_id, placeholder, !turn.keep_order);
  const emit = create_emitter(chat_id, message_id, { update_message, forward: () => undefined, flush: () => undefined }, turn.quiet_end);
  const held = new Promise<void>((resolve) => {
    script.release = resolve;
    if (!step.hold) {
      setImmediate(resolve);
    }
  });
  const finished = held.then(() => {
    for (const body of step.bodies) {
      emit(body);
      turn.watch?.(body);
    }
  });
  return { started: { user_message_id: user.id, message_id }, finished };
};
