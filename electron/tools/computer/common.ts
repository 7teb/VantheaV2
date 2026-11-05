import { get_computer } from "../../computer/service.ts";
import type { ComputerAction } from "../../computer/control.ts";
import { read_number } from "../browser/common.ts";
import { ToolArgumentError, type ToolContext, type ToolResult } from "../types.ts";

export const number_arg = (raw: Record<string, unknown>, key: string): number => {
  const value = read_number(raw, key);
  if (value === null) throw new ToolArgumentError(`${key} is required and must be finite`);
  return value;
};

export const point_args = (raw: Record<string, unknown>) => ({ x: number_arg(raw, "x"), y: number_arg(raw, "y") });

export const run_computer = (ctx: ToolContext, action: ComputerAction): Promise<ToolResult> => {
  if (ctx.profile !== "main" || !ctx.model.vision || process.platform !== "win32") return Promise.resolve({ status: "denied", text: "Computer use requires Windows and a main agent with a vision model outside plan mode.", view: null });
  return get_computer().run(ctx, action);
};
