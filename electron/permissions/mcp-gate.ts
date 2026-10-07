import type { ToolContext } from "../tools/types.ts";
import { decide_command, type CommandDecision } from "./decide.ts";
import { command_input, review_matches } from "./review.ts";
import { command_sleep_reason } from "./sleep.ts";

export const mcp_command_gate = async (command: string, ctx: ToolContext): Promise<Pick<CommandDecision, "action" | "reason"> | { action: "deny"; reason: string }> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, command);
  if (sleep) return { action: "deny", reason: sleep };
  const input = command_input(ctx, command);
  const decision = await decide_command(input, ctx.side_model, ctx.signal);
  ctx.execution_check = () => review_matches(ctx, command, input.cwd!, decision);
  if (decision.action !== "run" || await review_matches(ctx, command, input.cwd!, decision)) {
    return { action: decision.action, reason: decision.reason };
  }
  return { action: "ask", reason: "The reviewed context changed before the MCP command could run." };
};
