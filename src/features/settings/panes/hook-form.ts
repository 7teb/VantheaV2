import {
  default_hook_timeout_s,
  hook_fields,
  matcher_error,
  matcher_targets,
  max_hook_timeout_s,
  type HookEvent,
  type HookFields,
  type HookScope,
  type ScopedHook,
} from "../../../../shared/hooks.ts";
import type { ProjectEntry } from "../../../../shared/settings.ts";
import type { ShellKind } from "../../../../shared/shell.ts";
import type { Translate } from "../../../i18n/translate.ts";
import { normalize_path } from "../../sidebar/sidebar-model.ts";

export const global_scope = "global";

export type HookDraft = { event: HookEvent; matcher: string; shell: ShellKind; command: string; timeout: string; enabled: boolean; scope: string };

export type DraftProblems = { matcher: string | null; timeout: string | null; ready: boolean };

export const empty_draft: HookDraft = {
  event: "PreToolUse",
  matcher: "",
  shell: "powershell",
  command: "",
  timeout: String(default_hook_timeout_s),
  enabled: true,
  scope: global_scope,
};

const scope_value = (hook: ScopedHook, projects: ProjectEntry[]): string => {
  if (hook.scope.kind === "global") {
    return global_scope;
  }
  const path = hook.scope.path;
  return projects.find((entry) => normalize_path(entry.path) === normalize_path(path))?.path ?? path;
};

export const hook_draft = (hook: ScopedHook, projects: ProjectEntry[]): HookDraft => {
  const fields = hook_fields(hook);
  return { ...fields, timeout: String(fields.timeout_s), scope: scope_value(hook, projects) };
};

export const draft_scope = (draft: HookDraft): HookScope => (draft.scope === global_scope ? { kind: "global" } : { kind: "project", path: draft.scope });

const timeout_value = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= max_hook_timeout_s ? value : null;
};

export const draft_fields = (draft: HookDraft): HookFields => ({
  event: draft.event,
  matcher: matcher_targets[draft.event] === null ? "" : draft.matcher.trim(),
  shell: draft.shell,
  command: draft.command.trim(),
  timeout_s: timeout_value(draft.timeout) ?? default_hook_timeout_s,
  enabled: draft.enabled,
});

export const draft_problems = (t: Translate, draft: HookDraft): DraftProblems => {
  const pattern = matcher_targets[draft.event] === null ? null : matcher_error(draft.matcher.trim());
  const matcher = pattern ? t("hooks.matcher_invalid", { x: pattern }) : null;
  const timeout = timeout_value(draft.timeout) === null ? t("hooks.timeout_invalid", { n: max_hook_timeout_s }) : null;
  return { matcher, timeout, ready: draft.command.trim() !== "" && matcher === null && timeout === null };
};
