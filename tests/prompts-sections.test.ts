import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import { list_top_level, load_project_docs } from "../electron/prompts/project.ts";
import { compose_sections, render_sections, type SectionInput } from "../electron/prompts/sections.ts";

const model: ModelEntry = {
  id: "deepseek/deepseek-v4-flash",
  label: "DeepSeek V4 Flash",
  provider: "DeepSeek",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const base = (names: string[], over: Partial<SectionInput> = {}): SectionInput => ({
  model,
  mode: "auto",
  plan: false,
  personality: "pragmatic",
  project_root: "C:/proj",
  scratchpad: null,
  project_docs: [],
  listing: "src/\npackage.json",
  custom_instructions: "",
  tool_names: new Set(names),
  user_attachments: false,
  major: false,
  deferred_mcp: [],
  ...over,
});

const titles = (input: SectionInput) => compose_sections(input).map((section) => section.title);

test("tool sections appear only when the matching tool is offered", () => {
  const none = titles(base([]));
  assert.equal(none.includes("shell"), false);
  assert.equal(none.includes("editing"), false);
  assert.equal(none.includes("browser"), false);
  assert.equal(none.includes("mcp"), false);
  assert.equal(none.includes("web_search"), false);

  const full = titles(base(["run_command", "write_file", "browser_click", "analyze_image", "web_search", "generate_image", "load_mcp_tools", "call_mcp_tool"], { deferred_mcp: ["mcp__ce__scan"] }));
  assert.equal(full.includes("shell"), true);
  assert.equal(full.includes("editing"), true);
  assert.equal(full.includes("browser"), true);
  assert.equal(full.includes("attachments"), false);
  assert.equal(full.includes("web_search"), true);
  assert.equal(full.includes("image_generation"), true);
  assert.equal(full.includes("mcp"), true);
  assert.equal(full.includes("destructive_actions"), true);
});

test("identity and environment are always present, verification and permission mode follow the tools", () => {
  const always = titles(base([]));
  assert.equal(always.includes("identity"), true);
  assert.equal(always.includes("environment"), true);
  assert.equal(always.includes("verification"), false);
  assert.equal(always.includes("permission_mode"), false);
  const writer = titles(base(["run_command", "write_file"]));
  assert.equal(writer.includes("verification"), true);
  assert.equal(writer.includes("permission_mode"), true);
});

const main_tools = ["run_command", "write_file", "replace_in_file", "browser_snapshot", "browser_click", "browser_visual_analyze", "deploy_agent", "remember"];
const plan_tools = ["run_command", "read_file", "browser_snapshot", "browser_visual_analyze", "present_plan", "list_memories"];
const explore_tools = ["read_file", "search_files", "message_main_agent"];

const body_of = (input: SectionInput, title: string) => compose_sections(input).find((section) => section.title === title)?.body ?? "";

test("plan gets read-only shell and browser text and no verification or destructive-action sections", () => {
  const input = base(plan_tools, { plan: true });
  const shell = body_of(input, "shell");
  assert.match(shell, /Never write or change files through the shell/);
  assert.doesNotMatch(shell, /write_file|replace_in_file|Start-Process/);
  const browser = body_of(input, "browser");
  assert.match(browser, /clicking, typing and navigation are not available here/);
  assert.doesNotMatch(browser, /You can drive this chat's in-app browser|browser_visual_click/);
  assert.doesNotMatch(body_of(input, "identity"), /edit|not a read-only assistant/);
  const names = titles(input);
  assert.equal(names.includes("verification"), false);
  assert.equal(names.includes("destructive_actions"), false);
  assert.equal(names.includes("permission_mode"), true);
  assert.equal(names.includes("plan_mode"), true);
});

test("explore gets no shell, verification, permission mode or destructive-action text", () => {
  const input = base(explore_tools);
  const names = titles(input);
  for (const title of ["shell", "editing", "verification", "permission_mode", "destructive_actions", "browser"]) {
    assert.equal(names.includes(title), false, title);
  }
  assert.match(body_of(input, "identity"), /You read the user's real project files directly through your tools\.$/);
});

test("the model id and label are stated in the identity section", () => {
  const body = compose_sections(base([])).find((section) => section.title === "identity")?.body ?? "";
  assert.match(body, /deepseek\/deepseek-v4-flash/);
  assert.match(body, /DeepSeek V4 Flash/);
});

test("plan mode section only appears in plan mode", () => {
  assert.equal(titles(base([])).includes("plan_mode"), false);
  assert.equal(titles(base([], { plan: true })).includes("plan_mode"), true);
});

test("attachment and project-instruction sections are gated", () => {
  assert.equal(titles(base([])).includes("attachments"), false);
  assert.equal(titles(base(["analyze_image"])).includes("attachments"), false);
  assert.equal(titles(base([], { user_attachments: true })).includes("attachments"), true);
  const with_doc = base([], { project_docs: [{ name: "AGENTS.md", content: "rules" }] });
  assert.equal(titles(with_doc).includes("project_instructions"), true);
  assert.match(render_sections(compose_sections(with_doc)), /AGENTS\.md/);
  const both = render_sections(compose_sections(base([], { project_docs: [{ name: "AGENTS.md", content: "agent rules" }, { name: "CLAUDE.md", content: "claude rules" }] })));
  assert.match(both, /Auto-loaded from AGENTS\.md and CLAUDE\.md/);
  assert.match(both, /AGENTS\.md:\nagent rules\n\nCLAUDE\.md:\nclaude rules/);
});

test("a blank project root never reads instructions or a listing from the process folder", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vx-project-docs-"));
  const cwd = process.cwd();
  await fs.writeFile(path.join(folder, "AGENTS.md"), "Use tabs.\n");
  process.chdir(folder);
  try {
    assert.deepEqual(await load_project_docs(""), []);
    assert.deepEqual(await load_project_docs("  "), []);
    assert.equal(await list_top_level(""), "");
    assert.notDeepEqual(await load_project_docs(folder), []);
  } finally {
    process.chdir(cwd);
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("asking_user appears right before communication exactly when ask_user is offered, in main and plan", () => {
  for (const plan of [false, true]) {
    const with_tool = titles(base(["ask_user", "read_file"], { plan }));
    assert.equal(with_tool.indexOf("asking_user") + 1, with_tool.indexOf("communication"), `plan ${plan}`);
    assert.equal(titles(base(["read_file"], { plan })).includes("asking_user"), false, `plan ${plan}`);
  }
  const body = compose_sections(base(["ask_user"])).find((section) => section.title === "asking_user")?.body ?? "";
  assert.match(body, /^ask_user shows questions above the user's message box and returns at once\./);
  assert.match(body, /A dismissed question means: continue with your own judgment, and ask it again only when the situation changed\.$/);
});

test("the environment section names the chat's scratchpad and says it is temporary, and leaves it out without one", () => {
  const with_folder = body_of(base(main_tools, { scratchpad: "C:/Temp/VantheaX/scratchpad/0a1b" }), "environment");
  assert.match(with_folder, /This chat has its own scratchpad folder, C:\/Temp\/VantheaX\/scratchpad\/0a1b, for test scripts, probes, intermediate results and other throwaway files that do not belong in the project\./);
  assert.match(with_folder, /The app deletes it when the chat is deleted or the app closes, so never keep anything there that must last/);
  assert.doesNotMatch(body_of(base(main_tools), "environment"), /scratchpad/);
});

test("every permission mode text that mentions a denial lets a newer user message lift it", () => {
  for (const mode of ["ask", "auto", "full"] as const) {
    for (const plan of [false, true]) {
      const body = body_of(base(["run_command", "write_file"], { mode, plan }), "permission_mode");
      if (!body.includes("denial")) {
        continue;
      }
      assert.match(body, /newer user message asks for (it|that action) or approves it/, `${mode} plan=${plan}`);
    }
  }
});
