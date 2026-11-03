import type { HookFields, HookScope } from "../../shared/hooks.ts";
import { api } from "../api/bridge.ts";
import { settings_store } from "./settings.ts";

export const save_hook = async (scope: HookScope, fields: HookFields, id: string | null): Promise<void> => {
  settings_store.set(await api.invoke("hooks:save", scope, fields, id));
};

export const remove_hook = async (id: string): Promise<void> => {
  settings_store.set(await api.invoke("hooks:remove", id));
};

export const set_hook_enabled = async (id: string, enabled: boolean): Promise<void> => {
  settings_store.set(await api.invoke("hooks:set_enabled", id, enabled));
};
