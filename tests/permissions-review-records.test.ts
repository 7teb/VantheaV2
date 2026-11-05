import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { parse_body } from "../electron/chats/files.ts";
import { append_message, create_chat, get_chat, init_chats } from "../electron/chats/store.ts";
import { coerce_review, coerce_reviews } from "../electron/permissions/review-coerce.ts";
import { agent_review, main_review, mirror_review } from "../electron/permissions/review-records.ts";
import type { ToolStep } from "../shared/chat.ts";
import type { ReviewRecord, ReviewScript } from "../shared/review.ts";
import { review_record } from "./fixtures/review/record.ts";
import { tool_model } from "./tool-model.ts";

const warnings = () => {
  const warn = mock.method(console, "warn", () => {});
  return {
    texts: () => warn.mock.calls.map((call) => String(call.arguments[0])),
    restore: () => warn.mock.restore(),
  };
};

const script = (extra: Partial<ReviewScript> = {}): ReviewScript => ({
  path: "tools/clean.ps1",
  sha256: "ab".repeat(32),
  role: "started",
  chars: 120,
  sent: true,
  summary: "Deletes build output.",
  change: "written",
  ...extra,
});

test("coerce_review keeps a complete record unchanged with every optional field", () => {
  const full = review_record("r1", {
    verdict: "deny",
    rule_source: "human_message",
    rule: "do not push",
    raised_by: ["protected", "script_floor"],
    granted: false,
    circumvents: "r0",
    earlier: { action: "git push origin main", status: "user_denied", agent: "tests#1a2b" },
    grant_prefixes: ["git push", "npm run"],
    failure: "timeout",
    scripts: [script(), script({ path: "tools/sync.ps1", sha256: null, role: "named", sent: false, summary: null, change: null })],
    superseded: "scripts_changed",
    usage: { prompt_tokens: 900, estimated_tokens: 950, cached_tokens: 512, cache_write_tokens: 0, completion_tokens: 80, reasoning_tokens: 40, cost: null, ms: 1200 },
  });
  const log = warnings();
  try {
    assert.deepEqual(coerce_review(JSON.parse(JSON.stringify(full)), "chat-a", "c1"), full);
    assert.deepEqual(log.texts(), []);
  } finally {
    log.restore();
  }
});

test("coerce_review fills defaults for missing parts", () => {
  const log = warnings();
  try {
    const record = coerce_review({ id: "r1", actor: { id: "main", name: "main", kind: "main" }, verdict: "review", subject: "git push" }, "chat-a", "c1");
    const expected: ReviewRecord = {
      id: "r1",
      at: 0,
      actor: { id: "main", name: "main", kind: "main" },
      tool: "",
      subject: "git push",
      cwd: "",
      verdict: "review",
      source: "model",
      reason: "",
      rule_source: "none",
      rule: "",
      last_human_id: null,
    };
    assert.deepEqual(record, expected);
    assert.deepEqual(log.texts(), []);
  } finally {
    log.restore();
  }
});

test("coerce_review drops a record without id, actor, verdict or subject and names the chat and step", () => {
  const valid = review_record("r1");
  const broken: [string, unknown, RegExp][] = [
    ["id", { ...valid, id: "" }, /no id/],
    ["actor", { ...valid, actor: { id: "main", name: "main", kind: "boss" } }, /record r1 has no valid actor/],
    ["verdict", { ...valid, verdict: "maybe" }, /record r1 has no valid verdict/],
    ["subject", { ...valid, subject: 42 }, /record r1 has no subject/],
    ["object", "not a record", /no id/],
  ];
  for (const [label, value, problem] of broken) {
    const log = warnings();
    try {
      assert.equal(coerce_review(value, "chat-a", "c7"), null, label);
      const [text] = log.texts();
      assert.match(text ?? "", /chat chat-a, step c7/, label);
      assert.match(text ?? "", problem, label);
    } finally {
      log.restore();
    }
  }
});

test("malformed optional fields and script entries are dropped with a warning", () => {
  const log = warnings();
  try {
    const record = coerce_review(
      {
        ...review_record("r2"),
        raised_by: ["protected", "because"],
        granted: "yes",
        circumvents: "",
        earlier: { action: "git push", status: "forgotten", agent: null },
        grant_prefixes: ["git push", 4],
        failure: "exploded",
        scripts: [script(), script({ role: "imagined" as ReviewScript["role"] }), "tools/x.ps1", script({ sha256: 7 as unknown as string })],
        superseded: "edited",
        usage: { prompt_tokens: "many" },
      },
      "chat-b",
      "c2",
    );
    assert.deepEqual(record, { ...review_record("r2"), raised_by: ["protected"], scripts: [script()], grant_prefixes: ["git push"] });
    assert.deepEqual(log.texts(), [
      "[reviews] review record r2 in chat chat-b, step c2: dropped malformed raised_by, scripts, granted, circumvents, earlier, grant_prefixes, failure, superseded, usage",
    ]);
  } finally {
    log.restore();
  }
});

test("a stored offline_window failure from an older version loads as a timeout without a warning", () => {
  const log = warnings();
  try {
    const legacy = { ...review_record("r-old", { source: "unavailable", reason: "" }), failure: "offline_window" };
    assert.deepEqual(coerce_review(legacy, "chat-o", "c1"), review_record("r-old", { source: "unavailable", reason: "", failure: "timeout" }));
    const step = {
      id: "s1", round: 0, kind: "tool", index: 0, call_id: "c1", name: "run_command", args: {}, status: "denied", progress: null,
      approval: null, view: null, error: null, result_text: "", started_at: 1, ended_at: 2, reviews: [legacy],
    };
    const assistant = {
      id: "a1", role: "assistant", model: "m", effort: "", mode: "auto", plan: false, created_at: "2026-10-01T00:00:00.000Z", ended_at: null,
      status: "done", steps: [step], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0,
    };
    const body = parse_body({ messages: [assistant] }, "chat-o");
    const loaded = body?.messages[0];
    const tool = loaded?.role === "assistant" ? loaded.steps[0] : null;
    assert.deepEqual(tool?.kind === "tool" ? tool.reviews?.map((record) => record.failure) : [], ["timeout"]);
    assert.deepEqual(log.texts(), []);
  } finally {
    log.restore();
  }
});

test("coerce_reviews keeps valid records in order and drops the rest", () => {
  const log = warnings();
  try {
    const first = review_record("r1");
    const second = review_record("r2", { verdict: "deny" });
    assert.deepEqual(coerce_reviews([first, { id: "r3" }, null, second], "chat-c", "c3"), [first, second]);
    assert.equal(log.texts().length, 2);
    assert.deepEqual(coerce_reviews("broken", "chat-c", "c4"), []);
    assert.match(log.texts().at(-1) ?? "", /chat chat-c, step c4: not a list/);
  } finally {
    log.restore();
  }
});

test("main history returns every chat record, agent history merges the mirror with live steps and counts earlier runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-review-records-"));
  await init_chats({
    dirs: { index_file: path.join(root, "index.json"), data_dir: path.join(root, "data"), search_dir: path.join(root, "search") },
    legacy_root: path.join(root, "legacy"),
    events: { changed: () => undefined, removed: () => undefined, appended: () => undefined, truncated: () => undefined, questions: () => undefined },
  });
  const chat = await create_chat(root);
  const worker = { id: "agent_1", name: "worker", kind: "agent" as const };
  const earlier = review_record("r-earlier", { actor: worker, at: 1 });
  const step: ToolStep = {
    id: "deploy", round: 0, kind: "tool", index: 0, call_id: "deploy-1", name: "deploy_agent", args: {}, status: "done", progress: null,
    approval: null, view: null, error: null, result_text: "", started_at: 1, ended_at: 2, reviews: [earlier],
  };
  await append_message(chat.id, {
    id: "a1", role: "assistant", model: "m", effort: "", mode: "auto", plan: false, created_at: new Date().toISOString(), ended_at: null,
    status: "done", steps: [step], reasoning_details: [], retry: null, error: null, context: null, last_seq: 0,
  });
  const live_record = review_record("r-live", { actor: worker, at: 3 });
  const live: ToolStep = { ...step, id: "w1", call_id: "w1_0", name: "run_command", reviews: [live_record, earlier] };
  const call = async () => ({ text: "", finish_reason: null, usage: null });
  const main = await main_review(chat.id, call, tool_model).history();
  assert.deepEqual(main.records.map((record) => record.id), ["r-earlier"]);
  const agent = agent_review({ chat_id: chat.id, agent_id: "agent_1", name: "worker", parent_message_id: "a1", parent_call_id: "deploy-1", live_steps: () => [live] }, call, tool_model);
  const history = await agent.history();
  assert.deepEqual(history.records.map((record) => record.id), ["r-earlier", "r-live"]);
  assert.equal(history.earlier_commands, 0);
  const other_run = await agent_review({ chat_id: chat.id, agent_id: "agent_1", name: "worker", parent_message_id: "a1", parent_call_id: "deploy-1", live_steps: () => [] }, call, tool_model).history();
  assert.equal(other_run.earlier_commands, 1);
  await agent.mirror?.(live_record);
  const stored = (await get_chat(chat.id))!.messages.find((message) => message.id === "a1");
  assert.deepEqual(stored?.role === "assistant" && stored.steps[0]?.kind === "tool" ? stored.steps[0].reviews?.map((record) => record.id) : [], ["r-earlier", "r-live"]);
  const log = warnings();
  await mirror_review(chat.id, "a1", "gone-step", live_record);
  assert.match(log.texts().join("\n"), /parent step gone-step of chat .* is gone, review r-live of worker is kept in the agent transcript only/);
  log.restore();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
