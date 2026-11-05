import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { take_agent_notes } from "../electron/agents/reports.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { create_agent_worktree } from "../electron/workflows/isolation.ts";
import { init_workflows, start_workflow } from "../electron/workflows/runtime.ts";
import { inline_source } from "../electron/workflows/saved.ts";
import { get_run, record_swept_worktrees, run_dir } from "../electron/workflows/store.ts";
import { ledger_add, ledger_entries, type LedgerEntry } from "../electron/worktrees/ledger.ts";
import { sweep_worktree_ledger } from "../electron/worktrees/sweep.ts";
import { completed, scripts, stop_runner, tools } from "./agents-runner-harness.ts";
import { git, skip_without_git } from "./git-kit.ts";
import { contents, context, ended, head, start_workflows, summary, wait_until, workflows_dir } from "./workflow-run-kit.ts";
import { exists, project_repo, worktree_env } from "./worktree-kit.ts";

let repo = "";

before(async () => {
  await start_workflows();
  if (skip_without_git) {
    return;
  }
  await worktree_env();
  repo = await project_repo("wf-isolation", { "src/app.ts": "export const a = 1\n" });
  tools.push({
    spec: { name: "write_here", description: "", parameters: { type: "object", properties: {} } },
    profiles: ["worker"],
    available: () => true,
    execute: async (ctx) => {
      await fs.writeFile(path.join(ctx.project_root, "src", "new.ts"), "export const b = 2\n");
      return { status: "done", text: `wrote into ${ctx.project_root}`, view: null };
    },
  });
});

after(stop_runner);

const branches = (dir: string) => git(dir, "for-each-ref", "--format=%(refname:strip=2)", "refs/heads/").split(/\r?\n/).filter(Boolean);

test("isolated agents get their own worktree, an unchanged one is removed and a changed one is kept", { skip: skip_without_git }, async () => {
  let writer_system = "";
  let writer_round = 0;
  scripts.set("wf iso writer", async (messages) => {
    writer_round += 1;
    writer_system = contents(messages)[0] ?? "";
    return writer_round === 1 ? completed({ tool_calls: [{ index: 0, id: "w0", name: "write_here", arguments: "{}" }], finish_reason: "tool_calls" }) : completed({ content: "wrote" });
  });
  scripts.set("wf iso reader", async () => completed({ content: "read only" }));
  const started = await start_workflow({
    context: { ...context("chat-iso"), project_root: repo, project_path: repo },
    source: inline_source(`${head("iso")}return await parallel([() => agent('wf iso writer', { isolation: 'worktree', label: 'writer' }), () => agent('wf iso reader', { isolation: 'worktree', label: 'reader' })])`),
    args: { present: false, value: undefined },
    resume: null,
  });
  const done = await ended(started.summary.run_id);
  assert.equal(done.status, "completed");
  assert.equal(done.result_preview, '["wrote","read only"]');
  const [writer, reader] = done.agents;
  assert.ok(writer?.worktree && reader?.worktree);
  assert.equal(writer.worktree.kept, true);
  assert.equal(reader.worktree.kept, false);
  assert.match(writer.worktree.branch, /^vx\/writer/);
  assert.equal(await fs.readFile(path.join(writer.worktree.path, "src", "new.ts"), "utf8"), "export const b = 2\n");
  assert.equal(await exists(path.join(repo, "src", "new.ts")), false);
  assert.equal(await exists(reader.worktree.path), false);
  assert.ok(branches(repo).includes(writer.worktree.branch));
  assert.ok(!branches(repo).includes(reader.worktree.branch));
  assert.match(writer_system, new RegExp(`You work in your own git worktree ${writer.worktree.path.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")} on the branch ${writer.worktree.branch}`));
});

test("an agent worktree a quit left behind is settled at the next start: an unchanged one goes with its branch, a changed one stays", { skip: skip_without_git }, async () => {
  const untouched = await create_agent_worktree(repo, repo, "quit untouched");
  const edited = await create_agent_worktree(repo, repo, "quit edited");
  const ours = (entries: LedgerEntry[]) => entries.filter((entry) => entry.path === untouched.path || entry.path === edited.path);
  assert.deepEqual(ours(await ledger_entries()).map((entry) => [entry.state, entry.branch?.name, entry.branch?.base]), [
    ["agent", untouched.branch, untouched.base],
    ["agent", edited.branch, edited.base],
  ]);
  await fs.writeFile(path.join(edited.dir, "src", "partial.ts"), "export const c = 3\n");
  await sweep_worktree_ledger();
  assert.equal(await exists(untouched.path), false);
  assert.ok(!branches(repo).includes(untouched.branch));
  assert.equal(await fs.readFile(path.join(edited.dir, "src", "partial.ts"), "utf8"), "export const c = 3\n");
  assert.ok(branches(repo).includes(edited.branch));
  assert.deepEqual(ours(await ledger_entries()), []);
  await ledger_add({ path: edited.path, project_path: repo, state: "agent", at: new Date().toISOString() });
  assert.deepEqual(ours(await ledger_entries()), [], "an agent entry without its branch is not trusted");
});

test("an isolated agent's worktree is recorded as kept only once the agent ended and it was decided", { skip: skip_without_git }, async () => {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  scripts.set("wf iso pending", async () => {
    await released;
    return completed({ content: "looked" });
  });
  const started = await start_workflow({
    context: { ...context("chat-iso-pending"), project_root: repo, project_path: repo },
    source: inline_source(`${head("iso-pending")}return await agent('wf iso pending', { isolation: 'worktree', label: 'pending' })`),
    args: { present: false, value: undefined },
    resume: null,
  });
  const run_id = started.summary.run_id;
  await wait_until(() => summary(run_id).agents[0]?.status === "running", "the isolated agent to run");
  const running = { ...summary(run_id).agents[0]?.worktree };
  const present = running.path ? await exists(running.path) : false;
  release();
  const done = await ended(run_id);
  assert.equal(running.kept, false, "nothing decided yet while the agent runs");
  assert.equal(present, true);
  assert.equal(done.status, "completed");
  assert.equal(done.agents[0]?.worktree?.kept, false);
  assert.equal(await exists(running.path ?? ""), false);
});

test("the startup sweep writes its keep or remove decision into the stored summary of an interrupted workflow", { skip: skip_without_git }, async () => {
  const untouched = await create_agent_worktree(repo, repo, "swept untouched");
  const edited = await create_agent_worktree(repo, repo, "swept edited");
  await fs.writeFile(path.join(edited.dir, "src", "half.ts"), "export const d = 4\n");
  const run_id = "wf_00000000-swept-0001";
  const now = new Date().toISOString();
  const entry = (index: number, tree: { dir: string; branch: string }) => ({
    index, label: `agent ${index}`, phase: null, role: "worker", model: "test/model", effort: "", status: "running", agent_id: null, agent_run_id: null,
    started_at: now, ended_at: null, worktree: { path: tree.dir, branch: tree.branch, kept: true }, structured: false, preview: "", error: "",
  });
  const state = {
    version: 1,
    args_text: "",
    summary: {
      run_id, chat_id: "chat-iso-swept", name: "swept", description: "d", when_to_use: "", status: "running", started_at: now, ended_at: null, phases: [],
      agents: [entry(0, untouched), entry(1, edited)], logs: [], script_path: "s.js", resumed_from: null, result_preview: "", error: "", parent_message_id: "m", parent_call_id: "c",
    },
  };
  await fs.mkdir(run_dir(run_id), { recursive: true });
  await fs.writeFile(path.join(run_dir(run_id), "state.json"), JSON.stringify(state));
  await init_workflows(workflows_dir());
  take_agent_notes("chat-iso-swept");
  record_swept_worktrees(await sweep_worktree_ledger());
  assert.equal(await exists(untouched.path), false);
  assert.equal(await exists(edited.path), true);
  assert.deepEqual(get_run(run_id)?.summary.agents.map((agent) => [agent.status, agent.worktree?.kept]), [
    ["interrupted", false],
    ["interrupted", true],
  ]);
  await writes_settled(path.join(run_dir(run_id), "state.json"));
  const saved = JSON.parse(await fs.readFile(path.join(run_dir(run_id), "state.json"), "utf8")) as { summary: { agents: { worktree: { kept: boolean } }[] } };
  assert.deepEqual(saved.summary.agents.map((agent) => agent.worktree.kept), [false, true]);
});
