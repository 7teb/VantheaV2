import path from "node:path";
import { guarded_roots, is_headless } from "../app/runtime.ts";
import { chat_meta } from "../chats/store.ts";
import { get_settings } from "../settings/store.ts";
import { storage_paths } from "../storage/paths.ts";
import type { ToolContext } from "../tools/types.ts";
import { last_human_id } from "./context.ts";
import type { CommandInput } from "./decide.ts";
import { effective_mode } from "./full-window.ts";
import type { PinChange } from "./source-read.ts";
import type { Dialect } from "./statements.ts";

export const chat_start = (chat_id: string): number => {
  const started = Date.parse(chat_meta(chat_id)?.created_at ?? "");
  return Number.isFinite(started) ? started : Date.now();
};

const desktop_root = (): string[] => (is_headless() && process.env.APPDATA ? [path.join(process.env.APPDATA, "VantheaX")] : []);

export const command_input = async (ctx: ToolContext, command: string, cwd: string, background: boolean, shell: Dialect, changed: PinChange[] = []): Promise<CommandInput> => ({
  command,
  background,
  mode: effective_mode(ctx.chat_id, ctx.mode),
  app_roots: [storage_paths().user_data, ...guarded_roots(), ...desktop_root()],
  guard_writes: is_headless(),
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
  shell,
});
