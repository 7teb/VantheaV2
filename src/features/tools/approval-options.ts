import type { AgentTextTool, ApprovalRequest, GrantScope } from "../../../shared/approval.ts";
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

const agent_questions: Record<AgentTextTool, MessageKey> = {
  message_peer: "approval.question_agent_message",
  message_agent: "approval.question_agent_message",
  deploy_agent: "approval.question_agent_deploy",
  continue_agent: "approval.question_agent_continue",
};

export const grant_options = (request: ApprovalRequest): GrantOption[] => {
  switch (request.kind) {
    case "command":
      return request.grant_prefix ? [once, { grant: "prefix", label: "approval.prefix", vars: { x: request.grant_prefix } }] : [once];
    case "mcp":
      return mcp_options(request);
    case "write":
    case "mcp_server":
    case "skill_install":
    case "memory":
    case "agent_message":
      return [once];
  }
};

export const approval_question = (request: ApprovalRequest): { key: MessageKey; vars: MessageVars } => {
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
    case "agent_message":
      return { key: agent_questions[request.tool], vars: { x: request.to_name } };
  }
};
