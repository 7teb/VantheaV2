import { api } from "../api/bridge.ts";
import { held_chats } from "./chat-drafts.ts";
import { composer_store } from "./composer.ts";

export const init_event_hold = (): (() => void) => {
  let sent: string | null = null;
  let scheduled = false;
  const sync = () => {
    scheduled = false;
    const chats = held_chats(composer_store.get());
    const key = chats.join("\n");
    if (key === sent) {
      return;
    }
    sent = key;
    api.invoke("turn:hold_events", chats).catch((error) => console.error(`[composer] turn:hold_events failed for ${chats.length} chat(s)`, error));
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(sync);
    }
  };
  schedule();
  return composer_store.subscribe(schedule);
};
