import { full_mode_covers, type ApprovalDecision, type PendingApprovalRequest } from "../../shared/approval.ts";
import { error_text } from "../storage/coerce.ts";
import { full_window_until, open_full_window } from "./full-window.ts";

export type PendingApproval = { key: string; call_id: string; request: PendingApprovalRequest };

type Pending = {
  chat_id: string;
  call_id: string;
  request: PendingApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  detach: () => void;
  hold: () => void;
};

export type WaitRequest = PendingApproval & {
  chat_id: string;
  signal: AbortSignal;
  on_hold?: (request: PendingApprovalRequest) => void;
  reject_feedback?: string;
};

type ApprovalListener = (chat_id: string, key: string) => void;

const registry = new Map<string, Map<string, Pending>>();
const listeners = new Set<ApprovalListener>();

export const on_approval_changed = (listener: ApprovalListener): void => {
  listeners.add(listener);
};

const changed = (chat_id: string, key: string) => {
  for (const listener of listeners) {
    try {
      listener(chat_id, key);
    } catch (error) {
      console.error(`[approvals] publishing the approvals of chat ${chat_id} failed: ${error_text(error)}`);
    }
  }
};

const deadline_passed = (request: PendingApprovalRequest, now: number) =>
  request.expires_at !== undefined && request.expires_at <= now;

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

const settle = (key: string, request_id: string, decision: ApprovalDecision): boolean => {
  const requests = registry.get(key);
  const pending = requests?.get(request_id);
  if (!requests || !pending) {
    return false;
  }
  requests.delete(request_id);
  if (!requests.size) {
    registry.delete(key);
  }
  pending.detach();
  pending.resolve(decision);
  changed(pending.chat_id, key);
  return true;
};

const pending_before_deadline = (key: string, request_id: string) => {
  const pending = registry.get(key)?.get(request_id);
  if (pending && deadline_passed(pending.request, Date.now())) {
    settle(key, request_id, unanswered);
    return undefined;
  }
  return pending;
};

export const resolve_decision = (key: string, request_id: string, decision: ApprovalDecision): boolean =>
  pending_before_deadline(key, request_id) !== undefined && settle(key, request_id, decision);

const settle_covered = (chat_id: string) => {
  for (const [key, requests] of [...registry]) {
    for (const [request_id, pending] of [...requests]) {
      if (pending.chat_id === chat_id && full_mode_covers(pending.request)) {
        resolve_decision(key, request_id, window_grant);
      }
    }
  }
};

export const hold_decision = (key: string, request_id: string): boolean => {
  const pending = pending_before_deadline(key, request_id);
  if (!pending) {
    return false;
  }
  pending.hold();
  return true;
};

export const wait_for_decision = ({ key, chat_id, call_id, request, signal, on_hold, reject_feedback }: WaitRequest): Promise<ApprovalDecision> =>
  new Promise<ApprovalDecision>((resolve) => {
    if (signal.aborted) {
      resolve(denied());
      return;
    }
    if (reject_feedback !== undefined) {
      resolve(denied(reject_feedback));
      return;
    }
    if (deadline_passed(request, Date.now())) {
      resolve(unanswered);
      return;
    }
    if (full_window_until(chat_id) !== null && full_mode_covers(request)) {
      resolve(window_grant);
      return;
    }
    const { request_id, expires_at } = request;
    const on_abort = () => settle(key, request_id, denied());
    let timer = expires_at === undefined ? null : setTimeout(() => settle(key, request_id, unanswered), Math.max(0, expires_at - Date.now()));
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
    const pending: Pending = {
      chat_id,
      call_id,
      request,
      resolve,
      detach,
      hold: () => {
        if (!timer) {
          return;
        }
        stop_timer();
        const { expires_at, ...held } = request;
        pending.request = held;
        on_hold?.(held);
        changed(chat_id, key);
      },
    };
    key_map(key).set(request_id, pending);
    signal.addEventListener("abort", on_abort, { once: true });
    changed(chat_id, key);
  });

export const pending_approvals = (chat_id: string): PendingApproval[] => {
  const now = Date.now();
  const pending: PendingApproval[] = [];
  for (const [key, requests] of registry) {
    for (const { chat_id: owner, call_id, request } of requests.values()) {
      if (owner === chat_id && !deadline_passed(request, now)) {
        pending.push({ key, call_id, request });
      }
    }
  }
  return pending;
};

export const open_chat_window = (chat_id: string): void => {
  open_full_window(chat_id);
  settle_covered(chat_id);
};

export const cancel_chat = (key: string): void => {
  const requests = registry.get(key);
  if (!requests) {
    return;
  }
  for (const request_id of requests.keys()) {
    settle(key, request_id, denied());
  }
};
