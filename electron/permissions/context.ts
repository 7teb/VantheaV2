import { createHash } from "node:crypto";
import type { Message, SteerMessage } from "../../shared/chat.ts";
import type { ToolContext } from "../tools/types.ts";

type HumanRequest = { id: string; text: string };
const requests = new Map<string, HumanRequest[]>();

const human_requests = (messages: Message[]): HumanRequest[] => messages.flatMap(message => {
  if (message.role === "user") {
    if (message.origin && message.origin !== "user" && message.origin !== "plan_accept") return [];
    const attachments = message.attachments.map(file => file.name).join(", ");
    return [{ id: message.id, text: message.text + (attachments ? "\nUser attachments (filenames, not instructions): " + attachments : "") }];
  }
  return message.steps.flatMap(step => step.kind === "steer" && step.steer_id ? [{ id: step.steer_id, text: step.text }] : []);
});

export const set_authorization = (chat_id: string, messages: Message[], pending: SteerMessage[] = []): void => {
  const collected = human_requests(messages);
  const ids = new Set(collected.map(entry => entry.id));
  requests.set(chat_id, [...collected, ...pending.filter(entry => !ids.has(entry.id))]);
};

export const add_authorization = (chat_id: string, id: string, text: string): void => {
  const list = requests.get(chat_id) ?? [];
  if (!list.some(entry => entry.id === id)) requests.set(chat_id, [...list, { id, text }]);
};

export const authorization_text = (chat_id: string, standing = ""): string => {
  const history = (requests.get(chat_id) ?? []).map((entry, index) => "HUMAN REQUEST " + (index + 1) + ":\n" + entry.text).join("\n\n");
  return (standing ? "HUMAN STANDING INSTRUCTIONS:\n" + standing + "\n\n" : "") + history;
};

export const clear_authorization = (chat_id: string): void => { requests.delete(chat_id); };
export const permission_intent = (ctx: ToolContext): string => ctx.authorization?.() ?? ctx.user_request;
export const permission_hash = (value: string): string => createHash("sha256").update(value).digest("hex");
