import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { begin_run, create_agent, get_agent } from "../electron/agents/store.ts";
import { continue_agent, init_agents } from "../electron/agents/runner.ts";
import { live_run } from "../electron/agents/live.ts";
import { set_agent_continuation } from "../electron/agents/reports.ts";
import { create_chat, flush_all_sync, get_chat } from "../electron/chats/store.ts";
import { boot_chats, chat_dirs_in, make_root } from "./fixtures/legacy/harness.ts";
import { completed, model, settings } from "./agents-runner-harness.ts";

const roots: string[] = [];
const make = async () => { const root = await make_root("vx-agent-chat-storage-"); roots.push(root); return root; };
after(async () => { flush_all_sync(); for (const root of roots) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

test("real process exit after synchronous flush retains every queued journal batch once", async () => {
  const file = path.join(await make(), "events.jsonl");
  const module = pathToFileURL(path.resolve("electron/agents/journal.ts")).href;
  const program = `import {append_journal,flush_journal,flush_journals_sync} from ${JSON.stringify(module)};const file=${JSON.stringify(file)};for(let seq=0;seq<20;seq++){append_journal(file,{seq});void flush_journal(file);}flush_journals_sync();process.exit(0);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", program], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const events = (await fs.readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line).seq);
  assert.deepEqual(events, Array.from({ length: 20 }, (_, index) => index));
});

test("a rejected duplicate continuation cannot release the first preparation's prune protection", async () => {
  const root = await make();
  const fields = { chat_id: "double-continue", name: "Agent", description: "", topic: "", scope: [], model: model.id, effort: "", profile: "explore" as const, without_tools: [], project_root: root };
  const agents = Array.from({ length: 300 }, (_, index) => ({ ...fields, agent_id: `agent_${index}`, created_at: "2020-01-01T00:00:00.000Z", updated_at: `2020-01-${index === 0 ? "01" : "02"}T00:00:00.000Z`, runs: [{ run_id: `run_${index}`, prompt: "old", status: "completed", started_at: "2020-01-01T00:00:00.000Z", ended_at: "2020-01-01T00:00:00.000Z", report: "old report", open_questions: 0, parent_message_id: "parent" }], held: [] }));
  await fs.writeFile(path.join(root, "index.json"), JSON.stringify({ version: 1, agents }));
  let release = () => {};
  let enter = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const reports: unknown[] = [];
  set_agent_continuation((notice) => reports.push(notice));
  await init_agents({ dir: root, stream: async (_request, callbacks) => { callbacks.on_text("continued"); return completed({ content: "continued" }); }, resolve_tools: () => [], side_model: async () => "", review_call: async () => { throw new Error("unexpected review"); }, models: async () => { enter(); await gate; return [model]; } });
  const agent = get_agent("agent_0")!;
  const request = { chat_id: fields.chat_id, parent_message_id: "parent", parent_call_id: "call", project_root: root, user_request: "continue", mode: "ask" as const, settings, prompt: "continue" };
  const first = continue_agent(agent, request);
  await entered;
  await assert.rejects(continue_agent(agent, request), /already starting/);
  const other = create_agent(fields);
  begin_run(other, "other", "parent");
  assert.equal(get_agent(agent.agent_id), agent);
  release();
  const started = await first;
  for (let index = 0; index < 400 && live_run(started.run.run_id); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(live_run(started.run.run_id), null);
  assert.equal(agent.runs.at(-1)?.status, "completed");
  assert.equal(reports.length, 1);
});

test("concurrent chat creation retains each first body until canonical storage exists", async () => {
  const root = await make();
  await boot_chats(root);
  const chats = await Promise.all(Array.from({ length: 40 }, () => create_chat("")));
  for (const chat of chats) {
    assert.ok((await fs.stat(path.join(chat_dirs_in(root).data_dir, `${chat.id}.vxc`))).isFile());
    assert.equal((await get_chat(chat.id))?.id, chat.id);
  }
  flush_all_sync();
});
