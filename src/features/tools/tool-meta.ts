import type { ToolStep } from "../../../shared/chat.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";

export type ToolIconName =
  | "terminal"
  | "background"
  | "file"
  | "files"
  | "search"
  | "outline"
  | "edit"
  | "todos"
  | "plan"
  | "web"
  | "image"
  | "agent"
  | "memory"
  | "skill"
  | "browser"
  | "mcp"
  | "clock"
  | "models"
  | "text";

export type ToolCategory =
  | "commands"
  | "reads"
  | "listings"
  | "searches"
  | "edits"
  | "browser"
  | "mcp"
  | "agents"
  | "agent_runs"
  | "agent_checks"
  | "agent_stops"
  | "task_checks"
  | "task_stops"
  | "skill_installs"
  | "mcp_servers"
  | "messages"
  | "skills"
  | "todos"
  | "web"
  | "memory"
  | "images"
  | "other";

type Label = (t: Translate, step: ToolStep) => string;

export type ToolMeta = { icon: ToolIconName; category: ToolCategory; active: Label; done: Label };

export const view_kinds = [
  "files",
  "read",
  "grep",
  "outline",
  "edit",
  "command",
  "background",
  "agent",
  "todos",
  "plan",
  "web_search",
  "image",
  "browser",
  "mcp",
  "memory",
  "skill",
  "models",
  "text",
] as const satisfies readonly ToolViewKind[];

type MissingKind = Exclude<ToolViewKind, (typeof view_kinds)[number]>;

export const view_kinds_complete: [MissingKind] extends [never] ? true : false = true;

const text_arg = (step: ToolStep, key: string): string => {
  const value = step.args[key];
  return typeof value === "string" ? value : "";
};

export const base_name = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

const view_of = <K extends ToolViewKind>(step: ToolStep, kind: K): Extract<ToolView, { kind: K }> | null =>
  step.view?.kind === kind ? (step.view as Extract<ToolView, { kind: K }>) : null;

const step_path = (step: ToolStep): string => {
  const view = step.view;
  if (view && (view.kind === "read" || view.kind === "edit" || view.kind === "outline")) {
    return view.path;
  }
  return text_arg(step, "path") || text_arg(step, "file");
};

const command_of = (step: ToolStep) => view_of(step, "command")?.command ?? (text_arg(step, "command") || view_of(step, "background")?.command || "");

const compact_command = (command: string) => !command.includes("\n") && command.length <= 64;

const fixed = (key: MessageKey): Label => (t) => t(key);

const with_x = (key: MessageKey, pick: (step: ToolStep) => string): Label => (t, step) => t(key, { x: pick(step) });

const file_name = (step: ToolStep) => base_name(step_path(step));

const agent_name = (step: ToolStep) => view_of(step, "agent")?.name || text_arg(step, "name") || text_arg(step, "agent_id");

const skill_name = (step: ToolStep) => view_of(step, "skill")?.name || text_arg(step, "name");

const query_of = (step: ToolStep) => view_of(step, "grep")?.query ?? text_arg(step, "query");

const command_label = (active: boolean): Label => (t, step) => {
  const command = command_of(step);
  if (step.status === "awaiting_approval") {
    return compact_command(command) ? t("tool_label.run_cmd", { x: command }) : t("tool_label.run_shell_ask");
  }
  if (active) {
    return compact_command(command) ? t("tool_label.running", { x: command }) : t("tool_label.run_shell");
  }
  return compact_command(command) ? t("tool_label.ran", { x: command }) : t("tool_label.ran_shell");
};

const edit_done: Label = (t, step) => t(view_of(step, "edit")?.created ? "tool_label.created" : "tool_label.edited", { x: file_name(step) });

const edit_active: Label = (t, step) => {
  const name = file_name(step);
  if (!name) {
    return t("tools.live_editing_generic");
  }
  return t(step.name === "write_file" ? "tool_label.writing" : "tool_label.editing", { x: name });
};

const entry = (icon: ToolIconName, category: ToolCategory, active: Label, done: Label = active): ToolMeta => ({ icon, category, active, done });

const named: Record<string, ToolMeta> = {
  run_command: entry("terminal", "commands", command_label(true), command_label(false)),
  start_background_task: entry("background", "commands", fixed("tool_label.starting_background"), fixed("tool_label.started_background")),
  get_background_task: entry("background", "task_checks", fixed("tool_label.checking_background"), fixed("tool_label.checked_background")),
  cancel_background_task: entry("background", "task_stops", fixed("tool_label.stopping_background"), fixed("tool_label.stopped_background")),
  read_file: entry("file", "reads", with_x("tool_label.reading", file_name), with_x("tool_label.read", file_name)),
  read_attachment: entry("file", "reads", with_x("tool_label.reading_attachment", file_name), with_x("tool_label.read_attachment", file_name)),
  get_file_outline: entry("outline", "reads", with_x("tool_label.outlining", file_name), with_x("tool_label.outlined", file_name)),
  list_files: entry("files", "listings", fixed("tool_label.listing"), fixed("tool_label.listed")),
  grep_files: entry("search", "searches", with_x("tool_label.grepping", query_of), with_x("tool_label.searched", query_of)),
  write_file: entry("edit", "edits", edit_active, edit_done),
  replace_in_file: entry("edit", "edits", edit_active, edit_done),
  update_todos: entry("todos", "todos", fixed("tool_label.update_todos"), fixed("tool_label.todos")),
  present_plan: entry("plan", "other", fixed("tool_label.planning"), fixed("tool_label.planned")),
  web_search: entry("web", "web", fixed("tool_label.web_search"), fixed("tool_label.searched_web")),
  generate_image: entry("image", "images", fixed("tool_label.generating_image"), fixed("tool_label.generated_image")),
  analyze_image: entry("image", "other", fixed("tool_label.analyze_image"), fixed("tool_label.analyzed_image")),
  deploy_agent: entry("agent", "agents", with_x("tool_label.deploying_agent", agent_name), with_x("tool_label.deployed_agent", agent_name)),
  continue_agent: entry("agent", "agent_runs", with_x("tool_label.continuing_agent", agent_name), with_x("tool_label.continued_agent", agent_name)),
  get_agent_status: entry("agent", "agent_checks", with_x("tool_label.agent_status", agent_name), with_x("tool_label.checked_agent", agent_name)),
  cancel_agent: entry("agent", "agent_stops", with_x("tool_label.cancel_agent", agent_name), with_x("tool_label.stopped_agent", agent_name)),
  message_agent: entry("agent", "messages", with_x("tool_label.message_agent", agent_name), with_x("tool_label.messaged_agent", agent_name)),
  message_main_agent: entry("agent", "messages", fixed("tool_label.message_main"), fixed("tool_label.messaged_main")),
  remember: entry("memory", "memory", fixed("tool_label.remember"), fixed("tool_label.remembered")),
  forget: entry("memory", "memory", fixed("tool_label.forget"), fixed("tool_label.forgot")),
  list_memories: entry("memory", "memory", fixed("tool_label.list_memories"), fixed("tool_label.listed_memories")),
  read_skill: entry("skill", "skills", with_x("tool_label.read_skill", skill_name), with_x("tool_label.read_skill_done", skill_name)),
  install_skill: entry("skill", "skill_installs", with_x("tool_label.install_skill", skill_name), with_x("tool_label.installed_skill", skill_name)),
  datetime: entry("clock", "other", fixed("tool_label.datetime"), fixed("tool_label.checked_datetime")),
  list_models: entry("models", "other", fixed("tool_label.list_models"), fixed("tool_label.listed_models")),
  add_mcp_server: entry("mcp", "mcp_servers", with_x("tool_label.adding_mcp", (step) => text_arg(step, "name")), with_x("tool_label.added_mcp", (step) => text_arg(step, "name"))),
};

const browser_target = (step: ToolStep) => text_arg(step, "ref") || text_arg(step, "target");

const browser: Record<string, ToolMeta> = {
  browser_tabs: entry("browser", "browser", fixed("tool_label.browser_tabs"), fixed("tool_label.browser_tabs_done")),
  browser_tab: entry("browser", "browser", fixed("tool_label.browser_tabs"), fixed("tool_label.browser_tabs_done")),
  browser_navigate: entry("browser", "browser", fixed("tool_label.browser_navigate"), with_x("tool_label.browser_navigated", (step) => view_of(step, "browser")?.title || view_of(step, "browser")?.url || text_arg(step, "url"))),
  browser_snapshot: entry("browser", "browser", fixed("tool_label.browser_snapshot"), fixed("tool_label.browser_snapshot_done")),
  browser_click: entry("browser", "browser", with_x("tool_label.browser_click", browser_target), with_x("tool_label.browser_clicked", browser_target)),
  browser_type: entry("browser", "browser", with_x("tool_label.browser_type", browser_target), with_x("tool_label.browser_typed", browser_target)),
  browser_key: entry("browser", "browser", with_x("tool_label.browser_key", (step) => text_arg(step, "key")), with_x("tool_label.browser_pressed", (step) => text_arg(step, "key"))),
  browser_scroll: entry("browser", "browser", fixed("tool_label.browser_scroll"), fixed("tool_label.browser_scrolled")),
  browser_wait: entry("browser", "browser", fixed("tool_label.browser_wait"), fixed("tool_label.browser_waited")),
  browser_visual_analyze: entry("browser", "browser", fixed("tool_label.browser_vision"), fixed("tool_label.browser_vision_done")),
  browser_visual_click: entry("browser", "browser", with_x("tool_label.browser_visual_click", browser_target), with_x("tool_label.browser_visual_clicked", browser_target)),
};

const mcp_parts = (step: ToolStep) => {
  const view = view_of(step, "mcp");
  if (view) {
    return { server: view.server, tool: view.tool };
  }
  const [server = "", ...tool] = step.name.slice("mcp__".length).split("__");
  return { server, tool: tool.join("__") };
};

const mcp_meta = entry("mcp", "mcp", (t, step) => t("tool_label.mcp", mcp_parts(step)));

const by_kind: Record<ToolViewKind, ToolMeta> = {
  files: named.list_files,
  read: named.read_file,
  grep: named.grep_files,
  outline: named.get_file_outline,
  edit: named.write_file,
  command: named.run_command,
  background: named.get_background_task,
  agent: named.get_agent_status,
  todos: named.update_todos,
  plan: named.present_plan,
  web_search: named.web_search,
  image: named.generate_image,
  browser: entry("browser", "browser", with_x("tool_label.browser_action", (step) => view_of(step, "browser")?.action ?? "")),
  mcp: mcp_meta,
  memory: named.list_memories,
  skill: named.read_skill,
  models: named.list_models,
  text: entry("text", "other", with_x("tool_label.running", (step) => step.name), with_x("tool_label.ran", (step) => step.name)),
};

const fallback = entry("clock", "other", (t, step) => (step.name ? t("tool_label.running", { x: step.name }) : t("tool_label.working")), (t, step) => t("tool_label.ran", { x: step.name }));

export const tool_meta = (step: ToolStep): ToolMeta => {
  if (step.name.startsWith("mcp__")) {
    return mcp_meta;
  }
  return named[step.name] ?? browser[step.name] ?? (step.view ? by_kind[step.view.kind] : fallback);
};

export const kind_meta = (kind: ToolViewKind): ToolMeta => by_kind[kind];

const hidden_tools = new Set(["read_attachment"]);

export const is_hidden_step = (step: ToolStep) => hidden_tools.has(step.name);

export const is_active_status = (status: ToolStep["status"]) =>
  status === "drafting" || status === "queued" || status === "running" || status === "awaiting_approval";

const denied_target = (step: ToolStep) => command_of(step) || step_path(step) || query_of(step) || step.name;

export const tool_label = (t: Translate, step: ToolStep): string => {
  const meta = tool_meta(step);
  if (step.status === "denied") {
    return t("tool_label.denied", { x: denied_target(step) });
  }
  if (step.status === "drafting" && meta.category !== "edits") {
    return t("tool_label.drafting");
  }
  return is_active_status(step.status) ? meta.active(t, step) : meta.done(t, step);
};
