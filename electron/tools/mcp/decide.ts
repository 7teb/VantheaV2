import type { ReviewNote, ReviewRecord } from "../../../shared/review.ts";
import { has_grant, type GrantTarget } from "../../mcp/grants.ts";
import { shell_candidates } from "../../mcp/risk.ts";
import { review_and_record } from "../../permissions/command-review.ts";
import type { CommandDecision } from "../../permissions/decide.ts";
import { effective_mode } from "../../permissions/full-window.ts";
import type { PinChange, ScriptPin } from "../../permissions/source-read.ts";
import type { CallReview } from "../../permissions/tool-gate.ts";
import type { ToolContext } from "../types.ts";

export type CommandGate = (command: string, ctx: ToolContext, changed: PinChange[]) => Promise<CommandDecision>;

export type McpCall = GrantTarget & { args: Record<string, unknown>; trusted: boolean };

export type McpReview = (call: McpCall, ctx: ToolContext, granted: boolean) => Promise<CallReview>;

export type Verdict =
  | { kind: "run"; pins: ScriptPin[]; record: ReviewRecord | null }
  | { kind: "ask"; reason: string; note: ReviewNote | null; pins: ScriptPin[]; record: ReviewRecord | null }
  | { kind: "block"; reason: string }
  | { kind: "denied"; reason: string };

let command_gate: CommandGate | null = null;

export const set_command_gate = (fn: CommandGate) => {
  command_gate = fn;
};

export const decision_tool = (call: Pick<McpCall, "server" | "tool">) => `mcp:${call.server}/${call.tool}`;

const run: Verdict = { kind: "run", pins: [], record: null };

const ask = (reason: string, note: ReviewNote | null = null, pins: ScriptPin[] = [], record: ReviewRecord | null = null): Verdict => ({ kind: "ask", reason, note, pins, record });

const shell_verdict = async (call: McpCall, ctx: ToolContext, changed: PinChange[]): Promise<Verdict> => {
  const candidates = shell_candidates(call.args);
  if (!candidates.length) {
    return ask("The command inside this MCP tool could not be identified for review.");
  }
  if (!command_gate) {
    return { kind: "block", reason: "The command policy is not initialized, shell MCP tools cannot run." };
  }
  const gate = await command_gate(candidates.join("\n"), ctx, changed);
  if (gate.action === "block") {
    return { kind: "block", reason: `Blocked by the command policy: ${gate.reason}` };
  }
  if (gate.action === "deny") {
    return { kind: "denied", reason: gate.reason };
  }
  return gate.action === "run" ? { kind: "run", pins: gate.pins, record: gate.record } : ask("", gate.note, gate.pins, gate.record);
};

const model_verdict = async (call: McpCall, ctx: ToolContext, review: McpReview): Promise<Verdict> => {
  const granted = has_grant(ctx.chat_id, call);
  const result = await review_and_record(ctx, () => review(call, ctx, granted));
  if (result.record.verdict === "allow") {
    return { kind: "run", pins: [], record: result.record };
  }
  return result.record.verdict === "deny" ? { kind: "denied", reason: result.text } : ask("", result.note, [], result.record);
};

export const decide = async (call: McpCall, ctx: ToolContext, review: McpReview, changed: PinChange[] = []): Promise<Verdict> => {
  const mode = effective_mode(ctx.chat_id, ctx.mode);
  if (call.tier === "shell_system") {
    return shell_verdict(call, ctx, changed);
  }
  if (mode === "full") {
    return call.trusted || call.tier !== "dangerous" || has_grant(ctx.chat_id, call) ? run : ask("Dangerous MCP tool (memory write, patch, inject or execute), needs your approval.");
  }
  if (mode === "ask") {
    return has_grant(ctx.chat_id, call) ? run : ask("Ask mode confirms every MCP tool call.");
  }
  return model_verdict(call, ctx, review);
};
