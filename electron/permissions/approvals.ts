import type { ApprovalDecision } from "../../shared/approval.ts";

type Pending = { resolve: (decision: ApprovalDecision) => void; detach: () => void };

const registry = new Map<string, Map<string, Pending>>();

const denied = (feedback = ""): ApprovalDecision => ({ approved: false, grant: "once", feedback });

const chat_map = (chat_id: string): Map<string, Pending> => {
  const existing = registry.get(chat_id);
  if (existing) {
    return existing;
  }
  const created = new Map<string, Pending>();
  registry.set(chat_id, created);
  return created;
};

const settle = (chat_id: string, call_id: string, decision: ApprovalDecision): boolean => {
  const calls = registry.get(chat_id);
  const pending = calls?.get(call_id);
  if (!calls || !pending) {
    return false;
  }
  calls.delete(call_id);
  if (!calls.size) {
    registry.delete(chat_id);
  }
  pending.detach();
  pending.resolve(decision);
  return true;
};

export const wait_for_decision = (chat_id: string, call_id: string, signal: AbortSignal): Promise<ApprovalDecision> =>
  new Promise<ApprovalDecision>((resolve) => {
    if (signal.aborted) {
      resolve(denied());
      return;
    }
    const on_abort = () => settle(chat_id, call_id, denied());
    const detach = () => signal.removeEventListener("abort", on_abort);
    chat_map(chat_id).set(call_id, { resolve, detach });
    signal.addEventListener("abort", on_abort, { once: true });
  });

export const resolve_decision = (chat_id: string, call_id: string, decision: ApprovalDecision): boolean =>
  settle(chat_id, call_id, decision);

export const cancel_chat = (chat_id: string): void => {
  const calls = registry.get(chat_id);
  if (!calls) {
    return;
  }
  for (const [call_id, pending] of [...calls]) {
    calls.delete(call_id);
    pending.detach();
    pending.resolve(denied());
  }
  registry.delete(chat_id);
};
