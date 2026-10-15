import { create_store } from "./create-store.ts";

export const memories_panel_store = create_store<string | null>(null);

export const open_memories = (key: string) => memories_panel_store.set(key);

export const close_memories = (key: string) => memories_panel_store.update((open) => (open === key ? null : open));

export const toggle_memories = (key: string) => memories_panel_store.update((open) => (open === key ? null : key));
