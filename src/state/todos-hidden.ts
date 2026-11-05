import { create_store } from "./create-store.ts";

export const todos_hidden_store = create_store<ReadonlySet<string>>(new Set());

export const set_todos_hidden = (chat_id: string, hidden: boolean) =>
  todos_hidden_store.update((current) => {
    if (current.has(chat_id) === hidden) {
      return current;
    }
    const next = new Set(current);
    if (hidden) {
      next.add(chat_id);
    } else {
      next.delete(chat_id);
    }
    return next;
  });
