import { useState } from "react";
import type { Todo } from "../../../shared/chat.ts";
import { class_names } from "../../components/class-names.ts";
import { CircleCheckIcon } from "../../components/icons.tsx";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import { use_t } from "../../i18n/index.ts";
import { TodoFold } from "./TodoFold.tsx";
import "./TodoList.css";

type Fill = "whole" | "knob" | null;

const is_complete = (todos: Todo[]): boolean => todos.every((todo) => todo.status === "done");

const walk_fills = (todos: Todo[]): Fill[] => {
  const walked = is_complete(todos) ? -1 : todos.findLastIndex((todo) => todo.status !== "pending");
  return todos.map((todo, index) => {
    if (index > walked) {
      return null;
    }
    return index === walked && todo.status === "in_progress" ? "knob" : "whole";
  });
};

const fold_size = (todos: Todo[]): number => {
  const first_open = todos.findIndex((todo) => todo.status !== "done");
  const extra = (first_open < 0 ? todos.length : first_open) - 2;
  return extra >= 2 ? extra : 0;
};

type FirstRender = { ids: Set<string>; filled: Set<string>; folded: boolean };

const first_render = (todos: Todo[]): FirstRender => {
  const fills = walk_fills(todos);
  return {
    ids: new Set(todos.map((todo) => todo.id)),
    filled: new Set(todos.filter((_, index) => fills[index] !== null).map((todo) => todo.id)),
    folded: fold_size(todos) > 0,
  };
};

type TodoRowProps = { todo: Todo; first: boolean; last: boolean; fill: Fill; added: boolean; grow: boolean; hidden: boolean; complete: boolean; live: boolean };

const TodoRow = ({ todo, first, last, fill, added, grow, hidden, complete, live }: TodoRowProps) => {
  const working = live && todo.status === "in_progress";
  return (
    <li className="todo-item" data-status={todo.status} data-first={first || undefined} data-last={last || undefined} data-folded={hidden || undefined} inert={hidden}>
      <span className="todo-mark">
        <span className="todo-rail" data-grow={added || undefined}>
          {fill && <span className="todo-walk" data-to-knob={fill === "knob" || undefined} data-grow={grow || undefined} />}
        </span>
        {todo.status === "in_progress" && <span className="todo-knob" data-live={live || undefined} />}
        {complete && last && <CircleCheckIcon className="todo-done-mark" />}
      </span>
      <span className={class_names("todo-text", working && "is-working")}>
        <WorkingLetters text={todo.text} active={working} />
      </span>
    </li>
  );
};

export const TodoList = ({ todos, live = false }: { todos: Todo[]; live?: boolean }) => {
  const t = use_t();
  const [first] = useState(() => first_render(todos));
  const [fold_open, set_fold_open] = useState(false);
  if (todos.length === 0) {
    return <div className="todo-empty">{t("tools.todo_none")}</div>;
  }
  const complete = is_complete(todos);
  const fills = walk_fills(todos);
  const fold = fold_size(todos);
  const building = live && todos.every((todo) => todo.status === "pending");
  return (
    <div className="todo-list" data-complete={complete || undefined} data-building={building || undefined}>
      {fold > 0 && <TodoFold count={fold} walked={!complete} open={fold_open} grow={!first.folded} on_toggle={() => set_fold_open(!fold_open)} />}
      <ul className="todo-rows">
        {todos.map((todo, index) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            first={index === 0 && fold === 0}
            last={index === todos.length - 1}
            fill={fills[index]}
            added={!first.ids.has(todo.id)}
            grow={!first.filled.has(todo.id)}
            hidden={index < fold && !fold_open}
            complete={complete}
            live={live}
          />
        ))}
      </ul>
    </div>
  );
};
