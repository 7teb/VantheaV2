import path from "node:path";
import type { ToolContext } from "../tools/types.ts";
import { permission_intent } from "./context.ts";
import { command_context, prepare_command_review, type CommandDecision, type CommandInput } from "./decide.ts";

export const command_input = (ctx: ToolContext, command: string, cwd = ctx.execution_cwd || "."): CommandInput => ({
  command, mode: ctx.mode, chat_id: ctx.chat_id, project_root: ctx.project_root, intent: permission_intent(ctx),
  cwd: path.resolve(ctx.project_root || ".", cwd), delegated_task: ctx.delegated_task,
});

export const report_permission = (ctx: ToolContext, decision: CommandDecision): void => {
  ctx.permission?.({ action: decision.action, source: decision.source, reason: decision.reason, ...decision.context });
};

export const review_matches = async (ctx: ToolContext, command: string, cwd: string, decision: CommandDecision): Promise<boolean> => {
  ctx.signal.throwIfAborted();
  const input = command_input(ctx, command, cwd);
  if (command_context(input, "").authorization_hash !== decision.context.authorization_hash || path.resolve(input.cwd!) !== decision.context.cwd) return false;
  if (decision.source === "full") return true;
  const { context } = await prepare_command_review(input);
  ctx.signal.throwIfAborted();
  return context.source_hash === decision.context.source_hash && context.command_hash === decision.context.command_hash;
};
