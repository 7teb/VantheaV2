import { message_attachments, type Message, type ToolStep } from "../../shared/chat.ts";
import { refs } from "./state.ts";

const held = new Map<string, number>();

const step_image_ids = (step: ToolStep): string[] => [
  ...(step.images ?? []).map((image) => image.id),
  ...(step.view?.kind === "shown_images" ? step.view.images.map((image) => image.id) : []),
];

const message_image_ids = (message: Message): string[] =>
  message.role === "assistant" ? message.steps.flatMap((step) => (step.kind === "tool" ? step_image_ids(step) : [])) : [];

export const attachment_ids = (messages: Message[]): Set<string> => {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const attachment of message_attachments(message)) {
      ids.add(attachment.id);
      if (attachment.model) {
        ids.add(attachment.model.id);
      }
    }
    for (const id of message_image_ids(message)) {
      ids.add(id);
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

export const is_referenced = (id: string): boolean => refs.has(id);

export const hold_ids = (ids: Iterable<string>): void => {
  for (const id of ids) {
    held.set(id, (held.get(id) ?? 0) + 1);
  }
};

export const release_ids = (ids: Iterable<string>): void => {
  for (const id of ids) {
    const count = (held.get(id) ?? 0) - 1;
    if (count > 0) {
      held.set(id, count);
      continue;
    }
    held.delete(id);
  }
};

export const is_held = (id: string): boolean => held.has(id);
