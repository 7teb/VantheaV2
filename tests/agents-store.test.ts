import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { append_journal, close_journal, read_journal } from "../electron/agents/journal.ts";
import { create_live, forget_live, read_agent_run } from "../electron/agents/live.ts";
import { ensure_report_file, report_file } from "../electron/agents/report-file.ts";
import { begin_run, create_agent, end_run, find_agent, get_agent, init_agent_store, list_agents, remove_agents, run_file } from "../electron/agents/store.ts";
import { review_record } from "./fixtures/review/record.ts";
import { writes_settled } from "../electron/storage/json-file.ts";

let root = "";

let dir = "";

const fields = (chat_id: string, name: string) => ({ chat_id, name, description: "d", topic: "", scope: [], model: "m", effort: "", profile: "explore" as const, without_tools: [], project_root: "C:/p" });

const wait_for_file = async (file: string, check: (text: string) => boolean) => {
  await writes_settled(file);
  const text = await fs.readFile(file, "utf8");
  assert.ok(check(text), `stored data in ${file} does not match the expected state`);
  return text;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-store-"));
  dir = path.join(root, "agents");
  await init_agent_store(dir);
});

after(async () => {
  await writes_settled(path.join(dir, "index.json"));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("run events are appended in batches and replay into the same transcript after a reload", async () => {
  const agent = create_agent(fields("chat-a", "Explorer"));
  const run = begin_run(agent, "look around", "parent");
  const file = run_file(agent.agent_id, run.run_id);
  append_journal(file, { type: "text", round: 0, delta: "Found ", seq: 1, at: 1 });
  append_journal(file, { type: "text", round: 0, delta: "it.", seq: 2, at: 2 });
  append_journal(file, { type: "end", status: "done", error: null, seq: 3, at: 3 });
  await close_journal(file);
  assert.equal((await read_journal(file)).length, 3);
  end_run(agent.agent_id, run.run_id, "completed", "Found it.");
  await wait_for_file(path.join(dir, "index.json"), (text) => text.includes('"completed"'));

  await init_agent_store(dir);
  const loaded = get_agent(agent.agent_id);
  const loaded_run = loaded?.runs[0];
  assert.ok(loaded && loaded_run);
  assert.equal(loaded_run.status, "completed");
  const view = await read_agent_run(loaded, loaded_run);
  assert.equal(view.last_seq, 3);
  assert.deepEqual(
    view.steps.map((step) => (step.kind === "text" ? step.text : step.kind)),
    ["Found it."],
  );
  assert.equal(view.report, "Found it.");
});

test("a run left running in the index loads as interrupted with its open steps settled", async () => {
  const agent_id = "agent_left";
  const run_id = "run_left";
  await fs.mkdir(path.join(dir, agent_id), { recursive: true });
  await fs.writeFile(
    path.join(dir, "index.json"),
    JSON.stringify({
      version: 1,
      agents: [
        {
          agent_id,
          chat_id: "chat-b",
          name: "Worker",
          model: "m",
          profile: "worker",
          runs: [{ run_id, prompt: "fix it", status: "running", started_at: "2026-01-01T00:00:00.000Z", ended_at: null }],
        },
        { agent_id: "../escape", chat_id: "chat-b", runs: [] },
      ],
    }),
  );
  await fs.writeFile(
    path.join(dir, agent_id, `${run_id}.jsonl`),
    `${JSON.stringify({ type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "read_file", args: {}, seq: 1, at: 1 })}\n{"truncated":`,
  );
  await init_agent_store(dir);
  const summaries = list_agents("chat-b");
  assert.deepEqual(
    summaries.map((summary) => summary.agent_id),
    [agent_id],
  );
  const run = summaries[0]?.runs[0];
  assert.equal(run?.status, "interrupted");
  assert.notEqual(run?.ended_at, null);
  const agent = get_agent(agent_id);
  const record = agent?.runs[0];
  assert.ok(agent && record);
  const view = await read_agent_run(agent, record);
  const tool = view.steps.find((step) => step.kind === "tool");
  assert.equal(tool?.kind === "tool" ? tool.status : "", "cancelled");
  assert.equal(view.error?.kind, "app_closed");
  await wait_for_file(path.join(dir, "index.json"), (text) => text.includes('"interrupted"'));
});

test("ids resolve by unique prefix inside the owning chat and removal deletes the agent folder", async () => {
  const first = create_agent(fields("chat-c", "One"));
  const second = create_agent(fields("chat-c", "Two"));
  const run = begin_run(first, "go", "parent");
  const file = run_file(first.agent_id, run.run_id);
  append_journal(file, { type: "end", status: "done", error: null, seq: 1, at: 1 });
  await close_journal(file);
  assert.equal(find_agent(first.agent_id.slice(0, -4), "chat-c").agent?.agent_id, first.agent_id);
  assert.equal(find_agent(first.agent_id, "chat-other").agent, null);
  const ambiguous = find_agent("agent_", "chat-c");
  assert.match("error" in ambiguous ? ambiguous.error : "", /matches 2 agents/);
  await remove_agents([first.agent_id, second.agent_id]);
  assert.deepEqual(list_agents("chat-c"), []);
  await assert.rejects(fs.stat(path.join(dir, first.agent_id)));
});

test("draft deltas reach the live transcript while the journal keeps tool_draft events without their text", async () => {
  const agent = create_agent(fields("chat-d", "Writer"));
  const run = begin_run(agent, "write it", "parent");
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id);
  live.emit({ type: "tool_draft", round: 0, index: 0, name: "write_file", lines: 2, delta: "a\nb", path: "x.py" });
  const step = live.transcript.steps[0];
  assert.equal(step?.kind === "tool" ? step.progress?.draft_text : null, "a\nb");
  live.emit({ type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "write_file", args: { path: "x.py", content: "a\nb" } });
  live.emit({ type: "end", status: "done", error: null });
  forget_live(run.run_id);
  const file = run_file(agent.agent_id, run.run_id);
  await close_journal(file);
  const [drafted, called] = (await read_journal(file)) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(drafted ?? {}).sort(), ["at", "index", "lines", "name", "round", "seq", "type"]);
  assert.equal(drafted?.lines, 2);
  assert.deepEqual(called?.args, { path: "x.py", content: "a\nb" });
});

test("a legacy capped report is recovered from its journal into a complete report file", async () => {
  const agent = create_agent(fields("chat-legacy", "Reader"));
  const run = begin_run(agent, "read it all", "parent");
  const content = "ORIGINAL_REPORT\n" + "finding\n".repeat(6000) + "COMPLETE_END";
  const journal = run_file(agent.agent_id, run.run_id);
  append_journal(journal, { type: "text", round: 0, delta: content, seq: 1, at: 1 });
  append_journal(journal, { type: "end", status: "done", error: null, seq: 2, at: 2 });
  await close_journal(journal);
  end_run(agent.agent_id, run.run_id, "completed", content.slice(0, 30_000));
  const file = await ensure_report_file(agent, run);
  assert.equal(file, report_file(agent.agent_id, run.run_id));
  assert.equal(await fs.readFile(file, "utf8"), content);
  assert.equal(await ensure_report_file(agent, run), file);
});

test("a journal replay keeps tool_review events and drops malformed ones", async () => {
  const agent = create_agent(fields("chat-review", "Checker"));
  const run = begin_run(agent, "check it", "parent");
  const live = create_live(agent.agent_id, run.run_id, agent.chat_id);
  const record = review_record("r1", { actor: { id: agent.agent_id, name: "Checker", kind: "agent" }, verdict: "review" });
  live.emit({ type: "tool_call", round: 0, index: 0, call_id: "c0_0", name: "run_command", args: { command: "npm.cmd test" } });
  live.emit({ type: "tool_review", call_id: "c0_0", review: record });
  live.emit({ type: "end", status: "done", error: null });
  forget_live(run.run_id);
  const file = run_file(agent.agent_id, run.run_id);
  append_journal(file, { type: "tool_review", call_id: "c0_0", review: { ...record, id: "r2", actor: null }, seq: 4, at: 4 });
  await close_journal(file);
  const warn = mock.method(console, "warn", () => {});
  try {
    const view = await read_agent_run(agent, run);
    const step = view.steps.find((entry) => entry.kind === "tool");
    assert.deepEqual(step?.kind === "tool" ? step.reviews : null, [record]);
    assert.equal(view.last_seq, 3);
    const texts = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.deepEqual(texts, ["[reviews] dropped a review record in chat chat-review, step c0_0: record r2 has no valid actor"]);
  } finally {
    warn.mock.restore();
  }
});
