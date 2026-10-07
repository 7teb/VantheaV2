import { ToolArgumentError } from "../types.ts";

export const read_string_list = (raw: Record<string, unknown>, key: string, max: number): string[] => {
  const value = raw[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ToolArgumentError(`${key} must be a list of strings`);
  }
  if (value.length > max) {
    throw new ToolArgumentError(`${key} takes at most ${max} entries`);
  }
  return value.map((entry: string) => entry.trim()).filter(Boolean);
};
