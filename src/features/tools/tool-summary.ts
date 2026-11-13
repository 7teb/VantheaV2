import type { ToolStep } from "../../../shared/chat.ts";
import { is_shell_run } from "../../../shared/shell.ts";
import type { PeerOutcome } from "../../../shared/tool-view.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { agent_status_label, background_status_label, row_status_label, unknown_status, type LiveStatus } from "./background-status.ts";
import { tool_meta } from "./tool-meta.ts";
import type { ToolCategory } from "./tool-meta-types.ts";

export const format_seconds = (total: number): string => {
  if (total < 60) {
    return `${total}s`;
  }
  const parts: [number, string][] = [
    [Math.floor(total / 86400), "d"],
    [Math.floor(total / 3600) % 24, "h"],
    [Math.floor(total / 60) % 60, "m"],
    [total % 60, "s"],
  ];
  return parts
    .filter(([count]) => count > 0)
    .map(([count, unit]) => `${count}${unit}`)
    .join(" ");
};

export const format_duration = (ms: number): string => format_seconds(Math.max(1, Math.round(ms / 1000)));

export const format_elapsed = (ms: number): string | null => {
  const total = Math.floor(Math.max(ms, 0) / 1000);
  if (total < 1) {
    return null;
  }
  if (total < 60) {
    return `${total}s`;
  }
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
};

const kept_peer_outcomes: Partial<Record<PeerOutcome, MessageKey>> = {
  not_running: "tools.peer_outcome_not_running",
  duplicate: "tools.peer_outcome_duplicate",
};

const done_and_empty = (step: ToolStep, count: number): boolean => step.status === "done" && count === 0;

export const step_detail = (t: Translate, step: ToolStep, live: LiveStatus = unknown_status): string => {
  const view = step.view;
  switch (view?.kind) {
    case "grep":
      return done_and_empty(step, view.total) && !view.incomplete ? t("tools.grep_no_matches") : "";
    case "web_search":
      return done_and_empty(step, view.sources.length) && !view.urls?.length ? t("tools.web_no_results") : "";
    case "hooks":
      return done_and_empty(step, view.hooks.length) && view.action === "list" ? t("hooks.count_none") : "";
    case "scheduled_tasks":
      return done_and_empty(step, view.tasks.length) && view.action === "list" ? t("scheduled.count_none") : "";
    case "peer_message": {
      const key = kept_peer_outcomes[view.outcome];
      return key ? t(key) : "";
    }
    case "background":
      return is_shell_run(step.name) ? "" : row_status_label(t, background_status_label, view.status, live);
    case "agent":
      return live.status === "running" ? "" : row_status_label(t, agent_status_label, view.status, live);
    default:
      return "";
  }
};

export const step_hint = (step: ToolStep): string => {
  const view = step.view;
  if (view?.kind === "browser") {
    return [...new Set([view.title, view.url].filter(Boolean))].join("\n");
  }
  return view?.kind === "web_search" ? view.query : "";
};

const counted_categories = new Set<ToolCategory>(["reads", "listings", "edits", "agent_checks", "agent_stops", "task_checks", "task_stops"]);

const step_target = (step: ToolStep): string => {
  const view = step.view;
  if (view && (view.kind === "read" || view.kind === "edit" || view.kind === "outline")) {
    return view.path;
  }
  const target = step.args.path ?? step.args.agent_id ?? step.args.id;
  return typeof target === "string" ? target : step.id;
};

const bucket_count = (category: ToolCategory, bucket: ToolStep[]): number => {
  if (category === "questions") {
    return bucket.reduce((sum, step) => sum + (step.view?.kind === "questions" ? step.view.questions.length : 1), 0);
  }
  return counted_categories.has(category) ? new Set(bucket.map(step_target)).size : bucket.length;
};

type PhraseCategory = Exclude<ToolCategory, "listings" | "searches">;

const phrase_category = (category: ToolCategory): PhraseCategory => {
  if (category === "listings" || category === "searches") {
    return "reads";
  }

  return category;
};

const combine_keys: Record<PhraseCategory, [MessageKey, MessageKey]> = {
  commands: ["tools.combine_commands_one", "tools.combine_commands_other"],
  reads: ["tools.combine_reads_one", "tools.combine_reads_other"],
  edits: ["tools.combine_edits_one", "tools.combine_edits_other"],
  browser: ["tools.combine_browser_one", "tools.combine_browser_other"],
  computer: ["computer.combine_one", "computer.combine_other"],
  mcp: ["tools.combine_mcp_one", "tools.combine_mcp_other"],
  agents: ["tools.combine_agents_one", "tools.combine_agents_other"],
  agent_runs: ["tools.combine_agent_runs_one", "tools.combine_agent_runs_other"],
  agent_checks: ["tools.combine_agent_checks_one", "tools.combine_agent_checks_other"],
  agent_stops: ["tools.combine_agent_stops_one", "tools.combine_agent_stops_other"],
  workflows: ["workflow.combine_runs_one", "workflow.combine_runs_other"],
  workflow_stops: ["workflow.combine_stops_one", "workflow.combine_stops_other"],
  task_checks: ["tools.combine_task_checks_one", "tools.combine_task_checks_other"],
  task_stops: ["tools.combine_task_stops_one", "tools.combine_task_stops_other"],
  skill_installs: ["tools.combine_skill_installs_one", "tools.combine_skill_installs_other"],
  mcp_servers: ["tools.combine_mcp_servers_one", "tools.combine_mcp_servers_other"],
  tool_loads: ["tools.combine_tool_loads_one", "tools.combine_tool_loads_other"],
  messages: ["tools.combine_messages_one", "tools.combine_messages_other"],
  skills: ["tools.combine_skills_one", "tools.combine_skills_other"],
  todos: ["tools.combine_todos_one", "tools.combine_todos_other"],
  web: ["tools.combine_web_one", "tools.combine_web_other"],
  memory: ["tools.combine_memory_one", "tools.combine_memory_other"],
  hooks: ["hooks.combine_one", "hooks.combine_other"],
  scheduled: ["scheduled.combine_one", "scheduled.combine_other"],
  images: ["tools.combine_images_one", "tools.combine_images_other"],
  questions: ["tools.combine_questions_one", "tools.combine_questions_other"],
  visuals: ["tools.combine_visuals_one", "tools.combine_visuals_other"],
  other: ["tools.combine_other_one", "tools.combine_other_other"],
};

const single = (category: PhraseCategory, bucket: ToolStep[]): boolean => {
  if (category === "reads" && bucket.some((step) => tool_meta(step).category !== "reads")) {
    return false;
  }

  return bucket_count(category, bucket) === 1;
};

export const joined_phrases = (phrases: string[]): string => {
  const joined = phrases.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

export const group_phrases = (t: Translate, steps: ToolStep[]): string[] => {
  const order: PhraseCategory[] = [];
  const buckets = new Map<PhraseCategory, ToolStep[]>();
  for (const step of steps) {
    const category = phrase_category(tool_meta(step).category);
    const bucket = buckets.get(category);
    if (bucket) {
      bucket.push(step);
      continue;
    }

    order.push(category);
    buckets.set(category, [step]);
  }

  return order.map((category) => {
    const [one, other] = combine_keys[category];
    return t(single(category, buckets.get(category) ?? []) ? one : other);
  });
};

export const group_label = (t: Translate, steps: ToolStep[]): string => joined_phrases(group_phrases(t, steps));

export const fit_phrases = (phrases: string[], more: string, width: number, measure: (text: string) => number): string => {
  const full = joined_phrases(phrases);
  if (phrases.length < 2 || measure(full) <= width) {
    return full;
  }
  for (let count = phrases.length - 1; count >= 1; count -= 1) {
    const text = joined_phrases([...phrases.slice(0, count), more]);
    if (measure(text) <= width) {
      return text;
    }
  }
  const shortest = joined_phrases([phrases[0], more]);
  return measure(shortest) < measure(full) ? shortest : full;
};

export const group_current = (steps: ToolStep[]): ToolStep | null =>
  steps.find((step) => step.status === "running" || step.status === "awaiting_approval") ??
  steps.findLast((step) => step.status === "drafting") ??
  steps.find((step) => step.status === "queued") ??
  null;
