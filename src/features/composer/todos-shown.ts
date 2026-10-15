import type { Todo } from "../../../shared/chat.ts";
import { open_todos } from "../../../shared/todos.ts";

export type ShownTodos = { todos: Todo[]; leaving: boolean } | null;

export const shown_todos = (current: Todo[] | null, previous: ShownTodos): ShownTodos => {
  if (current && open_todos(current).length > 0) {
    return previous && !previous.leaving && previous.todos === current ? previous : { todos: current, leaving: false };
  }
  if (!previous) {
    return null;
  }
  const todos = current && current.length > 0 ? current : previous.todos;
  return previous.leaving && previous.todos === todos ? previous : { todos, leaving: true };
};
