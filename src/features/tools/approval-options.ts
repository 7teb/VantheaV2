import { full_mode_covers, full_window_minutes, review_unavailable, type ApprovalRequest, type GrantScope } from "../../../shared/approval.ts";
import type { MessageKey, MessageVars } from "../../i18n/translate.ts";

export type GrantOption = { grant: GrantScope; label: MessageKey; vars: MessageVars };

const once: GrantOption = { grant: "once", label: "approval.yes", vars: {} };

const mcp_options = (request: Extract<ApprovalRequest, { kind: "mcp" }>): GrantOption[] => {
  switch (request.tier) {
    case "readonly":
      return [once, { grant: "chat", label: "approval.allow_readonly", vars: { x: request.server } }];
    case "state_change":
      return [once, { grant: "chat", label: "approval.allow_chat", vars: {} }];
    case "dangerous":
      return [
        once,
        ...(request.scope ? [{ grant: "chat" as const, label: "approval.allow_scope" as const, vars: {} }] : []),
        { grant: "session", label: "approval.trust_session", vars: { x: request.server } },
      ];
    case "shell_system":
      return [once];
  }
};

const scoped_options = (request: ApprovalRequest): GrantOption[] => {
  switch (request.kind) {
    case "command":
      return request.grant_prefix ? [once, { grant: "prefix", label: "approval.prefix", vars: { x: request.grant_prefix } }] : [once];
    case "mcp":
      return mcp_options(request);
    case "browser_vision":
      return [once, { grant: "chat", label: "approval.allow_browser_vision_chat", vars: {} }];
    case "write":
    case "mcp_server":
    case "skill_install":
    case "memory":
      return [once];
  }
};

const full_window: GrantOption = { grant: "full_window", label: "approval.full_window", vars: { n: full_window_minutes } };

export const grant_options = (request: ApprovalRequest): GrantOption[] =>
  review_unavailable(request) && full_mode_covers(request) ? [...scoped_options(request), full_window] : scoped_options(request);

export type ApprovalKeySource = "option" | "feedback" | "other";

type ApprovalKeyAction ="submit" | "deny" | "next" | "previous" | null;

type ApprovalKey = { key: string; shift: boolean; composing: boolean; source: ApprovalKeySource };

export const approval_key_action = ({ key, shift, composing, source }: ApprovalKey): ApprovalKeyAction => {
  if (key === "Enter") {
    return !shift && !composing && source !== "other" ? "submit" : null;
  }
  if (source === "feedback") {
    return null;
  }
  switch (key) {
    case "Escape":
      return "deny";
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    default:
      return null;
  }
};

export const approval_question =(request: ApprovalRequest): { key: MessageKey; vars: MessageVars } => {
  switch (request.kind) {
    case "command":
      return { key: "approval.question_command", vars: {} };
    case "write":
      return { key: "approval.question_write", vars: { x: request.path } };
    case "mcp":
      return { key: "approval.question_mcp", vars: { x: `${request.server} · ${request.tool}` } };
    case "mcp_server":
      return { key: "approval.question_add_mcp", vars: { x: request.name } };
    case "skill_install":
      return { key: "approval.question_skill", vars: {} };
    case "memory":
      return { key: request.action === "forget" ? "approval.question_forget" : "approval.question_remember", vars: {} };
    case "browser_vision":
      return { key: "approval.question_browser_vision", vars: {} };
  }
};
