import type { ShellKind } from "./shell.ts";

export type HookEvent = "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Stop" | "StopFailure" | "SubagentStart" | "SubagentStop";

export const hook_events: readonly HookEvent[] = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "StopFailure", "SubagentStart", "SubagentStop"];

export type MatcherTarget = "tool" | "agent" | "error";

export const matcher_targets: Record<HookEvent, MatcherTarget | null> = {
  UserPromptSubmit: null,
  PreToolUse: "tool",
  PostToolUse: "tool",
  PostToolUseFailure: "tool",
  Stop: null,
  StopFailure: "error",
  SubagentStart: "agent",
  SubagentStop: "agent",
};

export type HookFields = { event: HookEvent; matcher: string; shell: ShellKind; command: string; timeout_s: number; enabled: boolean };

export type Hook = HookFields & { id: string };

export type HooksConfig = { global: Hook[]; projects: Record<string, Hook[]> };

export type HookScope = { kind: "global" } | { kind: "project"; path: string };

export type ScopedHook = Hook & { scope: HookScope };

export type HookAction = "create" | "change" | "enable" | "disable" | "delete";

export const default_hook_timeout_s = 60;

export const max_hook_timeout_s = 3600;

export const hook_id_pattern = /^[A-Za-z0-9_-]{1,64}$/;

export const empty_hooks = (): HooksConfig => ({ global: [], projects: {} });

export const hook_fields = (hook: HookFields): HookFields => ({
  event: hook.event,
  matcher: hook.matcher,
  shell: hook.shell,
  command: hook.command,
  timeout_s: hook.timeout_s,
  enabled: hook.enabled,
});

export const changed_fields = (hook: HookFields, previous: HookFields): (keyof HookFields)[] =>
  (Object.keys(hook_fields(hook)) as (keyof HookFields)[]).filter((key) => hook[key] !== previous[key]);

export type MatcherMode = "all" | "names" | "pattern";

const name_list = /^[A-Za-z0-9_\-\s,|]*$/;

export const matcher_mode = (matcher: string): MatcherMode => {
  const trimmed = matcher.trim();
  if (trimmed === "" || trimmed === "*") {
    return "all";
  }
  return name_list.test(matcher) ? "names" : "pattern";
};

export const matcher_error = (matcher: string): string | null => {
  if (matcher_mode(matcher) !== "pattern") {
    return null;
  }
  try {
    new RegExp(matcher);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

export const matcher_matches = (matcher: string, value: string): boolean => {
  const mode = matcher_mode(matcher);
  if (mode === "all") {
    return true;
  }
  if (mode === "names") {
    return matcher
      .split(/[|,]/)
      .map((name) => name.trim())
      .includes(value);
  }
  return matcher_error(matcher) === null && new RegExp(matcher).test(value);
};

export const hook_applies = (hook: HookFields, event: HookEvent, target: string | null): boolean =>
  hook.enabled && hook.event === event && (matcher_targets[event] === null || target === null || matcher_matches(hook.matcher, target));
