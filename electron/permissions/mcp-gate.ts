import type { ToolContext } from "../tools/types.ts";
import { decide_command, type CommandDecision } from "./decide.ts";
import { command_input } from "./review.ts";
import { command_sleep_reason } from "./sleep.ts";

export const mcp_command_gate = async (
  command: string,
  ctx: ToolContext,
): Promise<(Pick<CommandDecision, "action" | "reason"> & { unavailable?: boolean }) | { action: "deny"; reason: string }> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, command);
  if (sleep) {
    return { action: "deny", reason: sleep };
  }
  const input = await command_input(ctx, command, ctx.execution_cwd || ".", false);
  const decision = await decide_command(input, ctx.side_model, ctx.signal);
  return { action: decision.action, reason: decision.reason, ...(decision.source === "unavailable" ? { unavailable: true } : {}) };
};
