import type { ApprovalPolicy, SessionOptions } from "../../shared/api/contract.ts";
import { permission_modes, type PermissionMode } from "../../shared/chat.ts";
import { catalog_choice, model_listing, type ModelChoice } from "../../shared/models.ts";
import type { RunOptions } from "../turn/run-options.ts";
import { optional_choice, optional_text, RequestError } from "./body.ts";
import type { ApiContext } from "./router.ts";

export const default_mode: PermissionMode = "auto";

export const default_approvals: ApprovalPolicy = "reject";

const approval_policies: readonly ApprovalPolicy[] = ["reject", "client"];

const sessions = new Map<string, SessionOptions>();

export const parse_session_options = async (context: ApiContext, raw: Record<string, unknown>): Promise<SessionOptions> => {
  const model = optional_text(raw, "model", 300);
  const effort = optional_text(raw, "effort", 40);
  const mode = optional_choice(raw, "mode", permission_modes);
  const approvals = optional_choice(raw, "approvals", approval_policies);
  if (model !== undefined && !model_listing((await context.model_catalog()).models, model)) {
    throw new RequestError(400, "unknown_model", `the model ${model} is not in the model catalog`);
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
    ...(mode === undefined ? {} : { mode }),
    ...(approvals === undefined ? {} : { approvals }),
  };
};

export const remember_session_options = (chat_id: string, options: SessionOptions): void => {
  sessions.set(chat_id, options);
};

export const forget_session_options = (chat_id: string): void => {
  sessions.delete(chat_id);
};

const base_choice = (merged: SessionOptions, stored: ModelChoice | undefined, settings: { model: string; effort: string }): ModelChoice => {
  const effort = merged.effort ?? stored?.effort ?? settings.effort;
  if (merged.model !== undefined) {
    return { model: merged.model, effort, pro: false };
  }
  if (stored) {
    return { ...stored, effort };
  }
  return { model: settings.model, effort, pro: false };
};

export const resolve_run_options = async (context: ApiContext, chat_id: string, body: SessionOptions): Promise<RunOptions> => {
  const merged: SessionOptions = { ...sessions.get(chat_id), ...body };
  const base = base_choice(merged, context.session_meta(chat_id)?.choice, context.settings());
  return {
    mode: merged.mode ?? default_mode,
    choice: catalog_choice((await context.model_catalog()).models, base),
    approvals: merged.approvals ?? default_approvals,
  };
};
