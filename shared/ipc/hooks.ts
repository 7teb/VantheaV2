import type { HookFields, HookScope } from "../hooks.ts";
import type { SettingsView } from "../settings.ts";
import { invoke } from "./channel.ts";

export const hooks_channels = {
  "hooks:save": invoke<[scope: HookScope, fields: HookFields, id: string | null], SettingsView>(),
  "hooks:remove": invoke<[id: string], SettingsView>(),
  "hooks:set_enabled": invoke<[id: string, enabled: boolean], SettingsView>(),
} as const;
