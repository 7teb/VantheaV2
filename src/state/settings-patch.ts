import type { Settings, SettingsPatch } from "../../shared/settings.ts";

const is_plain_object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const apply_settings_patch = <T extends Settings>(current: T, patch: SettingsPatch): T => {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const existing = next[key];
    next[key] = is_plain_object(value) && is_plain_object(existing) ? { ...existing, ...value } : value;
  }
  return next as T;
};
