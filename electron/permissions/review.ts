import path from "node:path";
import type { ToolContext } from "../tools/types.ts";
import { permission_intent } from "./context.ts";
import type { CommandInput } from "./decide.ts";

export const command_input = async (ctx: ToolContext, command: string, cwd: string, background: boolean): Promise<CommandInput> => ({
  command,
  background,
  mode: ctx.mode,
  project_root: ctx.project_root,
  cwd: path.resolve(ctx.project_root || ".", cwd || "."),
  authorization: permission_intent(ctx),
  delegated_task: ctx.delegated_task,
  decisions: (await ctx.human_decisions?.()) ?? [],
});
