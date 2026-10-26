import type { TurnEvent } from "../../shared/events.ts";
import { api } from "../api/bridge.ts";
import { chime_for } from "./chime-rules.ts";
import { play_chime } from "./chime.ts";
import { settings_store } from "./settings.ts";
import { window_store } from "./window.ts";

const quiet_ms = 2000;

let last_chime = 0;

const on_turn_event = (event: TurnEvent) => {
  const chime = chime_for(event);
  if (chime === null || window_store.get()?.focused !== false || settings_store.get()?.notification_sound === false) {
    return;
  }
  const now = Date.now();
  if (now - last_chime < quiet_ms) {
    return;
  }
  last_chime = now;
  play_chime(chime).catch((error) => console.warn(`[attention] the ${chime} chime for chat ${event.chat_id} did not play`, error));
};

export const init_attention = (): (() => void) => api.on("turn:event", on_turn_event);
