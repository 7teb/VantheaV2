import { full_window_minutes } from "../../shared/approval.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import { error_text } from "../storage/coerce.ts";

type Listener = (chat_id: string, until: number | null) => void;

const window_ms = full_window_minutes * 60 * 1000;

const windows = new Map<string, { until: number; timer: NodeJS.Timeout }>();

const listeners = new Set<Listener>();

const notify = (chat_id: string, until: number | null) => {
  for (const listener of listeners) {
    try {
      listener(chat_id, until);
    } catch (error) {
      console.error(`[permissions] full window listener for chat ${chat_id} failed: ${error_text(error)}`);
    }
  }
};

export const on_full_window = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const full_window_until = (chat_id: string): number | null => windows.get(chat_id)?.until ?? null;

export const close_full_window = (chat_id: string): void => {
  const open = windows.get(chat_id);
  if (!open) {
    return;
  }
  clearTimeout(open.timer);
  windows.delete(chat_id);
  notify(chat_id, null);
};

export const open_full_window = (chat_id: string): number => {
  const previous = windows.get(chat_id);
  if (previous) {
    clearTimeout(previous.timer);
  }
  const until = Date.now() + window_ms;
  const timer = setTimeout(() => close_full_window(chat_id), window_ms);
  timer.unref();
  windows.set(chat_id, { until, timer });
  notify(chat_id, until);
  return until;
};

export const effective_mode = (chat_id: string, mode: PermissionMode): PermissionMode => (windows.has(chat_id) ? "full" : mode);
