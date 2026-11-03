import { randomUUID } from "node:crypto";
import { hook_fields, type Hook, type HookFields, type HookScope, type ScopedHook } from "../../shared/hooks.ts";
import type { SettingsView } from "../../shared/settings.ts";
import { chat_meta } from "../chats/store.ts";
import { get_settings, update_settings } from "../settings/store.ts";
import { chat_scopes, locate_hook, scope_hooks, scoped_hooks, with_scope_hooks } from "./scope.ts";

export type SavedHook = { hook: ScopedHook; view: SettingsView };

export const chat_project = (chat_id: string): string => chat_meta(chat_id)?.project_path ?? "";

export const chat_hooks = (project_path: string): ScopedHook[] => scoped_hooks(get_settings().hooks, chat_scopes(project_path));

export const find_hook = (id: string): ScopedHook | null => locate_hook(get_settings().hooks, id);

const missing = (id: string) => new Error(`no hook with id ${id}`);

export const save_hook = async (scope: HookScope, fields: HookFields, id: string | null): Promise<SavedHook> => {
  const config = get_settings().hooks;
  const existing = id === null ? null : locate_hook(config, id);
  if (id !== null && !existing) {
    throw missing(id);
  }
  const hook: Hook = { id: id ?? randomUUID(), ...fields };
  const target = scope_hooks(config, scope);
  const in_place = existing !== null && target.some((entry) => entry.id === hook.id);
  const without = existing && !in_place ? with_scope_hooks(config, existing.scope, scope_hooks(config, existing.scope).filter((entry) => entry.id !== hook.id)) : config;
  const hooks = in_place ? target.map((entry) => (entry.id === hook.id ? hook : entry)) : [...scope_hooks(without, scope), hook];
  const next = with_scope_hooks(without, scope, hooks);
  const view = await update_settings({ hooks: next });
  const saved = locate_hook(view.hooks, hook.id);
  if (!saved) {
    throw new Error(`hook ${hook.id} was not kept after saving; settings.json rejected it`);
  }
  return { hook: saved, view };
};

export const remove_hook = async (id: string): Promise<SettingsView> => {
  const config = get_settings().hooks;
  const existing = locate_hook(config, id);
  if (!existing) {
    throw missing(id);
  }
  return update_settings({ hooks: with_scope_hooks(config, existing.scope, scope_hooks(config, existing.scope).filter((entry) => entry.id !== id)) });
};

export const set_hook_enabled = async (id: string, enabled: boolean): Promise<SettingsView> => {
  const existing = find_hook(id);
  if (!existing) {
    throw missing(id);
  }
  return (await save_hook(existing.scope, { ...hook_fields(existing), enabled }, id)).view;
};
