import type { ApprovalDecision } from "../../../shared/approval.ts";
import { error_text } from "../../storage/coerce.ts";
import { ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";

export const failed = (text: string): ToolResult => ({ status: "failed", text, view: null });

export const denied = (what: string, decision: ApprovalDecision): ToolResult => ({
  status: "denied",
  text: `The user denied ${what}.${decision.feedback ? ` User feedback: ${decision.feedback}` : ""}`,
  view: null,
});

export const guarded = async (ctx: ToolContext, tool: string, work: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await work();
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    const message = error_text(error);
    console.warn(`[tools] ${tool} in ${ctx.project_root} failed: ${message}`);
    return failed(message);
  }
};

const value_kind = (value: unknown) => {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : typeof value;
};

export const read_text_arg = (raw: Record<string, unknown>, key: string): string => {
  const value = raw[key];
  if (typeof value !== "string") {
    throw new ToolArgumentError(`${key} must be a string with the exact text, got ${value_kind(value)}`);
  }
  return value;
};

export const read_int_arg = (raw: Record<string, unknown>, key: string, min: number, max: number): number | null => {
  const value = raw[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolArgumentError(`${key} must be a whole number`);
  }
  if (value < min || value > max) {
    throw new ToolArgumentError(`${key} must be between ${min} and ${max}`);
  }
  return value;
};

export const format_size = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
