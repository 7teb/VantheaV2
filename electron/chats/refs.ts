import type { Message } from "../../shared/chat.ts";
import { refs } from "./state.ts";

export const attachment_ids = (messages: Message[]): Set<string> => {
  const ids = new Set<string>();
  for (const message of messages) {
    const attachments = message.role === "user" ? message.attachments : message.steps.flatMap((step) => (step.kind === "steer" ? (step.attachments ?? []) : []));
    for (const attachment of attachments) {
      ids.add(attachment.id);
    }
  }
  return ids;
};

export const change_refs = (before: Set<string>, after: Set<string>): string[] => {
  const released: string[] = [];
  for (const id of after) {
    if (!before.has(id)) {
      refs.set(id, (refs.get(id) ?? 0) + 1);
    }
  }
  for (const id of before) {
    if (after.has(id)) {
      continue;
    }
    const count = (refs.get(id) ?? 0) - 1;
    if (count > 0) {
      refs.set(id, count);
      continue;
    }
    refs.delete(id);
    released.push(id);
  }
  return released;
};

export const same_ids = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((id) => b.has(id));
