import type { PermissionMode } from "../../shared/chat.ts";
import type { HookEvent } from "../../shared/hooks.ts";
import type { AgentProfile } from "../../shared/ipc/work.ts";
import { effective_mode } from "../permissions/full-window.ts";
import { error_text } from "../storage/coerce.ts";
import { tool_arguments } from "../tools/mcp/deferred.ts";
import type { Emitter } from "../turn/session.ts";

export type HookAgent = { id: string; name: string; profile: AgentProfile };

export type McpServerOf = (spec_name: string) => { name: string } | null;

export type HookIdentity = {
  chat_id: string;
  turn_id: string;
  cwd: string;
  project_path: string;
  mode: PermissionMode;
  plan: boolean;
  agent: HookAgent | null;
  emit: Emitter;
  signal: AbortSignal;
  mcp_server?: McpServerOf;
};

export type HookCall = { name: string; args: Record<string, unknown>; tool_use_id: string };

export type ToolTarget = { tool_name: string; tool_input: unknown; mcp_server?: { name: string } };

export const common_input = (identity: HookIdentity, event: HookEvent): Record<string, unknown> => ({
  session_id: identity.chat_id,
  turn_id: identity.turn_id,
  hook_event_name: event,
  cwd: identity.cwd,
  project_path: identity.project_path,
  permission_mode: effective_mode(identity.chat_id, identity.mode),
  plan_mode: identity.plan,
  agent_type: identity.agent?.profile ?? "main",
  ...(identity.agent ? { agent_id: identity.agent.id, agent_name: identity.agent.name } : {}),
});

const mcp_input = (args: Record<string, unknown>): unknown => {
  try {
    return tool_arguments(args.arguments ?? {});
  } catch (error) {
    console.warn(`[hooks] the arguments of an MCP call to ${String(args.name).slice(0, 120)} are not valid JSON, passing them as text: ${error_text(error)}`);
    return args.arguments;
  }
};

export const tool_target = (name: string, args: Record<string, unknown>, server_of: McpServerOf | undefined): ToolTarget => {
  if (name !== "call_mcp_tool" || typeof args.name !== "string") {
    return { tool_name: name, tool_input: args };
  }
  const server = server_of?.(args.name) ?? null;
  return { tool_name: args.name, tool_input: mcp_input(args), ...(server ? { mcp_server: server } : {}) };
};

