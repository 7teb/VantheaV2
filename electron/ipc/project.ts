import { undo_turn } from "../project/snapshots.ts";
import { require_string } from "../storage/coerce.ts";
import { handle } from "./handle.ts";

export const register_project_ipc = () => {
  handle("turn:undo", (chat_id, message_id) => {
    require_string(chat_id, "chat id", 200);
    return undo_turn(require_string(message_id, "message id", 200));
  });
};
