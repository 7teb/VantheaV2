import type { ToolStep } from "../../../shared/chat.ts";
import { is_shell_run } from "../../../shared/shell.ts";
import type { PeerOutcome, ToolView } from "../../../shared/tool-view.ts";
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

export const step_duration = (step: ToolStep): number | null =>
  step.started_at !== null && step.ended_at !== null ? Math.max(0, step.ended_at - step.started_at) : null;

const kept_peer_outcomes: Partial<Record<PeerOutcome, MessageKey>> = {
  not_running: "tools.peer_outcome_not_running",
  duplicate: "tools.peer_outcome_duplicate",
};

const grep_detail = (t: Translate, view: Extract<ToolView, { kind: "grep" }>): string => {
  if (view.incomplete) {
    return t("tools.grep_incomplete", { n: view.total });
  }
  if (view.truncated) {
    return t("tools.grep_capped", { n: view.total });
  }
  return view.total === 0 ? t("tools.grep_no_matches") : "";
};

export const step_detail = (t: Translate, step: ToolStep, live: LiveStatus = unknown_status): string => {
  const view = step.view;
  switch (view?.kind) {
    case "grep":
      return grep_detail(t, view);
    case "mcp":
      return view.is_error ? t("tools.mcp_error") : "";
    case "peer_message": {
      const key = kept_peer_outcomes[view.outcome];
      return key ? t(key) : "";
    }
    case "background":
      return is_shell_run(step.name) ? "" : row_status_label(t, background_status_label, view.status, live);
    case "agent":
      return row_status_label(t, agent_status_label, view.status, live);
    case "text":
      return step.name === "datetime" ? view.text : "";
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

const combine_keys: Record<ToolCategory, [MessageKey, MessageKey]> = {
  commands: ["tools.combine_commands_one", "tools.combine_commands_other"],
  reads: ["tools.combine_reads_one", "tools.combine_reads_other"],
  listings: ["tools.combine_listings_one", "tools.combine_listings_other"],
  searches: ["tools.combine_searches_one", "tools.combine_searches_other"],
  edits: ["tools.combine_edits_one", "tools.combine_edits_other"],
  browser: ["tools.combine_browser_one", "tools.combine_browser_other"],
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
  messages: ["tools.combine_messages_one", "tools.combine_messages_other"],
  skills: ["tools.combine_skills_one", "tools.combine_skills_other"],
  todos: ["tools.combine_todos_one", "tools.combine_todos_other"],
  web: ["tools.combine_web_one", "tools.combine_web_other"],
  memory: ["tools.combine_memory_one", "tools.combine_memory_other"],
  images: ["tools.combine_images_one", "tools.combine_images_other"],
  questions: ["tools.combine_questions_one", "tools.combine_questions_other"],
  visuals: ["tools.combine_visuals_one", "tools.combine_visuals_other"],
  other: ["tools.combine_other_one", "tools.combine_other_other"],
};

export const group_label = (t: Translate, steps: ToolStep[]): string => {
  const order: ToolCategory[] = [];
  const buckets = new Map<ToolCategory, ToolStep[]>();
  for (const step of steps) {
    const category = tool_meta(step).category;
    const bucket = buckets.get(category);
    if (bucket) {
      bucket.push(step);
      continue;
    }
    order.push(category);
    buckets.set(category, [step]);
  }
  const parts = order.map((category) => {
    const bucket = buckets.get(category) ?? [];
    const n = bucket_count(category, bucket);
    const [one, other] = combine_keys[category];
    return t(n === 1 ? one : other, { n });
  });
  const joined = parts.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
};

export const group_current = (steps: ToolStep[]): ToolStep | null =>
  steps.find((step) => step.status === "running" || step.status === "awaiting_approval") ??
  steps.findLast((step) => step.status === "drafting") ??
  steps.find((step) => step.status === "queued") ??
  null;
