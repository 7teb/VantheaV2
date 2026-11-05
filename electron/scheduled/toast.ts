import { Notification } from "electron";
import { first_plain_line } from "../../shared/scheduled.ts";
import type { Language } from "../../shared/settings.ts";
import { show_window } from "../app/tray.ts";
import { main_window } from "../app/window.ts";
import { emit } from "../ipc/handle.ts";
import { get_settings } from "../settings/store.ts";
import { error_text } from "../storage/coerce.ts";

export type ToastTarget = { task_id: string; chat_id: string; name: string; project_path: string };

const texts: Record<Language, { fresh: string; failed: (error: string) => string; waiting: string }> = {
  en: { fresh: "New activity", failed: (error) => `Run failed: ${error}`, waiting: "Waiting for your approval" },
  de: { fresh: "Neue Ereignisse", failed: (error) => `Lauf fehlgeschlagen: ${error}`, waiting: "Wartet auf deine Freigabe" },
};

const shown = new Set<Notification>();

let unsupported_logged = false;

const window_focused = (): boolean => {
  const window = main_window();
  return Boolean(window && !window.isDestroyed() && window.isVisible() && window.isFocused());
};

const open_task_chat = (target: ToastTarget) => {
  show_window();
  emit("scheduled:open_chat", { chat_id: target.chat_id, project_path: target.project_path });
};

const show_toast = (target: ToastTarget, body: string) => {
  if (window_focused()) {
    return;
  }
  if (!Notification.isSupported()) {
    if (!unsupported_logged) {
      unsupported_logged = true;
      console.error("[scheduled] this system does not support notifications, scheduled task toasts are skipped");
    }
    return;
  }
  try {
    const toast = new Notification({ title: target.name || "VantheaX", body, silent: true });
    const release = () => {
      shown.delete(toast);
    };
    toast.on("click", () => {
      release();
      open_task_chat(target);
    });
    toast.on("close", release);
    toast.on("failed", (_event, error) => {
      release();
      console.error(`[scheduled] the toast for task ${target.task_id} failed: ${error}`);
    });
    shown.add(toast);
    toast.show();
  } catch (error) {
    console.error(`[scheduled] showing the toast for task ${target.task_id} failed: ${error_text(error)}`);
  }
};

const language_texts = () => texts[get_settings().language];

export const notify_new = (target: ToastTarget, answer: string): void => show_toast(target, first_plain_line(answer) || language_texts().fresh);

export const notify_failed = (target: ToastTarget, error: string): void => show_toast(target, language_texts().failed(error));

export const notify_waiting = (target: ToastTarget): void => show_toast(target, language_texts().waiting);
