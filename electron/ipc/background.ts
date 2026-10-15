import { cancel_background, clear_background, list_background, on_background_changed } from "../background/manager.ts";
import { require_string } from "../storage/coerce.ts";
import { move_to_background } from "../tools/shell/handoff.ts";
import { emit, handle } from "./handle.ts";

export const register_background_ipc = () => {
  on_background_changed((task) => emit("background:changed", task));
  handle("background:list", (chat_id) => list_background(require_string(chat_id, "chat id", 200)));
  handle("background:cancel", (task_id) => {
    cancel_background(require_string(task_id, "background task id", 200));
  });
  handle("background:clear", (chat_id) => clear_background(require_string(chat_id, "chat id", 200)));
  handle("background:adopt_command", (chat_id, call_id) =>
    move_to_background(require_string(chat_id, "chat id", 200), require_string(call_id, "tool call id", 200)),
  );
};
