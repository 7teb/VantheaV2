import type { ApprovalRequest } from "../../../shared/approval.ts";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { not_approved_text } from "../../permissions/verdict-text.ts";
import type { TextGate, ToolContext } from "../types.ts";

export const agent_text_subject = (header: string[], text: string): string =>
  [...header, "----- BEGIN TEXT WRITTEN BY THE AGENT -----", text, "----- END TEXT WRITTEN BY THE AGENT -----"].join("\n");

export type AgentCard = Omit<Extract<ApprovalRequest, { kind: "agent_message" }>, "kind" | "review">;

export const agent_text_gate = async (ctx: ToolContext, card: AgentCard, subject: string): Promise<TextGate> => {
  const gate = await tool_gate(ctx, card.tool, subject, { review_in_ask: true });
  if (gate.kind === "run") {
    return { kind: "pass" };
  }
  if (gate.kind === "denied") {
    return { kind: "denied", text: gate.text, reason: gate.reason };
  }
  const decision = await ctx.approve({ kind: "agent_message", ...card, ...(gate.note ? { review: gate.note } : {}) });
  if (decision.approved) {
    return { kind: "pass" };
  }
  const model_reason = gate.note?.source === "model" && gate.note.reason ? gate.note.reason : null;
  return { kind: "declined", text: not_approved_text("tool call", decision, model_reason) };
};
