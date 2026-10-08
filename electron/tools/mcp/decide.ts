import type { GrantScope, McpTier, OverseerVerdict } from "../../../shared/approval.ts";
import { shell_candidates } from "../../mcp/risk.ts";
import { permission_hash, permission_intent } from "../../permissions/context.ts";
import { denial_reason, last_decision_for, repeated_denial_text } from "../../permissions/decisions.ts";
import { rejected_text } from "../../permissions/sleep.ts";
import type { ToolContext } from "../types.ts";

export type CommandGate = (command: string, ctx: ToolContext) => Promise<{ action: "run" | "ask" | "block" | "deny"; reason: string }>;

export type Overseer = (call: McpCall, ctx: ToolContext) => Promise<OverseerVerdict>;

export type McpCall = { server: string; tool: string; tier: McpTier; args: Record<string, unknown>; scope: string | null; trusted: boolean };

export type Verdict = { kind: "run" } | { kind: "ask"; reason: string } | { kind: "block" | "denied"; reason: string };

const preview_limit = 2000;

let command_gate: CommandGate | null = null;

const chat_grants = new Map<string, Set<string>>();

export const set_command_gate = (fn: CommandGate) => {
  command_gate = fn;
};

export const clear_mcp_chat = (chat_id: string) => {
  chat_grants.delete(chat_id);
};

export const args_preview = (args: Record<string, unknown>) => {
  const text = JSON.stringify(args, null, 2);
  return text.length > preview_limit ? `${text.slice(0, preview_limit)}\n...` : text;
};

export const decision_tool = (call: Pick<McpCall, "server" | "tool">) => `mcp:${call.server}/${call.tool}`;

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

const has_grant = (chat_id: string, call: McpCall) => {
  const grants = chat_grants.get(chat_id);
  return Boolean(grants && covering_keys(call).some((key) => grants.has(key)));
};

export const record_grant = (chat_id: string, call: McpCall, grant: GrantScope) => {
  const key = granted_key(call, grant);
  if (!key) {
    return;
  }
  const grants = chat_grants.get(chat_id) ?? new Set<string>();
  grants.add(key);
  chat_grants.set(chat_id, grants);
};

const shell_verdict = async (call: McpCall, ctx: ToolContext): Promise<Verdict> => {
  const candidates = shell_candidates(call.args);
  if (!candidates.length) {
    return ask("The command inside this MCP tool could not be identified for review.");
  }
  if (!command_gate) {
    return { kind: "block", reason: "The command policy is not initialized, shell MCP tools cannot run." };
  }
  const gate = await command_gate(candidates.join("\n"), ctx);
  if (gate.action === "block") {
    return { kind: "block", reason: `Blocked by the command policy: ${gate.reason}` };
  }
  if (gate.action === "deny") {
    return { kind: "denied", reason: rejected_text(gate.reason) };
  }
  return gate.action === "run" ? run : ask(gate.reason);
};

export const decide = async (call: McpCall, ctx: ToolContext, overseer: Overseer): Promise<Verdict> => {
  if (ctx.mode !== "full") {
    const previous = last_decision_for((await ctx.human_decisions?.()) ?? [], [decision_tool(call)], args_preview(call.args));
    if (previous && !previous.approved) {
      if (previous.context_hash === permission_hash(permission_intent(ctx))) {
        return { kind: "denied", reason: repeated_denial_text(previous) };
      }
      return ask(denial_reason(previous));
    }
  }
  if (call.tier === "shell_system") {
    return shell_verdict(call, ctx);
  }
  if (ctx.mode === "full" && (call.trusted || call.tier !== "dangerous")) {
    return run;
  }
  if (has_grant(ctx.chat_id, call)) {
    return run;
  }
  if (call.tier === "dangerous" && !call.trusted) {
    return ask("Dangerous MCP tool (memory write, patch, inject or execute), needs your approval.");
  }
  if (ctx.mode === "ask") {
    return ask("Ask mode confirms every MCP tool call.");
  }
  if (call.tier === "readonly") {
    return run;
  }
  const intent = permission_intent(ctx);
  let verdict = await overseer(call, ctx);
  if (verdict.safe && permission_intent(ctx) !== intent) {
    verdict = await overseer(call, ctx);
  }
  return verdict.safe ? run : ask(verdict.reason);
};
