import { secret_read_subject, type SecretRead } from "../../../shared/approval.ts";
import { tool_gate } from "../../permissions/tool-gate.ts";
import { not_approved_text, note_reason } from "../../permissions/verdict-text.ts";
import { is_secret_path } from "../../../shared/secret-path.ts";
import type { ToolContext, ToolResult } from "../types.ts";

export const secret_read_refused = async (ctx: ToolContext, read: SecretRead): Promise<ToolResult | null> => {
  if (!is_secret_path(read.path)) {
    return null;
  }
  const gate = await tool_gate(ctx, read.tool, secret_read_subject(read));
  if (gate.kind === "run") {
    return null;
  }
  if (gate.kind === "denied") {
    return { status: "denied", text: gate.text, view: null };
  }
  const decision = await ctx.approve({ kind: "secret_read", ...read, ...(gate.note ? { review: gate.note } : {}) });
  if (decision.approved) {
    return null;
  }
  return { status: "denied", text: not_approved_text("tool call", decision, note_reason(gate.note)), view: null };
};
