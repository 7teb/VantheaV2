import type { ModelCatalog } from "../models.ts";
import type { Balance, ProjectEntry, SecretName, SettingsPatch, SettingsView } from "../settings.ts";
import { emit, invoke } from "./channel.ts";

export const settings_channels = {
  "settings:get": invoke<[], SettingsView>(),
  "settings:update": invoke<[patch: SettingsPatch], SettingsView>(),
  "settings:set_secret": invoke<[name: SecretName, value: string], SettingsView>(),
  "settings:balance": invoke<[], Balance | null>(),
  "settings:changed": emit<SettingsView>(),
  "models:catalog": invoke<[], ModelCatalog>(),
  "projects:choose": invoke<[], ProjectEntry | null>(),
  "projects:create": invoke<[], ProjectEntry | null>(),
  "projects:update": invoke<[path: string, patch: Partial<Pick<ProjectEntry, "name" | "pinned">>], SettingsView>(),
  "projects:remove": invoke<[path: string], SettingsView>(),
  "projects:open": invoke<[path: string], void>(),
} as const;
