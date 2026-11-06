import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { compose_sections, type SectionInput } from "../electron/prompts/sections.ts";
import type { ToolContext, ToolResult } from "../electron/tools/types.ts";
import { run_workflow_tool } from "../electron/tools/workflows/run.ts";
import { stop_workflow_tool } from "../electron/tools/workflows/stop.ts";
import { register_active } from "../electron/turn/active.ts";
import { settled_workflow, stop_workflow_run } from "../electron/workflows/runtime.ts";
import { list_saved } from "../electron/workflows/saved.ts";
import { chat_runs, on_workflow_changed, user_roles_dir, user_saved_dir } from "../electron/workflows/store.ts";
import { block_until_abort, completed, model, project, scripts, settings, stop_runner } from "./agents-runner-harness.ts";
import { answer, review_stub } from "./review-stub.ts";
import { contents, ended, head, start_workflows, summary, wait_until } from "./workflow-run-kit.ts";

before(async () => {
  await start_workflows();
  await fs.mkdir(path.join(project, ".vantheax", "workflows"), { recursive: true });
  await fs.mkdir(path.join(project, ".vantheax", "roles"), { recursive: true });
  await fs.mkdir(user_saved_dir(), { recursive: true });
  await fs.mkdir(user_roles_dir(), { recursive: true });
});

after(stop_runner);

const approvals: ApprovalRequest[] = [];

const ctx = (chat_id: string, verdict: "allow" | "deny" = "allow"): ToolContext => {
  register_active(chat_id, `turn-${chat_id}`, () => undefined, model, "");
  return {
    chat_id,
    turn_id: `turn-${chat_id}`,
    call_id: `call-${chat_id}`,
    project_root: project,
    user_request: "run a workflow",
    mode: "auto",
    profile: "main",
    model,
    image_fit: [],
    settings,
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async (request): Promise<ApprovalDecision> => {
      approvals.push(request);
      return { approved: true, grant: "once", feedback: "" };
    },
    side_model: async () => "",
    review: review_stub([answer(verdict, verdict === "deny" ? "the script deletes files the user did not mention" : "fine")]),
    message_main: null,
    send_peer: null,
    context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
};

const run_id_of = (result: ToolResult): string => {
  if (result.view?.kind !== "workflow") {
    throw new Error(`no workflow view: ${result.text}`);
  }
  return result.view.run_id;
};

test("run_workflow starts an inline script, returns at once and the result reaches the running turn", async () => {
  scripts.set("wf tool hello", async () => completed({ content: "hello back" }));
  const result = await run_workflow_tool.execute(ctx("chat-tool"), { script: `${head("tool-wf")}return { got: await agent('wf tool hello'), args }`, args: { list: [1, 2] } });
  assert.equal(result.status, "done");
  assert.match(result.text, /^Started workflow tool-wf \(run wf_[^)]+\) in the background: a workflow under test/);
  assert.match(result.text, /Do not poll/);
  const run_id = run_id_of(result);
  assert.equal(result.view?.kind === "workflow" ? result.view.script_path : "", summary(run_id).script_path);
  const done = await ended(run_id);
  assert.equal(done.result_preview, '{"got":"hello back","args":{"list":[1,2]}}');
  assert.equal(done.agents[0]?.model, model.id);
  assert.equal(await fs.readFile(done.script_path, "utf8"), `${head("tool-wf")}return { got: await agent('wf tool hello'), args }`);
  await wait_until(() => take_agent_notes("chat-tool").some((note) => note.kind === "notice" && note.notice === "workflow_result" && note.text.includes(run_id)), "the injected notice");
});

test("args sent as a JSON-encoded object or array string reach the script parsed, other strings stay strings", async () => {
  const cases: [unknown, string][] = [
    ['{"items":[1,2]}', '{"items":[1,2]}'],
    [" [3, 4]", "[3,4]"],
    ["plain text", '"plain text"'],
    ["{not json", '"{not json"'],
    ['"quoted"', '"\\"quoted\\""'],
    ["42", '"42"'],
  ];
  for (const [args, preview] of cases) {
    const result = await run_workflow_tool.execute(ctx("chat-args-string"), { script: `${head("args-wf")}return args`, args });
    assert.equal(result.status, "done", result.text);
    assert.equal((await ended(run_id_of(result))).result_preview, preview, `args ${JSON.stringify(args)}`);
  }
});

test("the gate reviews the script, a denial creates no run", async () => {
  const result = await run_workflow_tool.execute(ctx("chat-deny", "deny"), { script: `${head()}return 1` });
  assert.equal(result.status, "denied");
  assert.equal(chat_runs("chat-deny").length, 0);
});

test("a syntax error is the tool result and nothing runs", async () => {
  const result = await run_workflow_tool.execute(ctx("chat-syntax"), { script: `${head()}let x: number = 1` });
  assert.equal(result.status, "failed");
  assert.match(result.text, /^The workflow did not start, nothing ran:\nSyntaxError/);
  assert.equal(chat_runs("chat-syntax")[0]?.status, "failed");
});

test("a stop while the workflow is still starting is the tool result and no notice follows", async () => {
  const chat_id = "chat-tool-early-stop";
  const off = on_workflow_changed((changed) => {
    if (changed.chat_id === chat_id && changed.status === "running") {
      setImmediate(() => stop_workflow_run(changed.run_id, "user"));
    }
  });
  const result = await run_workflow_tool.execute(ctx(chat_id), { script: `${head()}return 1` });
  off();
  assert.equal(result.status, "failed");
  assert.match(result.text, /^The workflow was stopped before its script ran, nothing ran: The user stopped the workflow\.\nThe script is saved at .*script\.js; call run_workflow again to run it\.$/);
  const run_id = run_id_of(result);
  await settled_workflow(run_id);
  assert.equal(summary(run_id).status, "stopped");
  assert.equal(take_agent_notes(chat_id).length, 0);
});

test("bad arguments and bad meta fail before anything runs", async () => {
  await assert.rejects(async () => run_workflow_tool.execute(ctx("chat-args"), {}), /pass the script inline/);
  await assert.rejects(async () => run_workflow_tool.execute(ctx("chat-args"), { script: "   " }), /script must not be blank/);
  await assert.rejects(async () => run_workflow_tool.execute(ctx("chat-args"), { resume_from: "run_1" }), /resume_from must be a workflow run id/);
  const meta = await run_workflow_tool.execute(ctx("chat-args"), { script: "return 1" });
  assert.equal(meta.status, "failed");
  assert.match(meta.text, /must start with export const meta/);
  const unknown = await run_workflow_tool.execute(ctx("chat-args"), { name: "does-not-exist" });
  assert.match(unknown.text, /^No saved workflow does-not-exist\./);
  assert.equal(chat_runs("chat-args").length, 0);
});

test("saved workflows run by name from the project and the user folder, script_path from the project", async () => {
  scripts.set("wf saved project", async () => completed({ content: "from project" }));
  scripts.set("wf saved user", async () => completed({ content: "from user" }));
  await fs.writeFile(path.join(project, ".vantheax", "workflows", "proj.js"), "export const meta = { name: 'proj', description: 'project workflow', whenToUse: 'in tests' }\nreturn await agent('wf saved project')");
  await fs.writeFile(path.join(user_saved_dir(), "mine.js"), "export const meta = { name: 'mine', description: 'user workflow' }\nreturn await agent('wf saved user')");
  await fs.writeFile(path.join(user_saved_dir(), "proj.js"), "export const meta = { name: 'proj', description: 'shadowed by the project' }\nreturn 0");
  await fs.writeFile(path.join(project, "loose.js"), "export const meta = { name: 'loose', description: 'by path' }\nreturn args.n * 2");
  const listed = await list_saved(project, user_saved_dir());
  assert.deepEqual(listed.map((entry) => [entry.name, entry.scope, entry.description]), [
    ["proj", "project", "project workflow"],
    ["mine", "user", "user workflow"],
  ]);
  const from_project = await ended(run_id_of(await run_workflow_tool.execute(ctx("chat-saved"), { name: "proj" })));
  const from_user = await ended(run_id_of(await run_workflow_tool.execute(ctx("chat-saved"), { name: "MINE.js" })));
  const by_path = await ended(run_id_of(await run_workflow_tool.execute(ctx("chat-saved"), { script_path: "loose.js", script: "ignored", args: { n: 21 } })));
  assert.deepEqual([from_project.result_preview, from_user.result_preview, by_path.result_preview], ['"from project"', '"from user"', "42"]);
});

test("a child workflow and a saved role come from the project folders", async () => {
  let system = "";
  scripts.set("wf child 2", async (messages) => {
    system = contents(messages)[0] ?? "";
    return completed({ content: "child done" });
  });
  await fs.writeFile(path.join(project, ".vantheax", "roles", "critic.md"), "---\nname: critic\ndescription: finds weak spots\nprofile: explore\n---\nAttack every assumption.\n");
  await fs.writeFile(path.join(user_roles_dir(), "broken.md"), "no frontmatter here");
  await fs.writeFile(
    path.join(project, ".vantheax", "workflows", "child.js"),
    "export const meta = { name: 'child', description: 'child', phases: [{ title: 'Inner' }] }\nphase('Inner')\nreturn await agent('wf child ' + args.n, { role: 'critic' })",
  );
  const body = "const r = await workflow('child', { n: 2 })\nlet broken = ''\ntry { await agent('wf never', { role: 'broken' }) } catch (error) { broken = error.message }\nreturn { r, broken }";
  const done = await ended(run_id_of(await run_workflow_tool.execute(ctx("chat-child"), { script: `${head("parent")}${body}` })));
  assert.equal(done.status, "completed");
  assert.match(done.result_preview, /^\{"r":"child done","broken":"the role broken from .*broken\.md cannot be used: a role file must start with a frontmatter block/);
  assert.match(system, /Your role is critic\. Its instructions:\nAttack every assumption\./);
  assert.match(system, /Your profile is explore/);
  assert.deepEqual(done.phases.map((phase) => phase.title), ["Scan", "▸ child", "▸ child: Inner"]);
  assert.equal(done.agents[0]?.phase, "▸ child: Inner");
});

test("resume reuses the earlier script and args, refuses a running run and another chat's run", async () => {
  scripts.set("wf resume me", async () => completed({ content: "kept" }));
  scripts.set("wf resume block", block_until_abort);
  const first = await ended(run_id_of(await run_workflow_tool.execute(ctx("chat-tool-resume"), { script: `${head()}return [await agent('wf resume me'), args]`, args: ["x"] })));
  const resumed = await run_workflow_tool.execute(ctx("chat-tool-resume"), { resume_from: first.run_id });
  assert.match(resumed.text, /It resumes wf_[^:]+: up to 1 journaled agent result return at once/);
  const second = await ended(run_id_of(resumed));
  assert.equal(second.result_preview, '["kept",["x"]]');
  assert.deepEqual(second.agents.map((agent) => agent.status), ["cached"]);
  const other = await run_workflow_tool.execute(ctx("chat-elsewhere"), { resume_from: first.run_id });
  assert.equal(other.status, "failed");
  assert.match(other.text, /^No workflow run wf_.* exists in this chat\./);
  const running = run_id_of(await run_workflow_tool.execute(ctx("chat-tool-resume"), { script: `${head()}return await agent('wf resume block')` }));
  await wait_until(() => summary(running).agents[0]?.status === "running", "the blocking agent");
  const refused = await run_workflow_tool.execute(ctx("chat-tool-resume"), { resume_from: running });
  assert.match(refused.text, /is still running; stop it with stop_workflow first/);
  const stopped = await stop_workflow_tool.execute(ctx("chat-tool-resume"), { run_id: running });
  assert.match(stopped.text, /^Stopped workflow wf-test \(run wf_[^)]+\)\. 1 running agent was stopped; 0 agent results are journaled\./);
  assert.equal(summary(running).status, "stopped");
  assert.equal(summary(running).error, "The main agent stopped the workflow with stop_workflow.");
  const again = await stop_workflow_tool.execute(ctx("chat-tool-resume"), { run_id: running });
  assert.match(again.text, /is not running \(stopped\); nothing was stopped/);
  const foreign = await stop_workflow_tool.execute(ctx("chat-elsewhere"), { run_id: running });
  assert.equal(foreign.status, "failed");
  assert.ok(!take_agent_notes("chat-tool-resume").some((note) => note.text.includes(running)), "a run the main agent stopped sends no notice");
});

test("only the main profile gets the workflow tools and the prompt section explains them", () => {
  assert.deepEqual(run_workflow_tool.profiles, ["main"]);
  assert.deepEqual(stop_workflow_tool.profiles, ["main"]);
  const input: SectionInput = { model, mode: "auto", plan: false, personality: "pragmatic", project_root: project, scratchpad: null, project_docs: [], listing: "", custom_instructions: "", tool_names: new Set(["run_workflow"]), user_attachments: false, major: false, deferred_mcp: [] };
  const body = (over: Partial<SectionInput>) => compose_sections({ ...input, ...over }).find((entry) => entry.title === "workflows")?.body ?? "";
  const normal = body({});
  assert.match(normal, /load the workflow-authoring skill with read_skill/);
  assert.match(normal, /no limit on agents, concurrency, rounds or time/);
  assert.match(normal, /Run a workflow only when the user explicitly asks for one or names a saved workflow/);
  assert.match(normal, /deploy its independent parts with deploy_agent/);
  assert.doesNotMatch(normal, /prefer a workflow/);
  const major = body({ major: true });
  assert.match(major, /Major mode is on, so prefer a workflow over separate deploy_agent calls when it fits/);
  assert.match(major, /A single deploy_agent is enough for one bounded delegated task/);
  assert.doesNotMatch(major, /only when the user explicitly asks/);
  assert.match(major, /load the workflow-authoring skill with read_skill/);
  assert.equal(compose_sections({ ...input, tool_names: new Set() }).some((entry) => entry.title === "workflows"), false);
  assert.match(run_workflow_tool.spec.description, /workflow-authoring skill/);
  assert.match(run_workflow_tool.spec.description, /When to run one is set by the workflows section of your instructions/);
  assert.doesNotMatch(run_workflow_tool.spec.description, /own judgment/);
});
