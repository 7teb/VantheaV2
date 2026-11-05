import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { append_journal, close_journal, drop_journal, flush_journal, flush_journals_sync, read_journal } from "../electron/agents/journal.ts";
import { begin_run, create_agent, end_run, get_agent, init_agent_store, list_agents, remove_agents } from "../electron/agents/store.ts";
import { append_message, create_chat, flush_all_sync, fork_chat, get_chat } from "../electron/chats/store.ts";
import { schedule_save } from "../electron/chats/persist.ts";
import { boot_chats, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";
import { continue_agent, init_agents } from "../electron/agents/runner.ts";
import { set_agent_continuation } from "../electron/agents/reports.ts";
import { completed, model, settings } from "./agents-runner-harness.ts";

const roots: string[] = [];
const root_for = async () => { const root = await make_root("vx-agent-journal-"); roots.push(root); return root; };
after(async () => { flush_all_sync(); for (const root of roots) await fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

test("shutdown keeps a journal batch queued before its promise callback runs", async () => {
  const file = path.join(await root_for(), "journal.jsonl");
  append_journal(file, { seq: 1, text: "queued" });
  const writing = flush_journal(file);
  append_journal(file, { seq: 2, text: "shutdown" });
  flush_journals_sync();
  try { assert.deepEqual(fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)), [{ seq: 1, text: "queued" }, { seq: 2, text: "shutdown" }]); }
  finally { await writing; await close_journal(file); }
});

test("a starting agent survives prune when all stored timestamps tie", async (t) => {
  const root = await root_for();
  const time = "2026-11-05T10:00:00.000Z";
  const fields = { chat_id: "chat", name: "Agent", description: "", topic: "", scope: [], model: "model", effort: "", profile: "explore" as const, without_tools: [], project_root: root };
  const agents = Array.from({ length: 300 }, (_, index) => ({ ...fields, agent_id: `agent_${index}`, created_at: time, updated_at: time, runs: [{ run_id: `run_${index}`, prompt: "old", status: "completed", started_at: time, ended_at: time, report: "complete", open_questions: 0, parent_message_id: "parent" }], held: [] }));
  await fsp.writeFile(path.join(root, "index.json"), JSON.stringify({ version: 1, agents }));
  await init_agent_store(root);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(time) });
  const agent = create_agent(fields);
  const run = begin_run(agent, "new", "parent");
  const ended = end_run(agent.agent_id, run.run_id, "completed", "new report");
  assert.equal(get_agent(agent.agent_id), agent);
  assert.equal(ended?.report, "new report");
  assert.equal(list_agents("chat").length, 300);
});

for (const fork of [false, true]) test(`${fork ? "forked" : "new"} chat has a file when every older cache entry has pending writes`, async () => {
  const root = await root_for();
  await boot_chats(root);
  const old = [];
  for (let index = 0; index < 16; index += 1) old.push(await create_chat(""));
  if (fork) await append_message(old[0].id, user_message("u1", "preserved"));
  for (const chat of old) schedule_save(chat.id);
  const created = await (fork ? fork_chat(old[0].id, "u1") : create_chat(""));
  assert.equal(fs.existsSync(path.join(chat_dirs_in(root).data_dir, `${created.id}.vxc`)), true);
  assert.ok(await get_chat(created.id));
  flush_all_sync();
});

test("dropping a journal cancels its queued batch without recreating deleted files", async () => {
  const file = path.join(await root_for(), "dropped", "journal.jsonl");
  append_journal(file, { seq: 1 });
  const writing = flush_journal(file);
  drop_journal(file);
  await writing;
  assert.equal(fs.existsSync(file), false);
});

test("normal journal flushes preserve exact ordering without duplicate shutdown writes", async () => {
  const file = path.join(await root_for(), "normal", "journal.jsonl");
  append_journal(file, { seq: 1 });
  await flush_journal(file);
  append_journal(file, { seq: 2 });
  const writing = flush_journal(file);
  flush_journals_sync();
  await writing;
  flush_journals_sync();
  assert.deepEqual(await read_journal(file), [{ seq: 1 }, { seq: 2 }]);
  await close_journal(file);
});

test("a continuing agent stays retained while model preparation awaits", async () => {
  const root = await root_for();
  const fields = { chat_id: "continue-chat", name: "Agent", description: "", topic: "", scope: [], model: model.id, effort: "", profile: "explore" as const, without_tools: [], project_root: root };
  const agents = Array.from({ length: 300 }, (_, index) => ({ ...fields, agent_id: `agent_${index}`, created_at: "2020-01-01T00:00:00.000Z", updated_at: `2020-01-${index === 0 ? "01" : "02"}T00:00:00.000Z`, runs: [{ run_id: `run_${index}`, prompt: "old", status: "completed", started_at: "2020-01-01T00:00:00.000Z", ended_at: "2020-01-01T00:00:00.000Z", report: "complete", open_questions: 0, parent_message_id: "parent" }], held: [] }));
  await fsp.writeFile(path.join(root, "index.json"), JSON.stringify({ version: 1, agents }));
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const reports: unknown[] = [];
  set_agent_continuation((notice) => reports.push(notice));
  await init_agents({ dir: root, stream: async (_request, callbacks) => { callbacks.on_text("continued report"); return completed({ content: "continued report" }); }, resolve_tools: () => [], side_model: async () => "", review_call: async () => { throw new Error("unexpected review"); }, models: async () => { entered(); await gate; return [model]; } });
  const agent = get_agent("agent_0")!;
  const starting = continue_agent(agent, { chat_id: fields.chat_id, parent_message_id: "parent", parent_call_id: "call", project_root: root, user_request: "continue", mode: "ask", settings, prompt: "continue" });
  await ready;
  const other = create_agent(fields);
  begin_run(other, "other", "parent");
  release();
  await starting;
  for (let index = 0; index < 200 && reports.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(get_agent(agent.agent_id), agent);
  assert.equal(agent.runs.at(-1)?.status, "completed");
  assert.equal(reports.length, 1);
});

test("failed journal writes keep the batch available for a later flush", async (t) => {
  const file = path.join(await root_for(), "retry", "journal.jsonl");
  const append = t.mock.method(fs, "appendFileSync", () => { throw new Error("injected write failure"); });
  const errors = t.mock.method(console, "error", () => {});
  append_journal(file, { seq: 1 });
  await flush_journal(file);
  assert.equal(errors.mock.calls.length, 1);
  append.mock.restore();
  flush_journals_sync();
  assert.deepEqual(await read_journal(file), [{ seq: 1 }]);
  await close_journal(file);
});

test("mixed queued flushes and shutdown commit all journal entries exactly once", async () => {
  const file = path.join(await root_for(), "many", "journal.jsonl");
  const writes = [];
  for (let seq = 0; seq < 100; seq += 1) {
    append_journal(file, { seq });
    if (seq % 3 === 0) writes.push(flush_journal(file));
  }
  flush_journals_sync();
  await Promise.all(writes);
  assert.deepEqual(await read_journal(file), Array.from({ length: 100 }, (_, seq) => ({ seq })));
  await close_journal(file);
});

test("an explicitly removed agent cannot launch after asynchronous preparation", async () => {
  const root = await root_for();
  const fields = { chat_id: "removed", name: "Agent", description: "", topic: "", scope: [], model: model.id, effort: "", profile: "explore" as const, without_tools: [], project_root: root };
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  await init_agents({ dir: root, stream: async () => { throw new Error("removed agent ran"); }, resolve_tools: () => [], side_model: async () => "", review_call: async () => { throw new Error("unexpected review"); }, models: async () => { entered(); await gate; return [model]; } });
  const agent = create_agent(fields);
  const initial = begin_run(agent, "initial", "parent");
  end_run(agent.agent_id, initial.run_id, "completed", "initial report");
  const starting = continue_agent(agent, { chat_id: fields.chat_id, parent_message_id: "parent", parent_call_id: "call", project_root: root, user_request: "continue", mode: "ask", settings, prompt: "continue" });
  await ready;
  await remove_agents([agent.agent_id]);
  release();
  await assert.rejects(starting, /no longer available/);
  assert.equal(agent.runs.length, 1);
});

test("a failed preparation releases the retained agent for ordinary pruning", async () => {
  const root = await root_for();
  const fields = { chat_id: "failure", name: "Agent", description: "", topic: "", scope: [], model: model.id, effort: "", profile: "explore" as const, without_tools: [], project_root: root };
  const time = "2020-01-01T00:00:00.000Z";
  const agents = Array.from({ length: 300 }, (_, index) => ({ ...fields, agent_id: `agent_${index}`, created_at: time, updated_at: index ? "2020-01-02T00:00:00.000Z" : time, runs: [{ run_id: `run_${index}`, prompt: "old", status: "completed", started_at: time, ended_at: time, report: "complete", open_questions: 0, parent_message_id: "parent" }], held: [] }));
  await fsp.writeFile(path.join(root, "index.json"), JSON.stringify({ version: 1, agents }));
  await init_agents({ dir: root, stream: async () => { throw new Error("unexpected run"); }, resolve_tools: () => [], side_model: async () => "", review_call: async () => { throw new Error("unexpected review"); }, models: async () => [] });
  const agent = get_agent("agent_0")!;
  const request = { chat_id: fields.chat_id, parent_message_id: "parent", parent_call_id: "call", project_root: root, user_request: "continue", mode: "ask" as const, settings, prompt: "continue" };
  await assert.rejects(continue_agent(agent, request));
  await assert.rejects(continue_agent(agent, request));
  const other = create_agent(fields);
  assert.ok(get_agent(other.agent_id));
  assert.equal(get_agent(agent.agent_id), null);
});
