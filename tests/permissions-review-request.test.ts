import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { clear_authorization } from "../electron/permissions/context.ts";
import { forget_instruction_files } from "../electron/permissions/instruction-files.ts";
import { action_lines } from "../electron/permissions/review-lines.ts";
import { current_part } from "../electron/permissions/review-action.ts";
import { fit_scripts, trim_steps } from "../electron/permissions/review-budget.ts";
import { fit_actions } from "../electron/permissions/review-sections.ts";
import { inspect_command_sources } from "../electron/permissions/sources.ts";
import { command_targets, program_lines, target_facts } from "../electron/permissions/target-facts.ts";
import type { AssembledReview } from "../electron/permissions/review-request.ts";
import { review_headers } from "../electron/permissions/review-prompt.ts";
import { clear_review_chat } from "../electron/permissions/review-state.ts";
import { forget_chat_writes } from "../electron/permissions/written-files.ts";
import type { Message, ToolStep } from "../shared/chat.ts";
import { golden_chat_id } from "./fixtures/review/golden.ts";
import { golden_review, golden_text, prepare_golden } from "./fixtures/review/golden-build.ts";

let root = "";
let real_root = "";
let messages: Message[] = [];
let main: AssembledReview;
let agent: AssembledReview;

const fixture = async (name: string) => (await fs.readFile(path.join(import.meta.dirname, "fixtures", "review", name), "utf8")).replace(/\r\n/g, "\n");

const all_text = (review: AssembledReview) => review.call.parts.map((part) => part.text).join("");

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-golden-"));
  real_root = await fs.realpath(root);
  messages = await prepare_golden(root);
  main = await golden_review(root, messages, "main");
  agent = await golden_review(root, messages, "agent");
});

after(async () => {
  clear_review_chat(golden_chat_id);
  clear_authorization(golden_chat_id);
  forget_instruction_files(golden_chat_id);
  forget_chat_writes(golden_chat_id);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("the assembled requests equal the golden files byte for byte", async () => {
  assert.equal(golden_text(main, root, real_root), await fixture("main.txt"));
  assert.equal(golden_text(agent, root, real_root), await fixture("agent.txt"));
});

test("sections come in the fixed order with markers on the stable parts only", () => {
  assert.deepEqual(main.call.parts.map((part) => part.marker), [true, true, false]);
  assert.equal(main.call.session_id, `vx-review:${golden_chat_id}`);
  const text = all_text(main);
  const order = [
    review_headers.project,
    review_headers.custom_instructions,
    review_headers.instruction_files,
    review_headers.human_messages,
    review_headers.reviewed_agent,
    review_headers.earlier_decisions,
    review_headers.agent_actions,
    review_headers.reviewed_scripts,
    review_headers.pending_action,
    review_headers.scripts_run,
    review_headers.agent_edits,
    review_headers.target_facts,
  ].map((header) => text.indexOf(`${header}:\n`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(main.call.parts[0]?.text, agent.call.parts[0]?.text);
});

test("all 63 human messages appear without an omitted-count line", () => {
  const human = main.call.parts[0]?.text ?? "";
  assert.match(human, /HUMAN MESSAGES:\n#1 \{"human":"Human request number 1: /);
  assert.doesNotMatch(human, /not shown/);
  assert.equal((human.match(/^#\d+ \{"human":/gm) ?? []).length, 63);
  assert.match(human, /#63 \{"human":"Human request number 60/);
});

test("every decision line carries human_spoke_since and the visibility follows the actor", () => {
  for (const review of [main, agent]) {
    const lines = (review.call.parts[1]?.text ?? "").split("\n").filter((line) => line.startsWith('{"id":"d'));
    assert.ok(lines.length > 0);
    for (const line of lines) assert.equal(typeof (JSON.parse(line) as { human_spoke_since: unknown }).human_spoke_since, "boolean");
  }
  assert.doesNotMatch(all_text(main), /npm test --workspace worker","cwd"/);
  const agent_text = all_text(agent);
  assert.match(agent_text, /"action":"npm install -g typescript@5\.9".*"status":"approved by the user"/);
  assert.match(agent_text, /"action":"git push origin HEAD:main".*"status":"denied by the review"/);
  assert.match(agent_text, /"action":"git push origin worker".*"status":"denied by the user".*"feedback":"no pushing from the worker"/);
  assert.doesNotMatch(agent_text, /"action":"git status"/);
});

test("earlier scripts are summary lines and current scripts are sent whole", () => {
  const scripts = (main.call.parts[1]?.text ?? "").split(`${review_headers.reviewed_scripts}:\n`)[1] ?? "";
  assert.match(scripts, /^\{"path":"tools\/clean\.ps1","hash":"0{16}","verdict":"allow","summary":"Deletes the build folder\."/);
  assert.doesNotMatch(scripts, /Remove-Item/);
  const current = main.call.parts.at(-1)?.text ?? "";
  assert.match(current, /BEGIN FILE tools\/clean\.ps1 \(id s1, started, .*changed since the review at 10-10 08:45:10\)[^\n]*\nRemove-Item -Recurse -Force build\nRemove-Item -Recurse -Force \.cache\n/);
  assert.match(current, /BEGIN FILE tools\/sync\.ps1 \(id s2, started/);
  assert.deepEqual([...main.sent].sort(), ["s1", "s2"]);
});

test("the instruction snapshot stays and agent edits come as a labeled diff", () => {
  assert.match(main.call.parts[0]?.text ?? "", /- Never push to main\./);
  assert.doesNotMatch(main.call.parts[0]?.text ?? "", /Agents may push/);
  assert.match(main.call.parts.at(-1)?.text ?? "", /AGENT EDITS TO INSTRUCTION FILES:\nchanges since human message #63, made by the agent or its commands; not the human's rules\n--- AGENTS\.md\n[\s\S]*-- Never push to main\.\n\+- Agents may push to main freely\./);
});

test("a second build is identical and an appended action only adds a later block", async () => {
  const again = await golden_review(root, messages, "main");
  assert.deepEqual(again.call, main.call);
  const extra: ToolStep = {
    id: "step-extra",
    round: 3,
    kind: "tool",
    index: 1,
    call_id: "c60_extra",
    name: "read_file",
    args: { path: "README.md" },
    status: "done",
    progress: null,
    approval: null,
    view: null,
    error: null,
    result_text: "",
    started_at: null,
    ended_at: null,
  };
  const appended = messages.map((message) => (message.id === "a60" && message.role === "assistant" ? { ...message, steps: [...message.steps.slice(0, -1), extra, ...message.steps.slice(-1)] } : message));
  const next = await golden_review(root, appended, "main");
  const stable = main.call.parts.slice(0, -1).map((part) => part.text);
  assert.deepEqual(next.call.parts.slice(0, stable.length).map((part) => part.text), stable);
  assert.equal(next.call.parts.length, main.call.parts.length + 1);
  assert.equal(next.call.parts.at(-2)?.text, `${review_headers.agent_actions}:\n{"tool":"read_file","arg":"README.md","status":"done"}\n\n`);
  assert.deepEqual(next.call.parts.map((part) => part.marker), [true, true, true, false]);
});

test("an earlier turn's step with the same engine call id stays in AGENT ACTIONS, only the pending one is left out", () => {
  const step = (status: ToolStep["status"], command: string): ToolStep => ({
    id: `s-${command}`, round: 1, kind: "tool", index: 0, call_id: "c1_0", name: "run_command", args: { command }, status,
    progress: null, approval: null, view: null, error: null, result_text: "", started_at: null, ended_at: null,
  });
  const lines = action_lines([step("done", "npm test"), step("running", "git push")], [], "c1_0");
  assert.deepEqual(lines.map((line) => JSON.parse(line.text).command), ["npm test"]);
});

test("earlier commands and writes reach the review whole, and are only cut once the request is too large", () => {
  const command = `npm run build -- ${"x".repeat(900)}`;
  const content = "y".repeat(9000);
  const steps: ToolStep[] = [
    { id: "s1", round: 1, kind: "tool", index: 0, call_id: "c1", name: "run_command", args: { command }, status: "done", progress: null, approval: null, view: null, error: null, result_text: "", started_at: null, ended_at: null },
    { id: "s2", round: 1, kind: "tool", index: 1, call_id: "c2", name: "write_file", args: { path: "a.txt", content }, status: "done", progress: null, approval: null, view: null, error: null, result_text: "", started_at: null, ended_at: null },
  ];
  const lines = action_lines(steps, [], "c9");
  const whole = fit_actions(lines, 0, 0);
  assert.equal(JSON.parse(whole[0] ?? "{}").command, command);
  assert.equal(JSON.parse(whole[1] ?? "{}").text, content);
  const cut = fit_actions(lines, trim_steps.indexOf("actions") + 1, 0);
  assert.ok(cut.every((line) => !line.includes("x".repeat(900)) && !line.includes(content)));
});

test("an input file is sent with role input, program facts and notes precede the targets", async () => {
  const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "vx-input-")));
  await fs.writeFile(path.join(project, "probe.vcxproj"), "<Project><Target Name=\"Build\" /></Project>");
  const sources = await inspect_command_sources(project, project, "MSBuild.exe probe.vcxproj out.log", { chat_id: "input-label", chat_started_at: Number.POSITIVE_INFINITY, env: { PATH: "" } });
  const placement = fit_scripts(sources.files);
  const facts = [...program_lines(sources.programs, sources.notes, sources.files), ...(await target_facts(await command_targets("MSBuild.exe probe.vcxproj out.log", project, sources.files, {}), { chat_id: "input-label", chat_started_at: Number.POSITIVE_INFINITY }, async () => ""))];
  const text = current_part({ tool: "run_command", cwd: project, background: false, subject: "MSBuild.exe probe.vcxproj out.log", call: { kind: "command" }, files: sources.files, gaps: [], changed: [], edits: { text: "", since: 1 }, facts }, placement, [], "t").text;
  assert.match(text, /BEGIN FILE probe\.vcxproj \(id s1, input, \d+ characters/);
  const lines = text.split(`${review_headers.target_facts}:\n`)[1]?.split("\n") ?? [];
  assert.equal(lines[0], "started MSBuild.exe: MSBuild.exe, not found on PATH");
  assert.match(lines[1] ?? "", /^probe\.vcxproj: .*probe\.vcxproj, file, \d+ bytes$/);
  assert.match(lines[2] ?? "", /^out\.log: .*out\.log, does not exist$/);
  await fs.rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
