import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { ToolStep } from "../shared/chat.ts";
import type { ScheduledTaskView } from "../shared/scheduled.ts";
import type { ToolView, ToolViewKind } from "../shared/tool-view.ts";
import { question_key_action, type QuestionKeySource } from "../src/components/question-keys.ts";
import { grant_options } from "../src/features/tools/approval-options.ts";
import { live_draft } from "../src/features/tools/live-draft.ts";
import { has_body } from "../src/features/tools/tool-body.ts";
import { kind_meta, tool_label, tool_meta, view_kinds, view_kinds_complete } from "../src/features/tools/tool-meta.ts";
import { format_duration, group_label, step_detail } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const scheduled_view: ScheduledTaskView = {
  id: "task-1", chat_id: "chat-1", prompt: "Check the heat", interval: "1h", enabled: true, choice: { model: "a/b", effort: "high", pro: false }, mode: "auto",
  created_at: "2026-11-04T10:00:00.000Z", updated_at: "2026-11-04T10:00:00.000Z", next_run_at: "2026-11-04T11:00:00.000Z", last_run: null, runs: [],
  name: "Africa heat", project_path: "", running: false,
};

const views: Record<ToolViewKind, ToolView> = {
  files: { kind: "files", root: "D:\\p", files: ["a.ts", "b.ts"], directories: 1, truncated: false },
  read: { kind: "read", path: "src/a.ts", start_line: 1, end_line: 40, total_lines: 90, truncated: false },
  grep: { kind: "grep", query: "needle", matches: [{ path: "a.ts", line: 3, text: "needle" }], total: 1, truncated: false },
  outline: { kind: "outline", path: "src/a.ts", symbols: [{ kind: "function", name: "run", line: 4, depth: 0 }] },
  edit: { kind: "edit", path: "src/a.ts", created: false, added: 3, removed: 1, diff: [] },
  command: { kind: "command", shell: "PowerShell", command: "npm test", cwd: ".", exit_code: 1, output: "fail", timed_out: false, duration_ms: 1200 },
  background: { kind: "background", shell: "PowerShell", task_id: "t1", command: "npm run dev", status: "running", output_tail: "" },
  agent: { kind: "agent", agent_id: "a1", run_id: "r1", name: "scout", status: "completed", report: "done" },
  workflow: { kind: "workflow", run_id: "wf_00000000-1", name: "review", status: "running", script_path: "C:/wf/script.js" },
  peer_message: { kind: "peer_message", message_id: "msg_1", to_name: "Tokenizer", to_id: "agent_1", type: "question", about: "tokens.ts", summary: "Who changes TokenKind?", outcome: "queued" },
  todos: { kind: "todos", todos: [{ id: "1", text: "x", status: "done" }, { id: "2", text: "y", status: "pending" }] },
  plan: { kind: "plan", text: "# Plan" },
  web_search: { kind: "web_search", query: "q", depth: "basic", answer: "a", sources: [{ title: "T", url: "https://e.com", snippet: "" }] },
  image: { kind: "image", images: [{ id: "img_a_b.png", width: 512, height: 512 }] },
  generated_images: { kind: "generated_images", images: [{ id: "img_a_b.png", width: 512, height: 512 }] },
  shown_images: { kind: "shown_images", images: [{ id: "img_a_c.png", path: "C:/shots/a.png", width: 800, height: 600 }] },
  browser: { kind: "browser", action: "navigate", url: "https://e.com", title: "E", detail: "" },
  computer: { kind: "computer", action: "click", x: 412, y: 230, button: "left", count: 1, modifiers: [], shot: { message_id: "a1", call_id: "call-shot" } },
  mcp: { kind: "mcp", server: "ida", tool: "decompile", text: "ok", is_error: false },
  tool_load: { kind: "tool_load", names: ["mcp__ida__decompile"] },
  memory: { kind: "memory", action: "list", text: "a\nb" },
  hooks: { kind: "hooks", action: "list", hooks: [{ id: "h1", event: "PreToolUse", matcher: "run_command", shell: "powershell", command: "exit 0", timeout_s: 60, enabled: true, scope: { kind: "global" } }], previous: null },
  scheduled_tasks: { kind: "scheduled_tasks", action: "list", tasks: [scheduled_view], previous: null },
  skill: { kind: "skill", action: "read", name: "frontend" },
  models: {
    kind: "models",
    models: [{ id: "a/b", label: "B", provider: "A", endpoint: "a", input: 0.1, output: 0.4, cache_read: null, long_context: null, context_length: 1000, efforts: ["low"], note: "", error: "" }],
  },
  questions: { kind: "questions", questions: [{ title: "Which runner?", options: ["node --test", "vitest"] }] },
  visual: { kind: "visual", title: "Pointer chain", code: "<p>chain</p>" },
  text: { kind: "text", text: "plain" },
};

const step = (name: string, view: ToolView | null, status: ToolStep["status"] = "done", args: Record<string, unknown> = {}): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status,
  progress: null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" ? 2500 : null,
});

const unresolved = /\{\w+\}|^[a-z_]+\.[a-z0-9_]+$/;

test("the view kind list covers every ToolView kind exactly once", () => {
  assert.equal(view_kinds_complete, true);
  assert.equal(new Set(view_kinds).size, view_kinds.length);
  assert.deepEqual([...view_kinds].sort(), Object.keys(views).sort());
});

test("every view kind has an icon and readable labels for running and finished steps", () => {
  for (const kind of view_kinds) {
    const meta = kind_meta(kind);
    assert.ok(meta.icon, kind);
    for (const status of ["running", "done", "failed"] as const) {
      const label = tool_label(t, step(`custom_${kind}`, status === "running" ? null : views[kind], status, { name: "n" }));
      assert.ok(label.trim().length > 0, `${kind} ${status}`);
      assert.doesNotMatch(label, unresolved, `${kind} ${status}: ${label}`);
    }
    step_detail(t, step(kind, views[kind]));
  }
});

test("known tool names resolve by name before the view kind", () => {
  assert.equal(tool_meta(step("run_command", null)).icon, "terminal");
  assert.equal(tool_label(t, step("run_command", null, "running", { command: "npm test" })), "Running npm test");
  assert.equal(tool_label(t, step("run_command", views.command)), "Ran npm test");
  assert.equal(tool_label(t, step("read_file", views.read)), "Read a.ts");
  assert.equal(tool_label(t, step("write_file", { ...views.edit, created: true } as ToolView)), "Created a.ts");
  assert.equal(tool_label(t, step("mcp__ida__decompile", null, "running")), "ida · decompile");
  assert.equal(tool_label(t, step("run_command", null, "denied", { command: "rm x" })), "Denied rm x");
  assert.equal(tool_meta(step("browser_click", null)).category, "browser");
});

test("view_image names the viewed file while running and when done", () => {
  assert.equal(tool_meta(step("view_image", null)).icon, "image");
  assert.equal(tool_label(t, step("view_image", null, "running", { path: "out/shot.png" })), "Viewing image shot.png");
  assert.equal(tool_label(t, step("view_image", { kind: "text", text: "out/shot.png" }, "done", { path: "out/shot.png" })), "Viewed image shot.png");
  assert.equal(translate("de", "tool_label.viewed_image", { x: "shot.png" }), "Bild shot.png angesehen");
});

test("group labels count files once per path and keep category order", () => {
  const steps = [
    step("read_file", views.read),
    step("read_file", views.read),
    step("run_command", views.command),
    step("grep_files", views.grep),
    step("run_command", views.command),
  ];
  assert.equal(group_label(t, steps), "Read files, ran commands");
});

test("messages to or from agents count as sent messages, not deployed agents", () => {
  const steps = [step("message_main_agent", null), step("read_file", views.read), step("message_agent", null, "done", { agent_id: "agent_x" })];
  assert.equal(group_label(t, steps), "Sent messages, read a file");
});

test("agent, background task, skill and MCP management keep their own group labels", () => {
  const steps = [
    step("get_agent_status", null, "done", { agent_id: "agent_x" }),
    step("get_agent_status", null, "done", { agent_id: "agent_x" }),
    step("cancel_agent", null, "done", { agent_id: "agent_x" }),
    step("continue_agent", null, "done", { agent_id: "agent_y" }),
    step("get_background_task", null, "done", { id: "bg_1" }),
    step("cancel_background_task", null, "done", { id: "bg_1" }),
    step("install_skill", null, "done", { source: "C:/skills/x" }),
    step("add_mcp_server", null, "done", { name: "ida" }),
  ];
  assert.equal(
    group_label(t, steps),
    "Checked an agent, stopped an agent, continued an agent, checked a background task, stopped a background task, installed a skill, added an MCP server",
  );
  assert.equal(tool_label(t, step("cancel_background_task", null, "done", { id: "bg_1" })), "Stopped background task");
});

test("listing files counts folders, not searched strings", () => {
  const steps = [step("read_skill", null), step("list_files", null, "done", { path: "src" }), step("list_files", null, "done", { path: "src" })];
  assert.equal(group_label(t, steps), "Read a skill, read files");
});

test("approval grants match what each request kind supports", () => {
  const grants = (request: ApprovalRequest) => grant_options(request).map((option) => option.grant);
  assert.deepEqual(grants({ kind: "command", command: "git push", cwd: ".", background: false, review: null, grant_prefix: "git push" }), ["once", "prefix"]);
  assert.deepEqual(grants({ kind: "command", command: "x", cwd: ".", background: false, review: null, grant_prefix: null }), ["once"]);
  assert.deepEqual(grants({ kind: "write", path: "a", created: false, added: 1, removed: 0, diff: [] }), ["once"]);
  const mcp = (tier: "readonly" | "state_change" | "dangerous" | "shell_system", scope: string | null = null): ApprovalRequest => ({
    kind: "mcp",
    server: "ida",
    tool: "patch",
    tier,
    args_preview: "",
    scope,
  });
  assert.deepEqual(grants(mcp("readonly")), ["once", "chat"]);
  assert.deepEqual(grants(mcp("state_change")), ["once", "chat"]);
  assert.deepEqual(grants(mcp("dangerous")), ["once", "session"]);
  assert.deepEqual(grants(mcp("dangerous", "0x1000")), ["once", "chat", "session"]);
  assert.deepEqual(grants(mcp("shell_system")), ["once"]);
  assert.deepEqual(grants({ kind: "memory", action: "remember", text: "x" }), ["once"]);
});

test("no card offers the full window, also when the automatic review was unavailable", () => {
  const grants = (request: ApprovalRequest) => grant_options(request).map((option) => option.grant);
  const down = { id: "r", source: "unavailable", reason: "", rule_source: "none", rule: "", failure: "timeout" } as const;
  assert.deepEqual(grants({ kind: "command", command: "npm i", cwd: ".", background: false, review: down, grant_prefix: null }), ["once"]);
  assert.deepEqual(grants({ kind: "command", command: "npm i", cwd: ".", background: false, review: { id: "r", source: "model", reason: "risky", rule_source: "none", rule: "" }, grant_prefix: "npm i" }), ["once", "prefix"]);
  const mcp = (tier: "state_change" | "dangerous" | "shell_system"): ApprovalRequest => ({ kind: "mcp", server: "ida", tool: "patch", tier, args_preview: "", scope: null, review: down });
  assert.deepEqual(grants(mcp("state_change")), ["once", "chat"]);
  assert.deepEqual(grants(mcp("dangerous")), ["once", "session"]);
  assert.deepEqual(grants(mcp("shell_system")), ["once"]);
});

type KeyState = {
  source?: QuestionKeySource;
  selected?: number;
  count?: number;
  shift?: boolean;
  modified?: boolean;
  composing?: boolean;
  repeat?: boolean;
  multiline?: boolean;
  navigable?: boolean;
};

const key = (name: string, state: KeyState = {}) =>
  question_key_action({
    key: name,
    shift: state.shift ?? false,
    modified: state.modified ?? false,
    composing: state.composing ?? false,
    repeat: state.repeat ?? false,
    source: state.source ?? "other",
    multiline: state.multiline ?? false,
    navigable: state.navigable ?? false,
    selected: state.selected ?? 0,
    count: state.count ?? 2,
  });

test("number keys choose an option and the next number opens the feedback row", () => {
  assert.deepEqual(key("1"), { kind: "choose", index: 0 });
  assert.deepEqual(key("2"), { kind: "choose", index: 1 });
  assert.deepEqual(key("3"), { kind: "focus_other" });
  assert.equal(key("4"), null);
  assert.equal(key("0"), null);
  assert.deepEqual(key("1", { count: 1 }), { kind: "choose", index: 0 });
  assert.deepEqual(key("2", { count: 1 }), { kind: "focus_other" });
  assert.equal(key("1", { modified: true }), null);
  assert.equal(key("1", { composing: true }), null);
});

test("arrows move the highlight and fall through to the feedback row below the last option", () => {
  assert.deepEqual(key("ArrowDown", { selected: 0 }), { kind: "select", index: 1 });
  assert.deepEqual(key("ArrowDown", { selected: 1 }), { kind: "focus_other" });
  assert.deepEqual(key("ArrowDown", { selected: -1 }), { kind: "focus_other" });
  assert.deepEqual(key("ArrowUp", { selected: 1 }), { kind: "select", index: 0 });
  assert.deepEqual(key("ArrowUp", { selected: 0 }), { kind: "select", index: 0 });
  assert.deepEqual(key("ArrowUp", { selected: -1 }), { kind: "select", index: 1 });
});

test("enter confirms the highlighted option, leaves buttons to their own click and sends feedback when nothing is highlighted", () => {
  assert.deepEqual(key("Enter", { selected: 1 }), { kind: "choose", index: 1 });
  assert.deepEqual(key("Enter", { selected: -1 }), { kind: "submit_other" });
  assert.equal(key("Enter", { source: "button" }), null);
  assert.deepEqual(key("ArrowDown", { source: "button", selected: 0 }), { kind: "select", index: 1 });
});

test("the feedback row submits on enter, keeps shift enter for new lines and returns to the options on arrow up", () => {
  assert.deepEqual(key("Enter", { source: "input", selected: -1 }), { kind: "submit_other" });
  assert.equal(key("Enter", { source: "input", shift: true }), null);
  assert.deepEqual(key("ArrowUp", { source: "input", selected: -1 }), { kind: "select", index: 1 });
  assert.equal(key("ArrowUp", { source: "input", multiline: true }), null);
  assert.equal(key("ArrowDown", { source: "input" }), null);
  assert.equal(key("1", { source: "input" }), null);
});

test("escape dismisses from anywhere in the form", () => {
  assert.deepEqual(key("Escape"), { kind: "dismiss" });
  assert.deepEqual(key("Escape", { source: "input" }), { kind: "dismiss" });
  assert.deepEqual(key("Escape", { source: "button" }), { kind: "dismiss" });
  assert.equal(key("Escape", { composing: true }), null);
  assert.deepEqual(key("Escape", { modified: true }), { kind: "dismiss" });
});

test("a held key never answers a question but arrows keep repeating", () => {
  assert.deepEqual(key("1", { repeat: true }), { kind: "consume" });
  assert.deepEqual(key("Enter", { repeat: true }), { kind: "consume" });
  assert.deepEqual(key("Enter", { repeat: true, source: "input", selected: -1 }), { kind: "consume" });
  assert.deepEqual(key("Escape", { repeat: true }), { kind: "consume" });
  assert.deepEqual(key("ArrowDown", { repeat: true, selected: 0 }), { kind: "select", index: 1 });
  assert.deepEqual(key("3", { repeat: true }), { kind: "focus_other" });
  assert.equal(key("1", { repeat: true, source: "input" }), null);
});

test("modifier keys only block the number shortcuts", () => {
  assert.equal(key("1", { modified: true }), null);
  assert.equal(key("3", { modified: true }), null);
  assert.deepEqual(key("Enter", { modified: true, source: "input", selected: -1 }), { kind: "submit_other" });
  assert.deepEqual(key("Enter", { modified: true, selected: 1 }), { kind: "choose", index: 1 });
  assert.deepEqual(key("ArrowDown", { modified: true, selected: 0 }), { kind: "select", index: 1 });
});

test("left and right arrows switch questions only in a navigable form and never from the text field", () => {
  assert.deepEqual(key("ArrowLeft", { navigable: true }), { kind: "navigate", step: -1 });
  assert.deepEqual(key("ArrowRight", { navigable: true }), { kind: "navigate", step: 1 });
  assert.deepEqual(key("ArrowRight", { navigable: true, source: "button" }), { kind: "navigate", step: 1 });
  assert.deepEqual(key("ArrowRight", { navigable: true, selected: -1 }), { kind: "navigate", step: 1 });
  assert.equal(key("ArrowLeft", { navigable: true, source: "input" }), null);
  assert.equal(key("ArrowRight", { navigable: true, source: "input" }), null);
  assert.equal(key("ArrowLeft"), null);
  assert.equal(key("ArrowRight"), null);
  assert.equal(key("ArrowRight", { navigable: true, composing: true }), null);
});

test("a held arrow switches questions without answering and escape still dismisses a navigable form", () => {
  assert.deepEqual(key("ArrowRight", { navigable: true, repeat: true }), { kind: "navigate", step: 1 });
  assert.deepEqual(key("Escape", { navigable: true }), { kind: "dismiss" });
  assert.deepEqual(key("Escape", { navigable: true, source: "input" }), { kind: "dismiss" });
  assert.deepEqual(key("Escape", { navigable: true, repeat: true }), { kind: "consume" });
  assert.deepEqual(key("1", { navigable: true }), { kind: "choose", index: 0 });
});

test("a free-text question without options sends the field and never selects a missing option", () => {
  assert.deepEqual(key("1", { count: 0, selected: -1 }), { kind: "focus_other" });
  assert.deepEqual(key("ArrowDown", { count: 0, selected: -1 }), { kind: "focus_other" });
  assert.equal(key("ArrowUp", { count: 0, selected: -1 }), null);
  assert.equal(key("ArrowUp", { count: 0, selected: -1, source: "input" }), null);
  assert.deepEqual(key("Enter", { count: 0, selected: -1 }), { kind: "submit_other" });
  assert.deepEqual(key("Enter", { count: 0, selected: -1, source: "input" }), { kind: "submit_other" });
});

test("live drafts come from the draft progress while drafting and from the args until the tool ends", () => {
  const drafting: ToolStep = { ...step("write_file", null, "drafting"), progress: { label: "", lines: 2, output_tail: null, draft_text: "a\nb", draft_path: "src/a.py" } };
  assert.deepEqual(live_draft(drafting), { path: "src/a.py", text: "a\nb", old_text: null, whole_file: true, writing: true });
  assert.equal(tool_label(t, drafting), "Writing a.py");
  const unnamed: ToolStep = { ...drafting, progress: { label: "", lines: 1, output_tail: null, draft_text: "a" } };
  assert.equal(live_draft(unnamed)?.path, "");
  assert.equal(tool_label(t, unnamed), "Editing file…");
  assert.equal(live_draft({ ...drafting, progress: { label: "", lines: 0, output_tail: null } }), null);
  for (const status of ["queued", "awaiting_approval", "running"] as const) {
    const waiting = step("write_file", null, status, { path: "a.py", content: "x" });
    assert.deepEqual(live_draft(waiting), { path: "a.py", text: "x", old_text: null, whole_file: true, writing: false });
  }
  const removal = step("replace_in_file", null, "running", { path: "b.ts", old_string: "old", new_string: "" });
  assert.deepEqual(live_draft(removal), { path: "b.ts", text: "", old_text: "old", whole_file: false, writing: false });
  assert.equal(live_draft(step("write_file", views.edit, "running", { path: "a.py", content: "x" })), null);
  assert.equal(live_draft(step("write_file", views.edit, "done", { path: "a.py", content: "x" })), null);
  assert.equal(live_draft(step("write_file", null, "failed", { path: "a.py", content: "x" })), null);
  assert.equal(live_draft(step("run_command", null, "running", { command: "x" })), null);
});

test("durations carry hours past sixty minutes", () => {
  assert.equal(format_duration(400), "1s");
  assert.equal(format_duration(59_000), "59s");
  assert.equal(format_duration(125_000), "2m 5s");
  assert.equal(format_duration(3_600_000), "1h");
  assert.equal(format_duration(2 * 3_600_000), "2h");
  assert.equal(format_duration(2 * 3_600_000 + 5 * 60_000 + 30_000), "2h 5m 30s");
  assert.equal(format_duration(3_605_000), "1h 5s");
  assert.equal(format_duration(90_061_000), "1d 1h 1m 1s");
});

test("ask_user rows name the first question and work groups count the questions asked", () => {
  const view = views.questions;
  assert.equal(tool_label(t, step("ask_user", view)), "Asked: Which runner?");
  assert.equal(tool_label(t, step("ask_user", null, "running", { questions: [{ title: "Which port?" }] })), "Asking: Which port?");
  assert.equal(tool_meta(step("ask_user", view)).icon, "question");
  assert.equal(group_label(t, [step("ask_user", view), step("read_file", views.read)]), "Asked a question, read a file");
  const two = { kind: "questions", questions: [{ title: "A?", options: [] }, { title: "B?", options: [] }] } as ToolView;
  assert.equal(group_label(t, [step("ask_user", two), step("ask_user", view)]), "Asked questions");
});

test("screenshot, click point and page check rows have their own labels", () => {
  assert.equal(tool_label(t, step("browser_screenshot", null, "running")), "Taking a screenshot of the browser page");
  assert.equal(tool_label(t, step("browser_screenshot", views.browser)), "Took a screenshot of the browser page");
  assert.equal(tool_label(t, step("browser_console", null, "running")), "Reading the browser console");
  assert.equal(tool_label(t, step("browser_console", views.browser)), "Read the browser console");
  assert.equal(tool_label(t, step("browser_eval", null, "running", { expression: "document.title" })), "Evaluating JavaScript in the page");
  assert.equal(tool_label(t, step("browser_eval", views.browser)), "Evaluated JavaScript in the page");
  assert.equal(tool_label(t, step("browser_click_point", null, "running", { snapshot_id: "tab-1:2:3", x: 512, y: 300 })), "Clicking 512, 300");
  assert.equal(tool_label(t, step("browser_click_point", views.browser, "done", { snapshot_id: "tab-1:2:3", x: 512, y: 300 })), "Clicked 512, 300");
  assert.equal(tool_label(t, step("check_page", null, "running", { path: "out/particles" })), "Checking page particles");
  assert.equal(tool_label(t, step("check_page", views.text, "done", { path: "out\\ad\\index.html" })), "Checked page index.html");
  assert.equal(tool_meta(step("browser_screenshot", null)).category, "browser");
  assert.equal(tool_meta(step("check_page", null)).icon, "page_check");
});

test("browser rows show an icon for their action", () => {
  const icons: Record<string, string> = {
    browser_tabs: "browser_tabs",
    browser_tab: "browser_tabs",
    browser_navigate: "browser_navigate",
    browser_snapshot: "browser_snapshot",
    browser_console: "browser_console",
    browser_eval: "browser_eval",
    browser_click: "browser_click",
    browser_click_point: "browser_click",
    browser_visual_click: "browser_click",
    browser_type: "browser_type",
    browser_key: "browser_key",
    browser_scroll: "browser_scroll",
    browser_wait: "browser_wait",
    browser_screenshot: "browser_screenshot",
    browser_visual_analyze: "browser_look",
  };
  for (const [name, icon] of Object.entries(icons)) {
    assert.equal(tool_meta(step(name, null)).icon, icon, name);
  }
  assert.equal(tool_meta(step("unknown_browser_action", views.browser)).icon, "browser");
});

test("a todo update row has no body to open, running or done, unless it failed", () => {
  assert.equal(has_body(t, step("update_todos", views.todos)), false);
  assert.equal(has_body(t, step("update_todos", null, "running")), false);
  assert.equal(has_body(t, { ...step("update_todos", null, "failed"), error: "todos must be a list" }), true);
});

test("a page read row names only the pages that were read when some of them failed", () => {
  const view = (failed: string[]): ToolView => ({ kind: "web_search", query: "q", depth: "basic", answer: "", sources: [], urls: ["https://a.example/doc", "https://b.example", "https://c.example"], failed: failed.map((url) => ({ url, error: "Failed to fetch url" })) });
  assert.equal(tool_label(t, step("web_search", view([]))), "Read 3 pages");
  assert.equal(tool_label(t, step("web_search", view(["https://b.example"]))), "Read 2 pages");
  assert.equal(tool_label(t, step("web_search", view(["https://b.example", "https://c.example"]))), "Read a.example/doc");
  assert.equal(tool_label(t, { ...step("web_search", view(["https://a.example/doc", "https://b.example", "https://c.example"])), status: "failed" }), "Read 3 pages");
});
