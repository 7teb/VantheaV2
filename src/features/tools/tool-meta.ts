import type { ToolStep } from "../../../shared/chat.ts";
import { call_shell, type ShellKind } from "../../../shared/shell.ts";
import type { ToolView, ToolViewKind } from "../../../shared/tool-view.ts";
import { visual_tool_name } from "../../../shared/visual.ts";
import type { MessageKey, Translate } from "../../i18n/translate.ts";
import type { RunRef } from "../../state/agents-reduce.ts";

export type ToolIconName =
  | "terminal"
  | "bash"
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
  | "browser_tabs"
  | "browser_navigate"
  | "browser_snapshot"
  | "browser_console"
  | "browser_eval"
  | "browser_click"
  | "browser_type"
  | "browser_key"
  | "browser_scroll"
  | "browser_wait"
  | "browser_screenshot"
  | "browser_look"
  | "page_check"
  | "mcp"
  | "clock"
  | "gauge"
  | "models"
  | "question"
  | "visual"
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
  | "questions"
  | "visuals"
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
  "peer_message",
  "todos",
  "plan",
  "web_search",
  "image",
  "shown_images",
  "browser",
  "mcp",
  "memory",
  "skill",
  "models",
  "questions",
  "visual",
  "text",
] as const satisfies readonly ToolViewKind[];

type MissingKind = Exclude<ToolViewKind, (typeof view_kinds)[number]>;

export const view_kinds_complete: [MissingKind] extends [never] ? true : false = true;

export const text_arg = (step: ToolStep, key: string): string => {
  const value = step.args[key];
  return typeof value === "string" ? value : "";
};

export const base_name = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

export const page_address = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

export const view_of = <K extends ToolViewKind>(step: ToolStep, kind: K): Extract<ToolView, { kind: K }> | null =>
  step.view?.kind === kind ? (step.view as Extract<ToolView, { kind: K }>) : null;

const run_starters = new Set(["deploy_agent", "continue_agent"]);

export const started_run = (step: ToolStep): RunRef | null => {
  const view = view_of(step, "agent");
  return view && run_starters.has(step.name) ? { agent_id: view.agent_id, run_id: view.run_id } : null;
};

const step_path = (step: ToolStep): string => {
  const view = step.view;
  if (view && (view.kind === "read" || view.kind === "edit" || view.kind === "outline")) {
    return view.path;
  }
  return text_arg(step, "path") || text_arg(step, "file") || (step.progress?.draft_path ?? "");
};

const command_of = (step: ToolStep) => view_of(step, "command")?.command ?? (text_arg(step, "command") || view_of(step, "background")?.command || "");

export const compact_command = (command: string) => !command.includes("\n") && command.length <= 64;

const fixed = (key: MessageKey): Label => (t) => t(key);

const with_x = (key: MessageKey, pick: (step: ToolStep) => string): Label => (t, step) => t(key, { x: pick(step) });

const file_name = (step: ToolStep) => base_name(step_path(step));

const agent_name = (step: ToolStep) => view_of(step, "agent")?.name || text_arg(step, "name") || text_arg(step, "agent_id");

const peer_name = (step: ToolStep) => view_of(step, "peer_message")?.to_name || text_arg(step, "to");

const skill_name = (step: ToolStep) => view_of(step, "skill")?.name || text_arg(step, "name");

const query_of = (step: ToolStep) => view_of(step, "grep")?.query ?? text_arg(step, "query");

const listed_root = (step: ToolStep) => view_of(step, "files")?.root || text_arg(step, "path");

const listed_label: Label = (t, step) => {
  const root = listed_root(step);
  return root && root !== "." ? t("tool_label.listed_in", { x: root }) : t("tool_label.listed");
};

const viewed_image = (step: ToolStep) => base_name(view_of(step, "text")?.text || step_path(step));

const shown_name = (step: ToolStep) => {
  const paths: unknown[] = view_of(step, "shown_images")?.images.map((image) => image.path) ?? (Array.isArray(step.args.paths) ? step.args.paths : []);
  const first = typeof paths[0] === "string" ? base_name(paths[0]) : "";
  return paths.length > 1 ? `${first} +${paths.length - 1}` : first;
};

const visual_title = (step: ToolStep) => view_of(step, "visual")?.title || text_arg(step, "title");

const titled = (plain: MessageKey, named_key: MessageKey): Label => (t, step) => {
  const title = visual_title(step);
  return title ? t(named_key, { x: title }) : t(plain);
};

const first_question = (step: ToolStep): string => {
  const view = view_of(step, "questions");
  if (view) {
    return view.questions[0]?.title ?? "";
  }
  const first: unknown = Array.isArray(step.args.questions) ? step.args.questions[0] : null;
  return first && typeof first === "object" && "title" in first && typeof first.title === "string" ? first.title : "";
};

type ShellLabelKeys = { ask: MessageKey; running: MessageKey; moved: MessageKey; ran: MessageKey };

const shell_label_keys: Record<ShellKind, ShellLabelKeys> = {
  powershell: { ask: "tool_label.run_shell_ask", running: "tool_label.run_shell", moved: "tool_label.moved_shell_background", ran: "tool_label.ran_shell" },
  bash: { ask: "tool_label.run_bash_ask", running: "tool_label.run_bash", moved: "tool_label.moved_bash_background", ran: "tool_label.ran_bash" },
};

const command_label = (active: boolean): Label => (t, step) => {
  const command = command_of(step);
  const keys = shell_label_keys[call_shell(step.name, step.args)];
  if (step.status === "awaiting_approval") {
    return compact_command(command) ? t("tool_label.run_cmd", { x: command }) : t(keys.ask);
  }
  if (active) {
    return compact_command(command) ? t("tool_label.running", { x: command }) : t(keys.running);
  }
  if (step.view?.kind === "background") {
    return compact_command(command) ? t("tool_label.moved_background", { x: command }) : t(keys.moved);
  }
  return compact_command(command) ? t("tool_label.ran", { x: command }) : t(keys.ran);
};

const edit_done: Label = (t, step) => t(view_of(step, "edit")?.created ? "tool_label.created" : "tool_label.edited", { x: file_name(step) });

const edit_active: Label = (t, step) => {
  const name = file_name(step);
  if (!name) {
    return t("tools.live_editing_generic");
  }
  return t(step.name === "write_file" ? "tool_label.writing" : "tool_label.editing", { x: name });
};

const read_urls = (step: ToolStep): string[] => {
  const urls: unknown = view_of(step, "web_search")?.urls ?? step.args.urls;
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
};

const web_label = (search: Label, one_page: MessageKey, pages: MessageKey): Label => (t, step) => {
  const failed = view_of(step, "web_search")?.failed?.map((entry) => entry.url) ?? [];
  const urls = read_urls(step).filter((url, _, all) => !failed.includes(url) || failed.length >= all.length);
  if (urls.length > 1) {
    return t(pages, { n: urls.length });
  }
  return urls[0] ? t(one_page, { x: page_address(urls[0]) }) : search(t, step);
};

const entry = (icon: ToolIconName, category: ToolCategory, active: Label, done: Label = active): ToolMeta => ({ icon, category, active, done });

const named: Record<string, ToolMeta> = {
  run_command: entry("terminal", "commands", command_label(true), command_label(false)),
  run_bash: entry("bash", "commands", command_label(true), command_label(false)),
  start_background_task: entry("background", "commands", fixed("tool_label.starting_background"), fixed("tool_label.started_background")),
  get_background_task: entry("background", "task_checks", fixed("tool_label.checking_background"), fixed("tool_label.checked_background")),
  cancel_background_task: entry("background", "task_stops", fixed("tool_label.stopping_background"), fixed("tool_label.stopped_background")),
  read_file: entry("file", "reads", with_x("tool_label.reading", file_name), with_x("tool_label.read", file_name)),
  read_attachment: entry("file", "reads", with_x("tool_label.reading_attachment", file_name), with_x("tool_label.read_attachment", file_name)),
  get_file_outline: entry("outline", "reads", with_x("tool_label.outlining", file_name), with_x("tool_label.outlined", file_name)),
  list_files: entry("files", "listings", fixed("tool_label.listing"), listed_label),
  grep_files: entry("search", "searches", with_x("tool_label.grepping", query_of), with_x("tool_label.searched", query_of)),
  write_file: entry("edit", "edits", edit_active, edit_done),
  replace_in_file: entry("edit", "edits", edit_active, edit_done),
  update_todos: entry("todos", "todos", fixed("tool_label.update_todos"), fixed("tool_label.todos")),
  present_plan: entry("plan", "other", fixed("tool_label.planning"), fixed("tool_label.planned")),
  ask_user: entry("question", "questions", with_x("tool_label.asking", first_question), with_x("tool_label.asked", first_question)),
  web_search: entry(
    "web",
    "web",
    web_label(fixed("tool_label.web_search"), "tool_label.reading", "tool_label.reading_pages"),
    web_label(with_x("tool_label.searched_web", (step) => view_of(step, "web_search")?.query || text_arg(step, "query")), "tool_label.read", "tool_label.read_pages"),
  ),
  generate_image: entry("image", "images", fixed("tool_label.generating_image"), fixed("tool_label.generated_image")),
  show_images: entry("image", "images", with_x("tool_label.showing_images", shown_name), with_x("tool_label.showed_images", shown_name)),
  analyze_image: entry("image", "other", fixed("tool_label.analyze_image"), fixed("tool_label.analyzed_image")),
  view_image: entry("image", "reads", with_x("tool_label.viewing_image", file_name), with_x("tool_label.viewed_image", viewed_image)),
  [visual_tool_name]: entry("visual", "visuals", titled("tool_label.visualizing", "tool_label.visualizing_named"), titled("tool_label.visualized", "tool_label.visualized_named")),
  deploy_agent: entry("agent", "agents", with_x("tool_label.deploying_agent", agent_name), with_x("tool_label.deployed_agent", agent_name)),
  continue_agent: entry("agent", "agent_runs", with_x("tool_label.continuing_agent", agent_name), with_x("tool_label.continued_agent", agent_name)),
  get_agent_status: entry("agent", "agent_checks", with_x("tool_label.agent_status", agent_name), with_x("tool_label.checked_agent", agent_name)),
  cancel_agent: entry("agent", "agent_stops", with_x("tool_label.cancel_agent", agent_name), with_x("tool_label.stopped_agent", agent_name)),
  message_agent: entry("agent", "messages", with_x("tool_label.message_agent", agent_name), with_x("tool_label.messaged_agent", agent_name)),
  message_main_agent: entry("agent", "messages", fixed("tool_label.message_main"), fixed("tool_label.messaged_main")),
  message_peer: entry("agent", "messages", with_x("tool_label.message_peer", peer_name), with_x("tool_label.messaged_peer", peer_name)),
  list_agents: entry("agent", "other", fixed("tool_label.list_agents"), fixed("tool_label.listed_agents")),
  remember: entry("memory", "memory", fixed("tool_label.remember"), fixed("tool_label.remembered")),
  forget: entry("memory", "memory", fixed("tool_label.forget"), fixed("tool_label.forgot")),
  list_memories: entry("memory", "memory", fixed("tool_label.list_memories"), fixed("tool_label.listed_memories")),
  read_skill: entry("skill", "skills", with_x("tool_label.read_skill", skill_name), with_x("tool_label.read_skill_done", skill_name)),
  install_skill: entry("skill", "skill_installs", with_x("tool_label.install_skill", skill_name), with_x("tool_label.installed_skill", skill_name)),
  datetime: entry("clock", "other", fixed("tool_label.datetime"), fixed("tool_label.checked_datetime")),
  context_status: entry("gauge", "other", fixed("tool_label.context_status"), fixed("tool_label.checked_context")),
  list_models: entry("models", "other", fixed("tool_label.list_models"), fixed("tool_label.listed_models")),
  add_mcp_server: entry("mcp", "mcp_servers", with_x("tool_label.adding_mcp", (step) => text_arg(step, "name")), with_x("tool_label.added_mcp", (step) => text_arg(step, "name"))),
  check_page: entry("page_check", "other", with_x("tool_label.check_page", (step) => base_name(text_arg(step, "path"))), with_x("tool_label.check_page_done", (step) => base_name(text_arg(step, "path")))),
};

const browser_target = (step: ToolStep) => text_arg(step, "ref") || text_arg(step, "target");

const point_target = (step: ToolStep) => {
  const { x, y } = step.args;
  return typeof x === "number" && typeof y === "number" ? `${x}, ${y}` : "";
};

export const page_detail = (step: ToolStep) => (step.status === "failed" ? "" : (view_of(step, "browser")?.detail ?? ""));

const page_name = (step: ToolStep) => {
  const view = step.status === "failed" ? null : view_of(step, "browser");
  return view?.title || view?.url || text_arg(step, "url");
};

const acted_on = (pick: (step: ToolStep) => string) => (step: ToolStep) => page_detail(step) || pick(step);

const by_action = (keys: Record<string, MessageKey>, fallback: MessageKey): Label => (t, step) => {
  const key = keys[text_arg(step, "action")];
  const x = page_name(step);
  return key && x ? t(key, { x }) : t(fallback);
};

const tab_done = by_action(
  { new: "tool_label.browser_tab_opened", select: "tool_label.browser_tab_selected", close: "tool_label.browser_tab_closed" },
  "tool_label.browser_tabs_done",
);

const navigate_done = by_action(
  { goto: "tool_label.browser_navigated", back: "tool_label.browser_went_back", forward: "tool_label.browser_went_forward", reload: "tool_label.browser_reloaded" },
  "tool_label.browser_navigate_done",
);

const clicked: Label = (t, step) => t(step.args.double === true ? "tool_label.browser_double_clicked" : "tool_label.browser_clicked", { x: acted_on(browser_target)(step) });

const browser: Record<string, ToolMeta> = {
  browser_tabs: entry("browser_tabs", "browser", fixed("tool_label.browser_tabs"), fixed("tool_label.browser_tabs_done")),
  browser_tab: entry("browser_tabs", "browser", fixed("tool_label.browser_tabs"), tab_done),
  browser_navigate: entry("browser_navigate", "browser", fixed("tool_label.browser_navigate"), navigate_done),
  browser_snapshot: entry("browser_snapshot", "browser", fixed("tool_label.browser_snapshot"), fixed("tool_label.browser_snapshot_done")),
  browser_console: entry("browser_console", "browser", fixed("tool_label.browser_console"), fixed("tool_label.browser_console_done")),
  browser_eval: entry("browser_eval", "browser", fixed("tool_label.browser_eval"), fixed("tool_label.browser_eval_done")),
  browser_click: entry("browser_click", "browser", with_x("tool_label.browser_click", browser_target), clicked),
  browser_type: entry("browser_type", "browser", with_x("tool_label.browser_type", browser_target), with_x("tool_label.browser_typed", acted_on(browser_target))),
  browser_key: entry("browser_key", "browser", with_x("tool_label.browser_key", (step) => text_arg(step, "key")), with_x("tool_label.browser_pressed", acted_on((step) => text_arg(step, "key")))),
  browser_scroll: entry("browser_scroll", "browser", fixed("tool_label.browser_scroll"), fixed("tool_label.browser_scrolled")),
  browser_wait: entry("browser_wait", "browser", fixed("tool_label.browser_wait"), fixed("tool_label.browser_waited")),
  browser_screenshot: entry("browser_screenshot", "browser", fixed("tool_label.browser_screenshot"), fixed("tool_label.browser_screenshot_done")),
  browser_click_point: entry("browser_click", "browser", with_x("tool_label.browser_click", point_target), with_x("tool_label.browser_clicked", acted_on(point_target))),
  browser_visual_analyze: entry("browser_look", "browser", fixed("tool_label.browser_vision"), fixed("tool_label.browser_vision_done")),
  browser_visual_click: entry("browser_click", "browser", with_x("tool_label.browser_visual_click", browser_target), with_x("tool_label.browser_visual_clicked", acted_on(browser_target))),
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
  peer_message: named.message_peer,
  todos: named.update_todos,
  plan: named.present_plan,
  web_search: named.web_search,
  image: named.generate_image,
  shown_images: named.show_images,
  browser: entry("browser", "browser", with_x("tool_label.browser_action", (step) => view_of(step, "browser")?.action ?? "")),
  mcp: mcp_meta,
  memory: named.list_memories,
  skill: named.read_skill,
  models: named.list_models,
  questions: named.ask_user,
  visual: named[visual_tool_name],
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

const labels_while_drafting = new Set<ToolCategory>(["edits", "visuals"]);

const denied_target = (step: ToolStep) => command_of(step) || step_path(step) || query_of(step) || step.name;

export const tool_label = (t: Translate, step: ToolStep): string => {
  const meta = tool_meta(step);
  if (step.status === "denied") {
    return t("tool_label.denied", { x: denied_target(step) });
  }
  if (step.status === "drafting" && !labels_while_drafting.has(meta.category)) {
    return t("tool_label.drafting");
  }
  return is_active_status(step.status) ? meta.active(t, step) : meta.done(t, step);
};
