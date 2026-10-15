import { useState } from "react";
import type { Todo } from "../../../shared/chat.ts";
import { newly_done } from "../../../shared/todos.ts";
import { class_names } from "../../components/class-names.ts";
import { CircleCheckIcon, CircleIcon, CircleSpinnerIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./TodoList.css";

const TodoMark = ({ status, live }: { status: Todo["status"]; live: boolean }) => {
  if (status === "done") {
    return <CircleCheckIcon size={15} />;
  }
  if (status === "in_progress") {
    return <CircleSpinnerIcon size={15} className={live ? "spin" : undefined} />;
  }
  return <CircleIcon size={15} />;
};

const use_finished = (todos: Todo[]): Set<string> => {
  const [tracked, set_tracked] = useState(() => ({ todos, finished: new Set<string>() }));
  if (tracked.todos === todos) {
    return tracked.finished;
  }
  const next = { todos, finished: newly_done(tracked.todos, todos) };
  set_tracked(next);
  return next.finished;
};

export const TodoList = ({ todos, live = false }: { todos: Todo[]; live?: boolean }) => {
  const t = use_t();
  const finished = use_finished(todos);
  if (todos.length === 0) {
    return <div className="todo-empty">{t("tools.todo_none")}</div>;
  }
  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <li key={todo.id} className="todo-item" data-status={todo.status} data-finished={finished.has(todo.id) || undefined}>
          <span className="todo-mark">
            <TodoMark status={todo.status} live={live} />
          </span>
          <span className={class_names("todo-text", live && todo.status === "in_progress" && "is-working")}>{todo.text}</span>
        </li>
      ))}
    </ul>
  );
};
