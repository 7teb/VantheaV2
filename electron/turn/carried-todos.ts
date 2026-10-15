import type { Message } from "../../shared/chat.ts";
import { latest_todos, open_todos } from "../../shared/todos.ts";
import type { TurnNote } from "./session.ts";

export const carried_todos_content = (text: string): string =>
  [
    "Your task list from an earlier turn still has open items, and the user still sees them above the input box:",
    ...text.split("\n").map((line) => `- ${line}`),
    "If they belong to this request, continue them and keep the list current with update_todos. If they are finished or no longer apply, call update_todos before your final answer: mark finished items done, or pass an empty list to clear it.",
  ].join("\n");

export const carried_todos_note = (history: Message[]): TurnNote | null => {
  const open = open_todos(latest_todos(history)?.todos ?? []);
  if (open.length === 0) {
    return null;
  }
  const text = open.map((todo) => todo.text).join("\n");
  return { kind: "notice", notice: "todos_carried", text, content: carried_todos_content(text) };
};
