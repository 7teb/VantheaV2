import type { ToolContext } from "../tools/types.ts";
import { decide_command } from "./decide.ts";
import { command_input, report_permission, review_matches } from "./review.ts";

export const mcp_command_gate = async (command: string, ctx: ToolContext): Promise<"run" | "ask" | "block"> => {
  const input = command_input(ctx, command);
  const decision = await decide_command(input, ctx.side_model, ctx.signal);
  report_permission(ctx, decision);
  ctx.execution_check = () => review_matches(ctx, command, input.cwd!, decision);
  if (decision.action !== "run") return decision.action;
  if (await review_matches(ctx, command, input.cwd!, decision)) return "run";
  ctx.permission?.({ action: "deny", source: "changed", reason: "The reviewed context changed before the MCP command could run.", ...decision.context });
  return "ask";
};
