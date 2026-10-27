import type { WorktreeEligibility, WorktreeHead, WorktreeTarget, WorktreeWork } from "../../shared/ipc/worktrees.ts";
import { api } from "../api/bridge.ts";
import { ipc_error_text } from "../features/settings/panes/ipc-error.ts";
import { on_turn_end } from "./chat-view.ts";
import { chats_store } from "./chats.ts";
import { create_store } from "./create-store.ts";
import { reload_files_root, watch_files } from "./files.ts";
import { ui_store } from "./ui.ts";
import { window_store } from "./window.ts";

export type EligibilityLoad = { status: "loading" } | { status: "ready"; value: WorktreeEligibility };

export type WorkLoad = { status: "loading" } | { status: "ready"; work: WorktreeWork[] } | { status: "failed" };

export type WorktreeState = {
  choices: Record<string, true>;
  eligibility: Record<string, EligibilityLoad>;
  heads: Record<string, WorktreeHead>;
  work: Record<string, WorkLoad>;
  restoring: Record<string, true>;
  restore_errors: Record<string, string>;
};

export const worktree_store = create_store<WorktreeState>({ choices: {}, eligibility: {}, heads: {}, work: {}, restoring: {}, restore_errors: {} });

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));

const head_tickets = new Map<string, number>();
let head_seq = 0;

export const worktree_choice = (key: string): boolean => worktree_store.get().choices[key] === true;

export const toggle_worktree = (key: string) =>
  worktree_store.update((state) => ({ ...state, choices: state.choices[key] ? without(state.choices, key) : { ...state.choices, [key]: true } }));

export const clear_worktree_choice = (key: string) => {
  if (worktree_choice(key)) {
    worktree_store.update((state) => ({ ...state, choices: without(state.choices, key) }));
  }
};

export const load_eligibility = async (project_path: string) => {
  if (worktree_store.get().eligibility[project_path] === undefined) {
    worktree_store.update((state) => ({ ...state, eligibility: { ...state.eligibility, [project_path]: { status: "loading" } } }));
  }
  let value: WorktreeEligibility;
  try {
    value = await api.invoke("worktrees:eligibility", project_path);
  } catch (error) {
    console.error(`[worktree] worktrees:eligibility failed for project ${project_path}`, error);
    value = { kind: "failed", error: ipc_error_text(error) };
  }
  worktree_store.update((state) => ({ ...state, eligibility: { ...state.eligibility, [project_path]: { status: "ready", value } } }));
};

export const load_head = async (chat_id: string) => {
  head_seq += 1;
  const ticket = head_seq;
  head_tickets.set(chat_id, ticket);
  try {
    const head = await api.invoke("worktrees:head", chat_id);
    if (head_tickets.get(chat_id) === ticket) {
      worktree_store.update((state) => ({ ...state, heads: { ...state.heads, [chat_id]: head } }));
    }
  } catch (error) {
    console.error(`[worktree] worktrees:head failed for chat ${chat_id}`, error);
  }
};

export const work_key = (target: WorktreeTarget): string => JSON.stringify(target);

export const load_work = async (target: WorktreeTarget) => {
  const key = work_key(target);
  worktree_store.update((state) => ({ ...state, work: { ...state.work, [key]: { status: "loading" } } }));
  try {
    const work = await api.invoke("worktrees:work", target);
    worktree_store.update((state) => ({ ...state, work: { ...state.work, [key]: { status: "ready", work } } }));
  } catch (error) {
    console.error(`[worktree] worktrees:work failed for ${key}`, error);
    worktree_store.update((state) => ({ ...state, work: { ...state.work, [key]: { status: "failed" } } }));
  }
};

export const restore_worktree = async (chat_id: string) => {
  if (worktree_store.get().restoring[chat_id]) {
    return;
  }
  worktree_store.update((state) => ({ ...state, restoring: { ...state.restoring, [chat_id]: true }, restore_errors: without(state.restore_errors, chat_id) }));
  try {
    await api.invoke("worktrees:restore", chat_id);
    await Promise.all([load_head(chat_id), reload_files_root()]);
    watch_files();
  } catch (error) {
    console.error(`[worktree] worktrees:restore failed for chat ${chat_id}`, error);
    worktree_store.update((state) => ({ ...state, restore_errors: { ...state.restore_errors, [chat_id]: ipc_error_text(error) } }));
  } finally {
    worktree_store.update((state) => ({ ...state, restoring: without(state.restoring, chat_id) }));
  }
};

const has_worktree = (chat_id: string) => chats_store.get().list.some((chat) => chat.id === chat_id && chat.worktree !== undefined);

export const init_worktree = (): (() => void) => {
  const stop_ends = on_turn_end((chat_id) => {
    if (has_worktree(chat_id)) {
      void load_head(chat_id);
    }
  });
  let focused = window_store.get()?.focused ?? true;
  const stop_focus = window_store.subscribe(() => {
    const now = window_store.get()?.focused ?? true;
    const regained = now && !focused;
    focused = now;
    const active = ui_store.get().active_chat_id;
    if (regained && active !== null && has_worktree(active)) {
      void load_head(active);
    }
  });
  return () => {
    stop_ends();
    stop_focus();
  };
};
