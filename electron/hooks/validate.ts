import {
  default_hook_timeout_s,
  empty_hooks,
  hook_events,
  hook_id_pattern,
  matcher_error,
  max_hook_timeout_s,
  type Hook,
  type HookFields,
  type HookScope,
  type HooksConfig,
} from "../../shared/hooks.ts";
import { shell_kinds } from "../../shared/shell.ts";
import { is_record, require_record } from "../storage/coerce.ts";
import { path_key } from "../storage/paths.ts";

const max_command_chars = 20_000;

const max_matcher_chars = 500;

const max_project_key = 1000;

export const parse_hook_fields = (raw: unknown): HookFields => {
  const record = require_record(raw, "hook");
  const event = hook_events.find((entry) => entry === record.event);
  if (!event) {
    throw new Error(`event must be one of ${hook_events.join(", ")}, got ${JSON.stringify(record.event)?.slice(0, 80)}`);
  }
  const matcher = record.matcher ?? "";
  if (typeof matcher !== "string" || matcher.length > max_matcher_chars) {
    throw new Error(`matcher must be a string of at most ${max_matcher_chars} characters`);
  }
  const pattern_error = matcher_error(matcher);
  if (pattern_error) {
    throw new Error(`matcher is not a valid pattern: ${pattern_error}`);
  }
  const shell = shell_kinds.find((entry) => entry === record.shell);
  if (!shell) {
    throw new Error(`shell must be one of ${shell_kinds.join(", ")}, got ${JSON.stringify(record.shell)?.slice(0, 80)}`);
  }
  const command = typeof record.command === "string" ? record.command.trim() : "";
  if (!command || command.length > max_command_chars) {
    throw new Error(`command must be a non-empty string of at most ${max_command_chars} characters`);
  }
  const timeout_s = record.timeout_s ?? default_hook_timeout_s;
  if (typeof timeout_s !== "number" || !Number.isInteger(timeout_s) || timeout_s < 1 || timeout_s > max_hook_timeout_s) {
    throw new Error(`timeout_s must be a whole number from 1 to ${max_hook_timeout_s}`);
  }
  const enabled = record.enabled ?? true;
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  return { event, matcher, shell, command, timeout_s, enabled };
};

export const parse_hook_id = (raw: unknown): string => {
  if (typeof raw !== "string" || !hook_id_pattern.test(raw)) {
    throw new Error(`hook id must match ${hook_id_pattern.source}, got ${JSON.stringify(raw)?.slice(0, 80)}`);
  }
  return raw;
};

export const parse_hook_scope = (raw: unknown, project_path_of: (path: string) => string | null): HookScope => {
  const record = require_record(raw, "hook scope");
  if (record.kind === "global") {
    return { kind: "global" };
  }
  if (record.kind !== "project" || typeof record.path !== "string") {
    throw new Error(`hook scope must be { kind: "global" } or { kind: "project", path }`);
  }
  const path = project_path_of(record.path);
  if (!path) {
    throw new Error(`hook scope names ${record.path.slice(0, 200)}, which is not a project in the project list`);
  }
  return { kind: "project", path };
};

const scope_hooks = (value: unknown, label: string, seen: Set<string>): Hook[] => {
  if (!Array.isArray(value)) {
    console.error(`[hooks] the ${label} hooks in settings.json are not a list, dropping them`);
    return [];
  }
  return value.flatMap((entry): Hook[] => {
    const id = is_record(entry) ? entry.id : undefined;
    try {
      const parsed_id = parse_hook_id(id);
      if (seen.has(parsed_id)) {
        throw new Error("the id is used by another hook");
      }
      const fields = parse_hook_fields(entry);
      seen.add(parsed_id);
      return [{ id: parsed_id, ...fields }];
    } catch (error) {
      console.error(`[hooks] dropping ${label} hook ${JSON.stringify(id)?.slice(0, 80)} from settings.json:`, error);
      return [];
    }
  });
};

export const normalize_hooks = (value: unknown, fallback: HooksConfig = empty_hooks()): HooksConfig => {
  if (!is_record(value)) {
    return fallback;
  }
  const seen = new Set<string>();
  const global = scope_hooks(value.global === undefined ? fallback.global : value.global, "global", seen);
  const raw_projects = value.projects === undefined ? fallback.projects : value.projects;
  if (!is_record(raw_projects)) {
    console.error("[hooks] the project hooks in settings.json are not an object, dropping them");
    return { global, projects: {} };
  }
  const projects: Record<string, Hook[]> = {};
  const keys = new Map<string, string>();
  for (const [project, list] of Object.entries(raw_projects)) {
    if (!project.trim() || project.length > max_project_key) {
      console.error(`[hooks] dropping project hooks under an invalid project path ${JSON.stringify(project.slice(0, 200))}`);
      continue;
    }
    const hooks = scope_hooks(list, `project ${project}`, seen);
    const key = keys.get(path_key(project)) ?? project;
    keys.set(path_key(project), key);
    projects[key] = [...(projects[key] ?? []), ...hooks];
  }
  return { global, projects: Object.fromEntries(Object.entries(projects).filter(([, hooks]) => hooks.length > 0)) };
};
