import type { GrantScope, McpTier, OverseerVerdict } from "../../../shared/approval.ts";
import { shell_candidates } from "../../mcp/risk.ts";
import { permission_hash, permission_intent } from "../../permissions/context.ts";
import { rejected_text } from "../../permissions/sleep.ts";
import type { ToolContext } from "../types.ts";

export type CommandGate = (command: string, ctx: ToolContext) => Promise<{ action: "run" | "ask" | "block" | "deny"; reason: string }>;

export type Overseer = (call: McpCall, ctx: ToolContext) => Promise<OverseerVerdict>;

export type McpCall = { server: string; tool: string; tier: McpTier; args: Record<string, unknown>; scope: string | null; trusted: boolean };

export type Verdict = { kind: "run" } | { kind: "ask"; reason: string } | { kind: "block" | "denied"; reason: string };

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
    const reason = "The command inside this MCP tool could not be identified for review.";
    if (ctx.mode === "auto") return { kind: "denied", reason };
    return ctx.mode === "full" ? run : ask("This MCP tool runs a shell or system command and needs your approval.");
  }
  if (!command_gate) {
    return { kind: "block", reason: "The command policy is not initialized, shell MCP tools cannot run." };
  }
  const gate = await command_gate(candidates.join("\n"), ctx);
  if (gate.action === "block") return { kind: "block", reason: "Blocked by the command policy: " + gate.reason };
  if (gate.action === "deny") return { kind: "denied", reason: rejected_text(gate.reason) };
  if (gate.action === "run") return run;
  if (ctx.mode === "auto") return { kind: "denied", reason: rejected_text(gate.reason) };
  return ask(gate.reason);
};

export const decide = async (call: McpCall, ctx: ToolContext, overseer: Overseer): Promise<Verdict> => {
  if (call.tier === "shell_system") return shell_verdict(call, ctx);
  if ((call.trusted && ctx.mode === "full") || has_grant(ctx, call)) return run;
  if (call.tier === "dangerous" && !call.trusted) return ask("Dangerous MCP tool (memory write, patch, inject or execute), needs your approval.");
  if (ctx.mode === "full") return run;
  if (ctx.mode === "ask") return ask("MCP tool, needs your approval in ask mode.");
  const verdict = await overseer(call, ctx);
  return verdict.safe ? run : { kind: "denied", reason: rejected_text(verdict.reason) };
};
