import { full_mode_covers, review_unavailable, type ApprovalDecision, type ApprovalRequest } from "../../shared/approval.ts";
import { full_window_until, open_full_window } from "./full-window.ts";

type Pending = { chat_id: string; request: ApprovalRequest; resolve: (decision: ApprovalDecision) => void; detach: () => void };

export type WaitRequest = { key: string; chat_id: string; call_id: string; request: ApprovalRequest; signal: AbortSignal };

const registry = new Map<string, Map<string, Pending>>();

const denied = (feedback = ""): ApprovalDecision => ({ approved: false, grant: "once", feedback });

const window_grant: ApprovalDecision = { approved: true, grant: "full_window", feedback: "" };

const key_map = (key: string): Map<string, Pending> => {
  const existing = registry.get(key);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Pending>();
  registry.set(key, created);
  return created;
};

const settle = (key: string, call_id: string, decision: ApprovalDecision): boolean => {
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
        settle(key, call_id, window_grant);
      }
    }
  }
};

export const wait_for_decision = ({ key, chat_id, call_id, request, signal }: WaitRequest): Promise<ApprovalDecision> =>
  new Promise<ApprovalDecision>((resolve) => {
    if (signal.aborted) {
      resolve(denied());
      return;
    }
    if (full_window_until(chat_id) !== null && full_mode_covers(request)) {
      resolve(window_grant);
      return;
    }
    const on_abort = () => settle(key, call_id, denied());
    const detach = () => signal.removeEventListener("abort", on_abort);
    key_map(key).set(call_id, { chat_id, request, resolve, detach });
    signal.addEventListener("abort", on_abort, { once: true });
  });

export const resolve_decision = (key: string, call_id: string, decision: ApprovalDecision): boolean => {
  const pending = registry.get(key)?.get(call_id);
  if (!pending) {
    return false;
  }
  if (decision.grant !== "full_window") {
    return settle(key, call_id, decision);
  }
  if (!decision.approved || !full_mode_covers(pending.request) || !review_unavailable(pending.request)) {
    return settle(key, call_id, { ...decision, grant: "once" });
  }
  open_full_window(pending.chat_id);
  settle(key, call_id, { ...decision, grant: "once" });
  settle_covered(pending.chat_id);
  return true;
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
