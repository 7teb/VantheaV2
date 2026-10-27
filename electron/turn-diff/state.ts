import type { Message } from "../../shared/chat.ts";
import type { TurnDiffChange } from "../../shared/turn-diff.ts";
import { chat_paths, type ChatPaths } from "./paths.ts";

export type TurnDiffDeps = {
  root: string;
  messages: (chat_id: string) => Promise<Message[] | null>;
  chat_root: (chat_id: string) => Promise<string>;
  running_turn: (chat_id: string) => string | null;
  chat_known: (chat_id: string) => Promise<boolean>;
};

let deps: TurnDiffDeps | null = null;

let shutting_down = false;

const removed = new Set<string>();

const listeners = new Set<(change: TurnDiffChange) => void>();

export const set_deps = (next: TurnDiffDeps): void => {
  deps = next;
  shutting_down = false;
  removed.clear();
};

export const current_deps = (): TurnDiffDeps => {
  if (!deps) throw new Error("turn diffs were used before init_turn_diffs ran");
  return deps;
};

export const paths_of = (chat_id: string): ChatPaths => chat_paths(current_deps().root, chat_id);

export const inactive = (chat_id: string): boolean => deps === null || shutting_down || removed.has(chat_id);

export const mark_removed = (chat_id: string): void => {
  removed.add(chat_id);
};

export const mark_shutting_down = (): boolean => {
  const first = !shutting_down;
  shutting_down = true;
  return first;
};

export const listen = (listener: (change: TurnDiffChange) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const announce = (chat_id: string): void => {
  if (inactive(chat_id)) return;
  for (const listener of listeners) {
    try {
      listener({ chat_id });
    } catch (error) {
      console.error(`[turn-diff] a listener for changes of chat ${chat_id} failed:`, error);
    }
  }
};
