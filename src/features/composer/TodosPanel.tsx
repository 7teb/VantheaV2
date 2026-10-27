import { useState } from "react";
import type { Message } from "../../../shared/chat.ts";
import { latest_todos } from "../../../shared/todos.ts";
import { class_names } from "../../components/class-names.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon } from "../../components/icons.tsx";
import { ProgressRing } from "../../components/ProgressRing.tsx";
import { use_t } from "../../i18n/index.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import type { ChatViewState } from "../../state/chat-view-reduce.ts";
import { use_store } from "../../state/use-store.ts";
import { TodoList } from "../tools/TodoList.tsx";
import { use_chat_busy } from "./composer-hooks.ts";
import { shown_todos, type ShownTodos } from "./todos-shown.ts";
import { WorkingLetters } from "../../components/WorkingLetters.tsx";
import "./TodosPanel.css";

const no_messages: Message[] = [];

const messages_of = (state: ChatViewState, chat_id: string): Message[] => state.entries[chat_id]?.chat?.messages ?? no_messages;

export const TodosPanel = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const [open, set_open] = useState(true);
  const todos = use_store(chat_view_store, (state) => latest_todos(messages_of(state, chat_id))?.todos ?? null);
  const streaming = use_store(chat_view_store, (state) => latest_todos(messages_of(state, chat_id))?.streaming ?? false);
  const busy = use_chat_busy(chat_id);
  const [shown, set_shown] = useState<ShownTodos>(() => shown_todos(todos, null));
  const next = shown_todos(todos, shown);
  if (next !== shown) {
    set_shown(next);
  }
  if (!next) {
    return null;
  }
  const live = busy && streaming && !next.leaving;
  const done = next.todos.filter((todo) => todo.status === "done").length;
  const current = open ? undefined : next.todos.find((todo) => todo.status === "in_progress");
  return (
    <div
      className="todos-panel composer-dock-card raised-surface enter-fade-up"
      data-open={open}
      data-leaving={next.leaving}
      onAnimationEnd={(event) => {
        if (event.animationName === "todos-out") {
          set_shown(null);
        }
      }}
    >
      <div className="todos-panel-inner">
        <button type="button" className="todos-panel-head" aria-expanded={open} onClick={() => set_open(!open)}>
          <ProgressRing ratio={done / next.todos.length} size={16} className="todos-panel-ring" />
          <span className={class_names("todos-panel-title", current && live && "is-working")}><WorkingLetters text={current ? current.text : t("tools.todo_tasks")} active={Boolean(current && live)} /></span>
          <span className="todos-panel-count">
            {done}/{next.todos.length}
          </span>
          <ChevronRightIcon size={12} className="todos-panel-chevron" />
        </button>
        <CollapsibleBody open={open}>
          <div className="todos-panel-body">
            <TodoList todos={next.todos} live={live} />
          </div>
        </CollapsibleBody>
      </div>
    </div>
  );
};
