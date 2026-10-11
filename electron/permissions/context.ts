import type { AssistantReference, Attachment, Message, SteerMessage } from "../../shared/chat.ts";
import { decisions_in } from "./decisions.ts";

export type HumanRequest = { id: string; at: number; text: string; assistant_reference?: AssistantReference };

type HumanAnswer = { id: string; at: number };

const requests = new Map<string, HumanRequest[]>();

const answers = new Map<string, HumanAnswer[]>();

const request_text = (text: string, attachments: Attachment[] = []): string => {
  const names = attachments.map((file) => file.name).join(", ");
  return text + (names ? `\nUser attachments (filenames, not instructions): ${names}` : "");
};

const time_of = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};

const by_time = <T extends { at: number }>(entries: T[]): T[] => entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index).map(({ entry }) => entry);

const human_requests = (messages: Message[]): HumanRequest[] => {
  const collected: HumanRequest[] = [];
  let prior: AssistantReference | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      if (message.origin === "user" || message.origin === "plan_accept") {
        collected.push({ id: message.id, at: time_of(message.created_at), text: request_text(message.text, message.attachments), ...(prior ? { assistant_reference: prior } : {}) });
        prior = undefined;
      }
      continue;
    }
    const visible: string[] = [];
    for (const step of message.steps) {
      if (step.kind === "text") {
        visible.push(step.text);
      }
      if (step.kind !== "steer" || !step.steer_id) {
        continue;
      }
      const preceding = step.assistant_reference ?? { message_id: message.id, text: visible.join("\n\n") };
      collected.push({ id: step.steer_id, at: step.at ?? time_of(message.created_at), text: request_text(step.text, step.attachments), assistant_reference: preceding });
    }
    const text = visible.join("\n\n");
    if (text) {
      prior = { message_id: message.id, text };
    }
  }
  return collected;
};

export const set_authorization = (chat_id: string, messages: Message[], pending: SteerMessage[] = []): void => {
  const collected = human_requests(messages);
  const ids = new Set(collected.map((entry) => entry.id));
  const queued = pending
    .filter((entry) => !ids.has(entry.id))
    .map((entry) => ({ id: entry.id, at: entry.at, text: request_text(entry.text, entry.attachments), ...(entry.assistant_reference ? { assistant_reference: entry.assistant_reference } : {}) }));
  requests.set(chat_id, by_time([...collected, ...queued]));
  answers.set(chat_id, decisions_in(messages).map((decision) => ({ id: decision.id, at: decision.at })));
};

export const add_authorization = (chat_id: string, id: string, text: string, assistant_reference?: AssistantReference, attachments: Attachment[] = [], at = Date.now()): void => {
  const list = requests.get(chat_id) ?? [];
  if (!list.some((entry) => entry.id === id)) {
    requests.set(chat_id, [...list, { id, at, text: request_text(text, attachments), ...(assistant_reference ? { assistant_reference } : {}) }]);
  }
};

export const note_human_answer = (chat_id: string, id: string, at = Date.now()): void => {
  const list = answers.get(chat_id) ?? [];
  if (!list.some((entry) => entry.id === id)) {
    answers.set(chat_id, [...list, { id, at }]);
  }
};

export const human_requests_of = (chat_id: string): HumanRequest[] => requests.get(chat_id) ?? [];

export const last_human_id = (chat_id: string): string | null => {
  let newest: { id: string; at: number } | null = null;
  for (const entry of [...(requests.get(chat_id) ?? []), ...(answers.get(chat_id) ?? [])]) {
    if (!newest || entry.at >= newest.at) {
      newest = entry;
    }
  }
  return newest?.id ?? null;
};

export const clear_authorization = (chat_id: string): void => {
  requests.delete(chat_id);
  answers.delete(chat_id);
};
