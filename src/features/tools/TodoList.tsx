import type { Todo } from "../../../shared/chat.ts";
import { CircleCheckIcon, CircleIcon, LoaderIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import "./TodoList.css";

const TodoMark = ({ status }: { status: Todo["status"] }) => {
  if (status === "done") {
    return <CircleCheckIcon size={15} />;
  }
  if (status === "in_progress") {
    return <LoaderIcon size={15} className="spin" />;
  }
  return <CircleIcon size={15} />;
};

export const TodoList = ({ todos }: { todos: Todo[] }) => {
  const t = use_t();
  if (todos.length === 0) {
    return <div className="todo-empty">{t("tools.todo_none")}</div>;
  }
  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <li key={todo.id} className="todo-item" data-status={todo.status}>
          <span className="todo-mark">
            <TodoMark status={todo.status} />
          </span>
          <span className="todo-text">{todo.text}</span>
        </li>
      ))}
    </ul>
  );
};
