import { matcher_mode, matcher_targets, type HookEvent, type HookScope, type MatcherTarget } from "../../../shared/hooks.ts";
import type { ProjectEntry } from "../../../shared/settings.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { project_path_label } from "../sidebar/sidebar-model.ts";

export type MatcherText = { text: string; all: boolean };

const event_keys: Record<HookEvent, MessageKey> = {
  UserPromptSubmit: "hooks.event_user_prompt_submit",
  PreToolUse: "hooks.event_pre_tool_use",
  PostToolUse: "hooks.event_post_tool_use",
  PostToolUseFailure: "hooks.event_post_tool_use_failure",
  Stop: "hooks.event_stop",
  StopFailure: "hooks.event_stop_failure",
  SubagentStart: "hooks.event_subagent_start",
  SubagentStop: "hooks.event_subagent_stop",
};

const matcher_labels: Record<MatcherTarget, MessageKey> = {
  tool: "hooks.matcher_label_tool",
  agent: "hooks.matcher_label_agent",
  error: "hooks.matcher_label_error",
};

const matcher_alls: Record<MatcherTarget, MessageKey> = {
  tool: "hooks.matcher_all_tool",
  agent: "hooks.matcher_all_agent",
  error: "hooks.matcher_all_error",
};

export const event_label = (t: Translate, event: HookEvent): string => t(event_keys[event]);

export const matcher_label = (t: Translate, event: HookEvent): string | null => {
  const target = matcher_targets[event];
  return target ? t(matcher_labels[target]) : null;
};

export const matcher_all = (t: Translate, event: HookEvent): string => {
  const target = matcher_targets[event];
  return target ? t(matcher_alls[target]) : "";
};

export const matcher_text = (t: Translate, event: HookEvent, matcher: string): MatcherText | null => {
  if (matcher_targets[event] === null) {
    return null;
  }
  return matcher_mode(matcher) === "all" ? { text: matcher_all(t, event), all: true } : { text: matcher, all: false };
};

export const scope_text = (t: Translate, scope: HookScope, projects: ProjectEntry[]): string =>
  scope.kind === "global" ? t("hooks.scope_global") : project_path_label(projects, scope.path);

export const seconds_text = (t: Translate, seconds: number): string => t("hooks.seconds", { n: seconds });
