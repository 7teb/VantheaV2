import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ModelEntry } from "../shared/models.ts";
import {
  deliver_report,
  deliver_update,
  flush_reports,
  has_agent_notes,
  set_agent_continuation,
  take_agent_notes,
  wait_for_input,
  type AgentNotice,
  type AgentReport,
  type AgentUpdate,
} from "../electron/agents/reports.ts";
import { begin_run, create_agent, init_agent_store } from "../electron/agents/store.ts";
import { mark_user_stop, register_active, release_chat, reserve_chat, unregister_active, user_stopped } from "../electron/turn/active.ts";

const model: ModelEntry = {
  id: "m",
  label: "M",
  provider: "p",
  provider_order: [],
  efforts: ["high"],
  default_effort: "high",
  vision: false,
  context_length: 1_000_000,
  max_output: 4096,
  reasoning_passback: false,
};

const continued: AgentReport[] = [];

const continued_updates: AgentUpdate[] = [];

let root = "";

const record = (notice: AgentNotice) => {
  if (notice.kind === "report") {
    continued.push(notice.report);
    return;
  }
  if (notice.kind === "update") {
    continued_updates.push(notice.update);
  }
};

const report = (chat_id: string, text: string): AgentReport => ({
  chat_id,
  agent_id: "agent_x",
  run_id: `run_${text.length}_${chat_id}`,
  name: "Reviewer",
  profile: "explore",
  model: "m",
  status: "completed",
  started_at: "2026-01-01T00:00:00.000Z",
  ended_at: "2026-01-01T00:01:00.000Z",
  report_path: path.join(root, `run_${text.length}_${chat_id}.report.md`),
  stop_reason: "stop",
});

const update = (chat_id: string, run_id: string, text: string): AgentUpdate => ({ chat_id, agent_id: "agent_x", run_id, name: "Reviewer", text });

const activate = (chat_id: string) => register_active(chat_id, `msg-${chat_id}`, () => undefined, model, "high");

const running_agent = (chat_id: string) => {
  const agent = create_agent({ chat_id, name: "Reviewer", description: "", topic: "", scope: [], model: "m", effort: "", profile: "explore", without_tools: [], project_root: "C:/p" });
  begin_run(agent, "review", "parent");
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-agent-updates-"));
  await init_agent_store(path.join(root, "agents"));
  set_agent_continuation(record);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("an update reaches an active turn as an agent_update notice", () => {
  activate("chat-update");
  deliver_update(update("chat-update", "run_u", "the parser is mine, skip it"));
  assert.equal(has_agent_notes("chat-update"), true);
  const notes = take_agent_notes("chat-update");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind === "notice" && notes[0].notice, "agent_update");
  assert.match(notes[0]?.content ?? "", /still running/);
  assert.match(notes[0]?.text ?? "", /the parser is mine, skip it/);
  unregister_active("chat-update", "msg-chat-update");
});

test("an update while the turn is active stays queued and wakes the idle wait", async () => {
  activate("chat-update-wait");
  running_agent("chat-update-wait");
  const before = continued_updates.length;
  const controller = new AbortController();
  const waiting = wait_for_input("chat-update-wait", 60_000, controller.signal);
  deliver_update(update("chat-update-wait", "run_w", "found it"));
  assert.equal(await waiting, true);
  assert.equal(continued_updates.length, before);
  assert.equal(has_agent_notes("chat-update-wait"), true);
  take_agent_notes("chat-update-wait");
  unregister_active("chat-update-wait", "msg-chat-update-wait");
});

test("an update for a chat whose turn ended naturally starts a continuation instead of waiting", () => {
  activate("chat-quiet");
  unregister_active("chat-quiet", "msg-chat-quiet");
  const before = continued_updates.length;
  deliver_update(update("chat-quiet", "run_q", "halfway"));
  assert.equal(continued_updates.length, before + 1);
  assert.equal(continued_updates.at(-1)?.text, "halfway");
  assert.equal(has_agent_notes("chat-quiet"), false);
});

test("an update after a user stop stays queued for the next turn the user starts", () => {
  activate("chat-stopped");
  mark_user_stop("chat-stopped");
  unregister_active("chat-stopped", "msg-chat-stopped");
  const before = continued_updates.length;
  deliver_update(update("chat-stopped", "run_s", "after the stop"));
  assert.equal(continued_updates.length, before);
  assert.equal(has_agent_notes("chat-stopped"), true);
  activate("chat-stopped");
  assert.equal(user_stopped("chat-stopped"), false);
  assert.match(take_agent_notes("chat-stopped")[0]?.text ?? "", /after the stop/);
  unregister_active("chat-stopped", "msg-chat-stopped");
  deliver_update(update("chat-stopped", "run_s", "after a natural end"));
  assert.equal(continued_updates.length, before + 1);
});

test("updates still queued at a natural turn end are continued like reports", () => {
  activate("chat-flush");
  deliver_update(update("chat-flush", "run_f", "arrived after the last round"));
  const before = continued_updates.length;
  unregister_active("chat-flush", "msg-chat-flush");
  flush_reports("chat-flush");
  assert.equal(continued_updates.length, before + 1);
  assert.equal(continued_updates.at(-1)?.text, "arrived after the last round");
  assert.equal(has_agent_notes("chat-flush"), false);
});

test("after a user stop queued updates stay queued while queued reports still continue", () => {
  activate("chat-flush-stop");
  deliver_update(update("chat-flush-stop", "run_a", "update before the stop"));
  deliver_report(report("chat-flush-stop", "report before the stop"));
  mark_user_stop("chat-flush-stop");
  unregister_active("chat-flush-stop", "msg-chat-flush-stop");
  const updates_before = continued_updates.length;
  const reports_before = continued.length;
  flush_reports("chat-flush-stop");
  assert.equal(continued_updates.length, updates_before);
  assert.equal(continued.length, reports_before + 1);
  assert.deepEqual(take_agent_notes("chat-flush-stop").map((note) => note.kind === "notice" && note.notice), ["agent_update"]);
});

test("a final report replaces a queued update of the same run", () => {
  activate("chat-replace");
  mark_user_stop("chat-replace");
  unregister_active("chat-replace", "msg-chat-replace");
  deliver_update(update("chat-replace", "run_r", "from the finishing run"));
  deliver_update(update("chat-replace", "run_other", "from another run"));
  deliver_report({ ...report("chat-replace", "done"), run_id: "run_r" });
  assert.equal(continued.at(-1)?.run_id, "run_r");
  assert.deepEqual(
    take_agent_notes("chat-replace").map((note) => note.text.includes("from another run")),
    [true],
  );
});

test("updates left at a turn end start one continuation and the rest wait as notes for it", () => {
  activate("chat-batch");
  deliver_update(update("chat-batch", "run_b1", "first"));
  deliver_update(update("chat-batch", "run_b2", "second"));
  unregister_active("chat-batch", "msg-chat-batch");
  const before = continued_updates.length;
  set_agent_continuation((notice) => {
    record(notice);
    reserve_chat("chat-batch");
  });
  try {
    flush_reports("chat-batch");
  } finally {
    set_agent_continuation(record);
    release_chat("chat-batch");
  }
  assert.equal(continued_updates.length, before + 1);
  assert.equal(continued_updates.at(-1)?.text, "first");
  assert.equal(has_agent_notes("chat-batch"), true);
  assert.match(take_agent_notes("chat-batch")[0]?.text ?? "", /second/);
});

test("a flush while a turn is active continues nothing and leaves the notes for that turn", () => {
  activate("chat-busy");
  deliver_update(update("chat-busy", "run_busy", "while busy"));
  const before = continued_updates.length;
  flush_reports("chat-busy");
  assert.equal(continued_updates.length, before);
  assert.equal(has_agent_notes("chat-busy"), true);
  take_agent_notes("chat-busy");
  unregister_active("chat-busy", "msg-chat-busy");
});
