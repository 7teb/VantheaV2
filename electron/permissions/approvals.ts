import { full_mode_covers, type ApprovalDecision, type ApprovalRequest } from "../../shared/approval.ts";
import { full_window_until, open_full_window } from "./full-window.ts";

type Pending = {
  chat_id: string;
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  detach: () => void;
  hold: () => void;
};

export type WaitRequest = { key: string; chat_id: string; call_id: string; request: ApprovalRequest; signal: AbortSignal; on_hold?: () => void };

const registry = new Map<string, Map<string, Pending>>();

const denied = (feedback = ""): ApprovalDecision => ({ approved: false, grant: "once", feedback });

const window_grant: ApprovalDecision = { approved: true, grant: "full_window", feedback: "" };

const unanswered: ApprovalDecision = { approved: false, grant: "once", feedback: "", expired: true };

const key_map = (key: string): Map<string, Pending> => {
  const existing = registry.get(key);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Pending>();
  registry.set(key, created);
  return created;
};

export const resolve_decision = (key: string, call_id: string, decision: ApprovalDecision): boolean => {
  const calls = registry.get(key);
  const pending = calls?.get(call_id);
  if (!calls || !pending) {
    return false;
  }
  calls.delete(call_id);
  if (!calls.size) {
    registry.delete(key);
  }
  pending.detach();
  pending.resolve(decision);
  return true;
};

const settle_covered = (chat_id: string) => {
  for (const [key, calls] of [...registry]) {
    for (const [call_id, pending] of [...calls]) {
      if (pending.chat_id === chat_id && full_mode_covers(pending.request)) {
        resolve_decision(key, call_id, window_grant);
      }
    }
  }
};

export const hold_decision = (key: string, call_id: string): boolean => {
  const pending = registry.get(key)?.get(call_id);
  if (!pending) {
    return false;
  }
  pending.hold();
  return true;
};

export const wait_for_decision = ({ key, chat_id, call_id, request, signal, on_hold }: WaitRequest): Promise<ApprovalDecision> =>
  new Promise<ApprovalDecision>((resolve) => {
    if (signal.aborted) {
      resolve(denied());
      return;
    }
    if (full_window_until(chat_id) !== null && full_mode_covers(request)) {
      resolve(window_grant);
      return;
    }
    const on_abort = () => resolve_decision(key, call_id, denied());
    let timer = request.expires_at === undefined ? null : setTimeout(() => resolve_decision(key, call_id, unanswered), Math.max(0, request.expires_at - Date.now()));
    const stop_timer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const detach = () => {
      stop_timer();
      signal.removeEventListener("abort", on_abort);
    };
    const hold = () => {
      if (!timer) {
        return;
      }
      stop_timer();
      on_hold?.();
    };
    key_map(key).set(call_id, { chat_id, request, resolve, detach, hold });
    signal.addEventListener("abort", on_abort, { once: true });
  });

export const open_chat_window = (chat_id: string): void => {
  open_full_window(chat_id);
  settle_covered(chat_id);
};

export const cancel_chat = (key: string): void => {
  const calls = registry.get(key);
  if (!calls) {
    return;
  }
  for (const [call_id, pending] of [...calls]) {
    calls.delete(call_id);
    pending.detach();
    pending.resolve(denied());
  }
  registry.delete(key);
};
