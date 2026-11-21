import type { ApprovalPolicy } from "../../shared/api/contract.ts";
import type { PermissionMode } from "../../shared/chat.ts";
import type { ModelChoice } from "../../shared/models.ts";

export type RunOptions = { mode: PermissionMode; choice: ModelChoice; approvals: ApprovalPolicy };

export const reject_feedback = "This run has no one to approve actions, so the request was rejected. Continue without this action.";

const pinned = new Map<string, RunOptions>();

export const set_run_options = (chat_id: string, options: RunOptions): void => {
  pinned.set(chat_id, options);
};

export const run_options = (chat_id: string): RunOptions | null => pinned.get(chat_id) ?? null;

export const forget_run_options = (chat_id: string): void => {
  pinned.delete(chat_id);
};
