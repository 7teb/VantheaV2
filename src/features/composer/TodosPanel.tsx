import { useState } from "react";
import type { Chat, Todo } from "../../../shared/chat.ts";
import { CollapsibleBody } from "../../components/Collapsible.tsx";
import { ChevronRightIcon, ListChecksIcon } from "../../components/icons.tsx";
import { use_t } from "../../i18n/index.ts";
import { chat_view_store } from "../../state/chat-view.ts";
import { use_store } from "../../state/use-store.ts";
import { TodoList } from "../tools/TodoList.tsx";

const latest_todos = (chat: Chat | null): Todo[] | null => {
  if (!chat) {
    return null;
  }
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    const step = message.steps.findLast((entry) => entry.kind === "tool" && entry.view?.kind === "todos");
    if (step?.kind === "tool" && step.view?.kind === "todos") {
      return step.view.todos;
    }
  }
  return null;
};

export const TodosPanel = ({ chat_id }: { chat_id: string }) => {
  const t = use_t();
  const [open, set_open] = useState(true);
  const todos = use_store(chat_view_store, (state) => latest_todos(state.entries[chat_id]?.chat ?? null));
  if (!todos || todos.length === 0) {
    return null;
  }
  const done = todos.filter((todo) => todo.status === "done").length;
  if (done === todos.length) {
    return null;
  }
  return (
    <div className="todos-panel enter-fade-up" data-open={open}>
      <button type="button" className="todos-panel-head" aria-expanded={open} onClick={() => set_open(!open)}>
        <ListChecksIcon size={14} />
        <span className="todos-panel-title">{t("tools.todo_tasks")}</span>
        <span className="todos-panel-count">
          {done}/{todos.length}
        </span>
        <ChevronRightIcon size={12} className="todos-panel-chevron" />
      </button>
      <CollapsibleBody open={open}>
        <div className="todos-panel-body">
          <TodoList todos={todos} />
        </div>
      </CollapsibleBody>
    </div>
  );
};
