import type { Message, Todo } from "./chat.ts";

export type TodoSource = { todos: Todo[]; streaming: boolean };

export const latest_todos = (messages: Message[]): TodoSource | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    const step = message.steps.findLast((entry) => entry.kind === "tool" && entry.view?.kind === "todos");
    if (step?.kind === "tool" && step.view?.kind === "todos") {
      return { todos: step.view.todos, streaming: message.status === "streaming" };
    }
  }
  return null;
};

export const open_todos = (todos: Todo[]): Todo[] => todos.filter((todo) => todo.status !== "done");
