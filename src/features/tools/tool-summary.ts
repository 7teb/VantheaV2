import type { ToolStep } from "../../../shared/chat.ts";
import type { ToolView } from "../../../shared/tool-view.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import { base_name, is_active_status, page_detail, tool_meta, view_of, type ToolCategory } from "./tool-meta.ts";

export const format_duration = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

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

type CommandView = Extract<ToolView, { kind: "command" }>;

const command_ran = (view: CommandView) => view.exit_code !== null || view.timed_out;

const command_outcome = (t: Translate, view: CommandView): string => {
  if (view.timed_out) {
    return t("tools.timed_out");
  }
  return view.exit_code !== null && view.exit_code !== 0 ? t("tools.exit_code", { n: view.exit_code }) : "";
};

const view_detail = (t: Translate, view: ToolView): string => {
  switch (view.kind) {
    case "files":
      return [
        t(view.files.length === 1 ? "tools.file_count_one" : "tools.file_count_other", { n: view.files.length }),
        t(view.directories === 1 ? "tools.folder_count_one" : "tools.folder_count_other", { n: view.directories }),
      ].join(", ");
    case "read":
      if (view.end_line <= 0) {
        return "";
      }
      return view.end_line < view.total_lines ? `${view.start_line}-${view.end_line} / ${view.total_lines}` : `${view.start_line}-${view.end_line}`;
    case "grep":
      if (view.truncated) {
        return t("tools.grep_capped", { n: view.total });
      }
      return view.total > 0 ? t("tools.grep_matches", { n: view.total }) : t("tools.grep_no_matches");
    case "outline":
      return t("tools.symbols_count", { n: view.symbols.length });
    case "models":
      return t("tools.models_count", { n: view.models.length });
    case "edit":
      return `+${view.added} -${view.removed}`;
    case "command":
      return [command_outcome(t, view), command_ran(view) && view.output === "" ? t("tools.no_output") : ""].filter(Boolean).join(" · ");
    case "background":
    case "agent":
      return view.status;
    case "peer_message":
      return t(`tools.peer_outcome_${view.outcome}`);
    case "todos":
      return `${view.todos.filter((todo) => todo.status === "done").length}/${view.todos.length}`;
    case "web_search":
      return t("tools.sources_count", { n: view.sources.length });
    case "image":
      return t("tools.images_count", { n: view.images.length });
    case "mcp":
      return view.is_error ? t("tools.mcp_error") : "";
    case "memory":
      return view.action === "list" && view.text === "" ? t("tools.memory_none") : "";
    case "browser":
    case "plan":
    case "questions":
    case "skill":
    case "text":
      return "";
  }
};

type Detail = (t: Translate, step: ToolStep) => string;

const text_of = (step: ToolStep) => view_of(step, "text")?.text ?? "";

const page_url: Detail = (_t, step) => {
  const view = view_of(step, "browser");
  return view?.title && view.title !== view.url ? view.url : "";
};

const page_state: Detail = (t, step) => [page_url(t, step), page_detail(step) === "loading" ? t("tools.browser_loading") : ""].filter(Boolean).join(" · ");

const image_folder: Detail = (_t, step) => {
  const text = text_of(step);
  return text.slice(0, text.length - base_name(text).length).replace(/[\\/]+$/, "");
};

const no_detail: Detail = () => "";

const named_details: Record<string, Detail> = {
  datetime: (_t, step) => text_of(step),
  view_image: image_folder,
  read_skill: (_t, step) => (typeof step.args.file === "string" ? step.args.file : ""),
  browser_tab: page_url,
  browser_navigate: page_state,
  browser_click: no_detail,
  browser_type: no_detail,
  browser_key: no_detail,
  browser_click_point: no_detail,
  browser_visual_click: no_detail,
};

export const step_detail = (t: Translate, step: ToolStep): string => {
  if (is_active_status(step.status)) {
    return step.progress?.label ?? "";
  }
  if (!step.view) {
    return "";
  }
  return named_details[step.name]?.(t, step) ?? (step.view.kind === "browser" ? page_detail(step) : view_detail(t, step.view));
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

export const group_duration = (steps: ToolStep[]): number | null => {
  const starts = steps.flatMap((step) => (step.started_at === null ? [] : [step.started_at]));
  const ends = steps.flatMap((step) => (step.ended_at === null ? [] : [step.ended_at]));
  if (starts.length === 0 || ends.length === 0) {
    return null;
  }
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
};
