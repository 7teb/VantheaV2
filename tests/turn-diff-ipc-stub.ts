import type { DiffScope, TurnDiffChange } from "../shared/turn-diff.ts";

export const calls: [string, unknown[]][] = [];

export const known_chats = new Set<string>(["chat-1"]);

let forward: ((change: TurnDiffChange) => void) | null = null;

export const chat_meta = (chat_id: string) => (known_chats.has(chat_id) ? { id: chat_id } : null);

export const fire_change = (change: TurnDiffChange) => forward?.(change);

export const turn_diffs = {
  listen: (listener: (change: TurnDiffChange) => void) => {
    forward = listener;
    return () => undefined;
  },
  summaries: async (chat_id: string, scopes: DiffScope[]) => {
    calls.push(["summaries", [chat_id, scopes]]);
    return scopes.map(() => ({ kind: "none" }));
  },
  file: async (chat_id: string, scope: DiffScope, path: string) => {
    calls.push(["file", [chat_id, scope, path]]);
    return { kind: "unchanged" };
  },
};
