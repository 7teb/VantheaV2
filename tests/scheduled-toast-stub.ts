export type ToastTarget = { task_id: string; chat_id: string; name: string; project_path: string };

export type ToastCall = { kind: "new" | "failed" | "waiting"; target: ToastTarget; text: string };

export const toasts: ToastCall[] = [];

export const notify_new = (target: ToastTarget, answer: string): void => {
  toasts.push({ kind: "new", target, text: answer });
};

export const notify_failed = (target: ToastTarget, error: string): void => {
  toasts.push({ kind: "failed", target, text: error });
};

export const notify_waiting = (target: ToastTarget): void => {
  toasts.push({ kind: "waiting", target, text: "" });
};
