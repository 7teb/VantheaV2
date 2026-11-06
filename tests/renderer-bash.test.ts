import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolStep } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { call_shell, command_tools, is_shell_run } from "../shared/shell.ts";
import type { ToolView } from "../shared/tool-view.ts";
import { compose_sections, type SectionInput } from "../electron/prompts/sections.ts";
import { live_command } from "../src/features/tools/tool-body.ts";
import { tool_label, tool_meta } from "../src/features/tools/tool-meta.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const en: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const long = "for f in src/*.ts; do\n  grep -c TODO \"$f\"\ndone";

const step = (name: string, status: ToolStep["status"], args: Record<string, unknown>, view: ToolView | null = null): ToolStep => ({
  id: `tool:1:${name}`,
  round: 1,
  kind: "tool",
  index: 0,
  call_id: `call-${name}`,
  name,
  args,
  status,
  progress: status === "running" ? { label: "", lines: 0, output_tail: null, can_background: true } : null,
  approval: null,
  view,
  error: null,
  result_text: "",
  started_at: 1000,
  ended_at: status === "done" ? 2500 : null,
});

test("the shell of a call follows the tool and the background shell argument", () => {
  assert.equal(call_shell("run_bash", {}), "bash");
  assert.equal(call_shell("run_command", {}), "powershell");
  assert.equal(call_shell("start_background_task", { shell: "bash" }), "bash");
  assert.equal(call_shell("start_background_task", {}), "powershell");
  assert.deepEqual([...command_tools], ["run_command", "run_bash", "start_background_task"]);
  assert.equal(is_shell_run("run_bash") && is_shell_run("run_command") && !is_shell_run("start_background_task"), true);
});

test("a run_bash row has its own icon and Git Bash labels in English and German", () => {
  assert.equal(tool_meta(step("run_bash", "done", { command: "ls" })).icon, "bash");
  assert.equal(tool_meta(step("run_bash", "done", { command: "ls" })).category, "commands");
  assert.equal(tool_meta(step("run_command", "done", { command: "ls" })).icon, "terminal");
  assert.equal(tool_label(en, step("run_bash", "running", { command: long })), "Running Git Bash");
  assert.equal(tool_label(en, step("run_bash", "awaiting_approval", { command: long })), "Run Git Bash command");
  assert.equal(tool_label(en, step("run_bash", "done", { command: long })), "Ran Git Bash");
  const moved: ToolView = { kind: "background", shell: "Git Bash", task_id: "bg_1", command: long, status: "running", output_tail: "" };
  assert.equal(tool_label(en, step("run_bash", "done", { command: long }, moved)), "Moved Git Bash to the background");
  assert.equal(tool_label(de, step("run_bash", "running", { command: long })), "Git Bash läuft");
  assert.equal(tool_label(de, step("run_bash", "done", { command: long })), "Git Bash ausgeführt");
  assert.equal(tool_label(en, step("run_command", "done", { command: long })), "Ran PowerShell");
  assert.equal(tool_label(en, step("run_bash", "done", { command: "ls -la" })), "Ran ls -la");
});

test("a running run_bash command shows the live card with the background move", () => {
  assert.equal(live_command(step("run_bash", "running", { command: "make" })), true);
  assert.equal(live_command(step("start_background_task", "running", { command: "make" })), false);
});

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

const sections = (names: string[], plan = false): SectionInput => ({
  model,
  mode: "auto",
  plan,
  personality: "pragmatic",
  project_root: "C:/proj",
  scratchpad: null,
  project_docs: [],
  listing: "",
  custom_instructions: "",
  tool_names: new Set(names),
  user_attachments: false,
  major: false,
  deferred_mcp: [],
});

const shell_body = (input: SectionInput) => compose_sections(input).find((section) => section.title === "shell")?.body ?? "";

test("the shell section explains run_bash only when it is offered and keeps PowerShell the default", () => {
  assert.doesNotMatch(shell_body(sections(["run_command", "write_file"])), /run_bash/);
  const main = shell_body(sections(["run_command", "run_bash", "write_file", "replace_in_file", "start_background_task"]));
  assert.match(main, /run_bash runs its string with Git Bash/);
  assert.match(main, /PowerShell through run_command stays the default shell/);
  assert.match(main, /double the slash of such switches \(cmd \/\/c, taskkill \/\/F\)/);
  assert.match(main, /start_background_task with shell bash/);
  const worker = shell_body(sections(["run_command", "run_bash", "write_file", "replace_in_file"]));
  assert.match(worker, /instead of sed -i or heredoc rewrites\./);
  assert.doesNotMatch(worker, /start_background_task/);
  const plan = shell_body(sections(["run_command", "run_bash", "read_file"], true));
  assert.match(plan, /The read-only rules above apply to run_bash as well/);
  assert.doesNotMatch(plan, /write_file|replace_in_file|Start-Process/);
});
