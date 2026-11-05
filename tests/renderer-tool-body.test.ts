import assert from "node:assert/strict";
import { test } from "node:test";
import type { HumanDecision } from "../shared/approval.ts";
import type { Step, ToolStep } from "../shared/chat.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { build_blocks } from "../src/features/chat/assistant-blocks.ts";
import { denial_note, has_body, shown_error } from "../src/features/tools/tool-body.ts";
import { tool_label } from "../src/features/tools/tool-meta.ts";
import { step_detail, step_hint } from "../src/features/tools/tool-summary.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const step = (name: string, view: ToolView | null, status: ToolStep["status"] = "done", args: Record<string, unknown> = {}, extra: Partial<ToolStep> = {}): ToolStep => ({
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
  ended_at: 2500,
  ...extra,
});

const page = (action: string, detail: string, title = "Example", url = "https://example.com/"): ToolView => ({ kind: "browser", action, url, title, detail });

const row = (item: ToolStep) => ({ label: tool_label(t, item), detail: step_detail(t, item), expandable: has_body(t, item) });

test("finished browser actions never expand and show no descriptive row detail", () => {
  const cases: [ToolStep, string][] = [
    [step("browser_tabs", page("tabs", "3 open")), "Managed browser tabs"],
    [step("browser_tab", page("new tab", "browser-1"), "done", { action: "new", url: "example.com" }), "Opened tab Example"],
    [step("browser_tab", page("select tab", "browser-1", "", "https://e.com/"), "done", { action: "select" }), "Switched to tab https://e.com/"],
    [step("browser_tab", page("close tab", "browser-1"), "done", { action: "close" }), "Closed tab Example"],
    [step("browser_navigate", page("goto", "loaded"), "done", { action: "goto", url: "https://example.com/" }), "Opened Example"],
    [step("browser_navigate", page("back", "loading"), "done", { action: "back" }), "Went back to Example"],
    [step("browser_navigate", page("reload", "loaded", "", ""), "done", { action: "reload" }), "Navigated the browser"],
    [step("browser_snapshot", page("snapshot", "42 refs, truncated")), "Read the browser page"],
    [step("browser_click", page("click", "Sign in"), "done", { ref: "b12" }), "Clicked Sign in"],
    [step("browser_click", page("double click", "Row"), "done", { ref: "b3", double: true }), "Double-clicked Row"],
    [step("browser_click", page("click", ""), "done", { ref: "b12" }), "Clicked b12"],
    [step("browser_type", page("type", 'Search: "cats" and pressed Enter'), "done", { ref: "b5" }), 'Typed in Search: "cats" and pressed Enter'],
    [step("browser_key", page("key", "Control+Enter"), "done", { key: "Enter" }), "Pressed Control+Enter"],
    [step("browser_scroll", page("scroll", "down, small")), "Scrolled the browser page"],
    [step("browser_wait", page("wait", "load")), "Waited for the browser page"],
    [step("browser_screenshot", page("screenshot", "1280 × 720")), "Took a screenshot of the browser page"],
    [step("browser_click_point", page("click point", "Submit"), "done", { x: 10, y: 20 }), "Clicked Submit"],
    [step("browser_visual_analyze", page("visual analyze", "7 regions")), "Analyzed the browser visually"],
    [step("browser_visual_click", page("visual click", "Logo"), "done", { ref: "v3" }), "Clicked visual target Logo"],
    [step("browser_legacy", page("zoom", "2x")), "Browser · zoom"],
  ];
  for (const [item, label] of cases) {
    assert.deepEqual(row(item), { label, detail: "", expandable: false }, item.name);
  }
});

test("browser rows keep page title and URL in the hover hint, once each", () => {
  assert.equal(step_hint(step("browser_wait", page("wait", "load"))), "Example\nhttps://example.com/");
  assert.equal(step_hint(step("browser_wait", page("wait", "load", "https://e.com/", "https://e.com/"))), "https://e.com/");
  assert.equal(step_hint(step("web_search", { kind: "web_search", query: "rust async", depth: "basic", answer: "", sources: [] })), "rust async");
  assert.equal(step_hint(step("read_file", { kind: "read", path: "a.ts", start_line: 1, end_line: 2, total_lines: 2, truncated: false })), "");
});

test("a failed browser action shows its error once and labels in command form without the raw ref", () => {
  const failed = step("browser_click", null, "failed", { ref: "b12" }, { error: "Snapshot expired" });
  assert.deepEqual(row(failed), { label: "Click element", detail: "", expandable: true });
  const legacy = step("browser_tab", page("tab select", "Browser tab not found", "", ""), "failed", { action: "select" }, { error: "Browser tab not found" });
  assert.deepEqual(row(legacy), { label: "Managed browser tabs", detail: "", expandable: true });
  const unknown = step("browser_legacy", page("zoom", "Zoom failed", "", ""), "failed", {}, { error: "Zoom failed" });
  assert.deepEqual(row(unknown), { label: "Browser · zoom", detail: "", expandable: true });
});

test("the date row shows only its label, a viewed image shows no folder", () => {
  const now = "2026-10-12T21:00:00.000+02:00 (Europe/Berlin)";
  assert.deepEqual(row(step("datetime", { kind: "text", text: now })), { label: "Checked the date and time", detail: "", expandable: false });
  assert.deepEqual(row(step("view_image", { kind: "text", text: "out/shots/a.png" }, "done", { path: "out/shots/a.png" })), {
    label: "Viewed image a.png",
    detail: "",
    expandable: false,
  });
  assert.deepEqual(row(step("view_image", { kind: "text", text: "photo.png" }, "done", { path: "C:/data/att_1.png" })), { label: "Viewed image photo.png", detail: "", expandable: false });
  assert.equal(has_body(t, step("check_page", { kind: "text", text: "FAIL x" })), true);
  assert.deepEqual(row(step("context_status", { kind: "text", text: "Context window: 200,000 tokens." })), { label: "Checked the context", detail: "", expandable: false });
  assert.deepEqual(row(step("list_agents", { kind: "text", text: "Agents of this chat: Reviewer (explore, done)" })), { label: "Listed agents", detail: "", expandable: false });
});

test("memory and skill rows show no detail, finished listings and web searches show their count", () => {
  assert.deepEqual(row(step("list_memories", { kind: "memory", action: "list", text: "" })), { label: "Read memories", detail: "", expandable: false });
  assert.deepEqual(row(step("read_skill", { kind: "skill", action: "read", name: "docs" }, "done", { name: "docs", file: "ref/api.md" })), {
    label: "Read skill docs",
    detail: "",
    expandable: false,
  });
  const failed_memory = step("remember", { kind: "memory", action: "remember", text: "" }, "failed", {}, { error: "disk full" });
  assert.equal(has_body(t, failed_memory), true);
  assert.deepEqual(row(step("list_files", { kind: "files", root: "src", files: [], directories: 2, truncated: false })), {
    label: "Listed files in src",
    detail: "0 files",
    expandable: false,
  });
  assert.deepEqual(row(step("list_files", { kind: "files", root: ".", files: ["a.ts"], directories: 0, truncated: false })), {
    label: "Listed files",
    detail: "1 file",
    expandable: true,
  });
  assert.equal(step_detail(t, step("list_files", { kind: "files", root: ".", files: ["a.ts", "b.ts"], directories: 0, truncated: true })), "2+ files");
  const empty_search = step("web_search", { kind: "web_search", query: "q", depth: "basic", answer: "", sources: [] });
  assert.deepEqual(row(empty_search), { label: "Searched the web for q", detail: "No results", expandable: false });
  const source = { title: "T", url: "https://e.com", snippet: "", published_date: "" };
  assert.equal(step_detail(t, step("web_search", { kind: "web_search", query: "q", depth: "basic", answer: "", sources: [source, source] })), "2 results");
  assert.equal(has_body(t, { ...empty_search, view: { kind: "web_search", query: "q", depth: "basic", answer: "a", sources: [] } }), true);
});

const command = (output: string, exit_code: number | null, extra: Partial<Extract<ToolView, { kind: "command" }>> = {}): ToolView => ({
  kind: "command",
  shell: "PowerShell",
  command: "mkdir x",
  cwd: ".",
  exit_code,
  output,
  timed_out: false,
  duration_ms: 10,
  ...extra,
});

test("a silent successful command stays closed, a failed or timed out one opens to its card", () => {
  assert.deepEqual(row(step("run_command", command("", 0), "done", { command: "mkdir x" })), { label: "Ran mkdir x", detail: "", expandable: false });
  assert.deepEqual(row(step("run_command", command("", 1), "failed", { command: "mkdir x" }, { error: "exit 1" })), {
    label: "Ran mkdir x",
    detail: "",
    expandable: true,
  });
  assert.deepEqual(row(step("run_command", command("", null, { timed_out: true }), "failed", { command: "mkdir x" })), {
    label: "Ran mkdir x",
    detail: "",
    expandable: true,
  });
  assert.deepEqual(row(step("run_command", command("made", 0), "done", { command: "mkdir x" })), { label: "Ran mkdir x", detail: "", expandable: true });
  assert.equal(has_body(t, step("run_command", command("", 0, { cwd: "sub" }), "done")), true);
  assert.equal(has_body(t, step("run_command", command("", 0, { command: "a\nb" }), "done")), true);
});

const denial = (feedback: string): HumanDecision => ({
  id: "d1",
  at: 2,
  actor: "main",
  tool: "write_file",
  subject: "a.ts",
  cwd: ".",
  approved: false,
  grant: "once",
  feedback,
  reason: "",
});

test("a denied write expands only when the denial carries feedback", () => {
  const without = step("write_file", null, "denied", { path: "a.ts" }, { decisions: [denial("")], result_text: "The user denied the edit to a.ts." });
  assert.deepEqual(row(without), { label: "Denied a.ts", detail: "", expandable: false });
  const with_feedback = step("write_file", null, "denied", { path: "a.ts" }, { decisions: [denial("use b.ts")], result_text: "The user denied the edit to a.ts. User feedback: use b.ts" });
  assert.equal(row(with_feedback).expandable, true);
  assert.deepEqual(
    denial_note(t, with_feedback)?.lines.map((line) => line.text),
    ["Your feedback: use b.ts"],
  );
  const denied_command = step("run_command", command("", null), "denied", { command: "rm x" }, { decisions: [denial("no")] });
  assert.equal(denial_note(t, denied_command), null);
  assert.equal(has_body(t, denied_command), true);
});

test("generated images stay in the tool rows without prompt or picture, present_images shows them as their own block", () => {
  const failed = step("generate_image", null, "failed", { prompt: "cat" }, { error: "quota" });
  const images = [{ id: "img_a.png", width: 1, height: 1 }];
  const done = step("generate_image", { kind: "generated_images", images }, "done", { prompt: "cat" });
  const shown = step("present_images", { kind: "image", images }, "done", { image_ids: ["img_a.png"] });
  const blocks = build_blocks([failed, { ...done, id: "tool:2" }, { ...shown, id: "tool:3" }] as Step[]);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["work", "image"],
  );
  assert.equal(has_body(t, failed), true);
  assert.equal(has_body(t, done), false);
  assert.equal(tool_label(t, done), "Generated image");
  assert.equal(tool_label(t, { ...shown, status: "running", view: null }), "Showing images");
  assert.equal(translate("de", "tool_label.presented_images"), "Bilder gezeigt");
});

test("a cancelled command keeps its partial output expandable", () => {
  const progress = { label: "", lines: 3, output_tail: "partial" };
  assert.equal(has_body(t, step("run_command", null, "cancelled", { command: "npm test" }, { progress })), true);
  assert.equal(has_body(t, step("run_command", null, "cancelled", { command: "npm test" })), false);
});

test("an MCP call in progress has no repeated detail", () => {
  const running = step("mcp__ida__decompile", null, "running", {}, { progress: { label: "", lines: null, output_tail: null } });
  assert.deepEqual(row(running), { label: "ida · decompile", detail: "", expandable: false });
});

test("url reads are labeled with the page address and show failed urls in the body instead of the raw error", () => {
  const url_view = (failed: { url: string; error: string }[]): ToolView => ({ kind: "web_search", query: "q", depth: "basic", answer: "", sources: [], urls: ["https://nodejs.org/api/test.html"], failed });
  assert.equal(tool_label(t, step("web_search", null, "running", { query: "q", urls: ["https://nodejs.org/api/test.html"] })), "Reading nodejs.org/api/test.html");
  assert.equal(tool_label(t, step("web_search", url_view([]))), "Read nodejs.org/api/test.html");
  assert.equal(tool_label(t, step("web_search", null, "running", { query: "q", urls: ["https://a.example/", "b.example"] })), "Reading 2 pages");
  assert.equal(tool_label(t, step("web_search", null, "running", { query: "q" })), "Searching the web");
  const failed = step("web_search", url_view([{ url: "https://nodejs.org/api/test.html", error: "404 page not found" }]), "failed", {}, { error: "Could not read https://nodejs.org/api/test.html: 404 page not found" });
  assert.equal(has_body(t, failed), true);
  assert.equal(shown_error(t, failed), null);
  const network = step("web_search", url_view([]), "failed", {}, { error: "Reading https://nodejs.org/api/test.html failed: Tavily 401" });
  assert.equal(shown_error(t, network), "Reading https://nodejs.org/api/test.html failed: Tavily 401");
  const coded = { ...network, failure: { kind: "reply" as const, text: "Tavily 401: Unauthorized" } };
  assert.equal(shown_error(t, coded), "Tavily 401: Unauthorized");
});
