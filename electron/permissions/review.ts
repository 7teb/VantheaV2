import path from "node:path";
import { chat_meta } from "../chats/store.ts";
import { get_settings } from "../settings/store.ts";
import type { ToolContext } from "../tools/types.ts";
import { last_human_id } from "./context.ts";
import type { CommandInput } from "./decide.ts";
import { effective_mode } from "./full-window.ts";
import type { PinChange } from "./source-read.ts";

const chat_start = (chat_id: string): number => {
  const started = Date.parse(chat_meta(chat_id)?.created_at ?? "");
  return Number.isFinite(started) ? started : Date.now();
};

export const command_input = async (ctx: ToolContext, command: string, cwd: string, background: boolean, changed: PinChange[] = []): Promise<CommandInput> => ({
  command,
  background,
  mode: effective_mode(ctx.chat_id, ctx.mode),
  project_root: ctx.project_root,
  cwd: path.resolve(ctx.project_root || ".", cwd || "."),
  plan: ctx.profile === "plan",
  chat_id: ctx.chat_id,
  chat_started_at: chat_start(ctx.chat_id),
  call_id: ctx.call_id,
  profile: ctx.profile,
  custom_instructions: get_settings().custom_instructions,
  delegated_task: ctx.delegated_task,
  decisions: (await ctx.human_decisions?.()) ?? [],
  last_human_id: last_human_id(ctx.chat_id),
  changed,
});
