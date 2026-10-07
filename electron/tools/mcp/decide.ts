import type { GrantScope, McpTier, OverseerVerdict } from "../../../shared/approval.ts";
import { shell_candidates } from "../../mcp/risk.ts";
import { permission_hash, permission_intent } from "../../permissions/context.ts";
import type { ToolContext } from "../types.ts";

export type CommandGate = (command: string, ctx: ToolContext) => Promise<"run" | "ask" | "block">;

export type Overseer = (call: McpCall, ctx: ToolContext) => Promise<OverseerVerdict>;

export type McpCall = { server: string; tool: string; tier: McpTier; args: Record<string, unknown>; scope: string | null; trusted: boolean };

export type Verdict = { kind: "run" } | { kind: "ask"; reason: string } | { kind: "block"; reason: string };

let command_gate: CommandGate | null = null;

const chat_grants = new Map<string, Map<string, string>>();

export const set_command_gate = (fn: CommandGate) => {
  command_gate = fn;
};

export const clear_mcp_chat = (chat_id: string) => {
  chat_grants.delete(chat_id);
};

const run: Verdict = { kind: "run" };

const ask = (reason: string): Verdict => ({ kind: "ask", reason });

const covering_keys = (call: McpCall): string[] => {
  const { server, tool } = call;
  if (call.tier === "readonly") {
    return [`readonly:${server}`, `state:${server}`, `dangerous:${server}`];
  }
  if (call.tier === "state_change") {
    return [`tool:${server}/${tool}`, `state:${server}`, `dangerous:${server}`];
  }
  if (call.tier === "dangerous") {
    return [...(call.scope ? [`scope:${server}/${tool}|${call.scope}`] : []), `dangerous:${server}`];
  }
  return [];
};

const granted_key = (call: McpCall, grant: GrantScope): string | null => {
  const { server, tool } = call;
  if (grant !== "chat" && grant !== "session") {
    return null;
  }
  if (call.tier === "readonly") {
    return `readonly:${server}`;
  }
  if (call.tier === "state_change") {
    return grant === "chat" ? `tool:${server}/${tool}` : `state:${server}`;
  }
  if (call.tier === "dangerous") {
    if (grant === "session") {
      return `dangerous:${server}`;
    }
    return call.scope ? `scope:${server}/${tool}|${call.scope}` : null;
  }
  return null;
};

const grant_context = (ctx: ToolContext, call: McpCall) => permission_hash(permission_intent(ctx) + (ctx.delegated_task ?? "") + (ctx.execution_cwd ?? "") + JSON.stringify(call.args));

const has_grant = (ctx: ToolContext, call: McpCall) => {
  const grants = chat_grants.get(ctx.chat_id);
  return Boolean(grants && covering_keys(call).some((key) => grants.get(key) === grant_context(ctx, call) || (!ctx.authorization && grants.get(key) === "")));
};

export const record_grant = (chat_id: string, call: McpCall, grant: GrantScope, ctx?: ToolContext) => {
  const key = granted_key(call, grant);
  if (!key) {
    return;
  }
  const grants = chat_grants.get(chat_id) ?? new Map<string, string>();
  grants.set(key, ctx ? grant_context(ctx, call) : "");
  chat_grants.set(chat_id, grants);
};

const shell_verdict = async (call: McpCall, ctx: ToolContext): Promise<Verdict> => {
  const candidates = shell_candidates(call.args);
  if (!candidates.length) {
    return ctx.mode === "full" ? run : ask("This MCP tool runs a shell or system command and needs your approval.");
  }
  if (!command_gate) {
    return { kind: "block", reason: "The command policy is not initialized, shell MCP tools cannot run." };
  }
  const gate = await command_gate(candidates.join("\n"), ctx);
  if (gate === "block") {
    return { kind: "block", reason: "Blocked by the command policy: this MCP tool would run a command that is never allowed." };
  }
  return gate === "run" ? run : ask("This MCP tool runs a shell or system command and needs your approval.");
};

export const decide = async (call: McpCall, ctx: ToolContext, overseer: Overseer): Promise<Verdict> => {
  const finish = (value: Verdict, source: "full" | "grant" | "mode" | "model", reason: string): Verdict => {
    ctx.permission?.({ action: value.kind === "run" ? "run" : value.kind, source, reason, cwd: ctx.execution_cwd || ctx.project_root,
      authorization_hash: grant_context(ctx, call), source_hash: permission_hash(JSON.stringify(call.args)), command_hash: permission_hash(call.server + "/" + call.tool) });
    return value;
  };
  if (call.tier === "shell_system") return shell_verdict(call, ctx);
  if ((call.trusted && ctx.mode === "full") || has_grant(ctx, call)) return finish(run, "grant", "A matching user approval covers this MCP call.");
  if (call.tier === "dangerous" && !call.trusted) return finish(ask("Dangerous MCP tool (memory write, patch, inject or execute), needs your approval."), "mode", "Dangerous MCP effects need explicit user approval.");
  if (ctx.mode === "full") return finish(run, "full", "The user selected full access.");
  if (ctx.mode === "ask") return finish(ask("MCP tool, needs your approval in ask mode."), "mode", "Ask mode requires user approval.");
  const verdict = await overseer(call, ctx);
  return finish(verdict.safe ? run : ask("Auto-mode overseer flagged this MCP tool: " + verdict.reason), "model", verdict.reason);
};
