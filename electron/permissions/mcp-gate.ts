import type { ToolContext } from "../tools/types.ts";
import { command_pass } from "./command-review.ts";
import type { CommandDecision } from "./decide.ts";
import { command_sleep_reason, rejected_text } from "./sleep.ts";
import type { PinChange } from "./source-read.ts";

export const mcp_command_gate = async (command: string, ctx: ToolContext, changed: PinChange[]): Promise<CommandDecision> => {
  ctx.signal.throwIfAborted();
  const sleep = command_sleep_reason(ctx, command);
  if (sleep) {
    return { action: "deny", reason: rejected_text(sleep), record: null, note: null, grant_prefix: null, plan: false, pins: [], source_hash: "", seen: new Set() };
  }
  return command_pass(ctx, { command, cwd: ctx.execution_cwd || ".", background: false }, changed);
};
