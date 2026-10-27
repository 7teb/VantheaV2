import { api } from "../api/bridge.ts";
import { mark_all_read, mark_event, mark_seen, type ChatMarks } from "./chat-marks-rules.ts";
import { create_store } from "./create-store.ts";
import { on_active_chat, ui_store } from "./ui.ts";

export const chat_marks_store = create_store<ChatMarks>({});

export const read_all_marks = () => chat_marks_store.update(mark_all_read);

export const init_chat_marks = (): (() => void) => {
  const stops = [
    api.on("turn:event", (event) => chat_marks_store.update((marks) => mark_event(marks, event, ui_store.get().active_chat_id === event.chat_id))),
    on_active_chat((chat_id) => {
      if (chat_id !== null) {
        chat_marks_store.update((marks) => mark_seen(marks, chat_id));
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
};
