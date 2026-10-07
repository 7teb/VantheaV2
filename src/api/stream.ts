import { api } from "./bridge.ts";
import { create_smoother, type Delivery, type SmootherClock } from "./smoother.ts";

const browser_clock: SmootherClock = {
  now: () => performance.now(),
  schedule: (run, delay_ms) => window.setTimeout(run, delay_ms),
  cancel: (handle) => window.clearTimeout(handle),
  hidden: () => document.visibilityState === "hidden",
};

export const start_stream = (deliver: (batch: Delivery[]) => void): (() => void) => {
  const smoother = create_smoother(deliver, browser_clock);
  const on_visibility = () => {
    if (browser_clock.hidden()) {
      smoother.flush();
    }
  };
  document.addEventListener("visibilitychange", on_visibility);
  const stops = [
    api.on("turn:event", (event) => smoother.push({ kind: "event", event })),
    api.on("chats:appended", ({ chat_id, message }) => smoother.push({ kind: "appended", chat_id, message })),
    api.on("chats:truncated", ({ chat_id, message_id }) => smoother.push({ kind: "truncated", chat_id, message_id })),
    api.on("chats:message_replaced", ({ chat_id, message }) => smoother.push({ kind: "replaced", chat_id, message })),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
    document.removeEventListener("visibilitychange", on_visibility);
    smoother.dispose();
  };
};
