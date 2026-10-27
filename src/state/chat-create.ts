import type { CommandOrigin } from "../../shared/chat.ts";
import { api } from "../api/bridge.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { init_turn } from "./chat-actions.ts";
import { draft_key, move_draft, restore_draft, set_error, type OutgoingMessage } from "./chat-drafts.ts";
import { composer_store, set_sending } from "./composer.ts";
import { adopt_files } from "./files.ts";
import { adopt_git } from "./git.ts";
import { adopt_terminals } from "./terminal.ts";
import { open_chat } from "./ui.ts";
import { clear_worktree_choice, worktree_choice } from "./worktree.ts";

const error_text = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const create_chat = async (project_path: string, key: string, message: OutgoingMessage | null, worktree: boolean): Promise<string | null> => {
  set_sending(key, true);
  try {
    const meta = worktree ? await api.invoke("worktrees:create_chat", project_path, message?.text ?? "") : await api.invoke("chats:create", project_path);
    composer_store.update((state) => move_draft(state, key, meta.id));
    if (!worktree) {
      adopt_terminals(key, meta.id);
    }
    adopt_files(key, meta.id);
    adopt_git(key, meta.id);
    clear_worktree_choice(key);
    open_chat(meta.id, meta.project_path);
    return meta.id;
  } catch (error) {
    console.error(`[composer] ${worktree ? "worktrees:create_chat" : "chats:create"} failed for project ${project_path}`, error);
    composer_store.update((state) => set_error(message ? restore_draft(state, key, message) : state, key, error_text(error)));
    return null;
  } finally {
    set_sending(key, false);
  }
};

const command_labels: Record<CommandOrigin, MessageKey> = { init: "commands.init", git_init: "commands.git_init", review: "commands.review" };

export const start_command_turn = async (chat_id: string | null, project_path: string, command: CommandOrigin, argument: string | null = null) => {
  const key = draft_key(chat_id, project_path);
  if (composer_store.get().sending[key]) {
    return;
  }
  const reviews_changes = command === "review" && argument === null;
  const target = chat_id ?? (await create_chat(project_path, key, null, worktree_choice(key) && !reviews_changes));
  if (target === null) {
    return;
  }
  set_sending(target, true);
  const result = await init_turn(target, command, argument);
  set_sending(target, false);
  if (!result.ok) {
    composer_store.update((state) => set_error(state, target, t("commands.failed", { action: t(command_labels[command]), error: result.error })));
  }
};
