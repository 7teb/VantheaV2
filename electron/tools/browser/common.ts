import type { ToolView } from "../../../shared/tool-view.ts";
import { error_text } from "../../browser/state.ts";
import { ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";

export const read_string = (raw: Record<string, unknown>, key: string): string | null => {
  const value = raw[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new ToolArgumentError(`${key} must be a string`);
  }
  return value;
};

export const require_string = (raw: Record<string, unknown>, key: string): string => {
  const value = read_string(raw, key);
  if (value === null) {
    throw new ToolArgumentError(`${key} is required`);
  }
  return value;
};

export const read_boolean = (raw: Record<string, unknown>, key: string, fallback: boolean): boolean => {
  const value = raw[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new ToolArgumentError(`${key} must be a boolean`);
  }
  return value;
};

export const read_number = (raw: Record<string, unknown>, key: string): number | null => {
  const value = raw[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolArgumentError(`${key} must be a number`);
  }
  return value;
};

export const read_choice = <T extends string>(raw: Record<string, unknown>, key: string, choices: readonly T[], fallback: T | null): T => {
  const value = read_string(raw, key);
  if (value === null) {
    if (fallback === null) {
      throw new ToolArgumentError(`${key} is required, one of ${choices.join(", ")}`);
    }
    return fallback;
  }
  if (!choices.includes(value as T)) {
    throw new ToolArgumentError(`${key} must be one of ${choices.join(", ")}`);
  }
  return value as T;
};

export const browser_view = (action: string, url: string, title: string, detail: string): ToolView => ({ kind: "browser", action, url, title, detail });

export const done = (text: string, view: ToolView): ToolResult => ({ status: "done", text, view });

export const guarded = async (ctx: ToolContext, action: string, work: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await work();
  } catch (error) {
    if (ctx.signal.aborted) {
      throw error;
    }
    const message = error_text(error);
    console.warn(`[browser] ${action} failed: ${message}`);
    return { status: "failed", text: message, view: browser_view(action, "", "", message) };
  }
};
