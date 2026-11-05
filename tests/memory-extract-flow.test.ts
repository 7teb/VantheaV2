import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Chat, Step, TurnStatus, UserMessage } from "../shared/chat.ts";
import { extract_memories_after_turn } from "../electron/memory/extract.ts";
import { forget_scan, init_memory, is_scanned, memory_records, reset_memories, resolve_pending, review_items, store_scan_result } from "../electron/memory/store.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";
import type { SideModelCall } from "../electron/tools/types.ts";

let root = "";
let counter = 0;

const fresh = async (records: unknown[] = []) => {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "memories.json");
  if (records.length) {
    await fs.writeFile(file, JSON.stringify({ version: 1, records, scans: {} }));
  }
  return { file, legacy_file: path.join(dir, "memories-v2.json") };
};

const stored = (id: string, text: string, status: string, confidence: number) => ({
  id,
  key: `communication.${id}`,
  kind: "global_preference",
  scope: "global",
  project_path: "",
  text,
  evidence: text,
  confidence,
  status,
  source_chat_id: "chat-0",
  source_message_id: `src-${id}`,
  created_at: "2026-10-10T08:31:00.000Z",
  updated_at: "2026-10-10T08:31:00.000Z",
});

const candidate = (patch: Record<string, unknown> = {}) => ({
  kind: "global_preference",
  key: "communication.language",
  text: "The user wants answers in German.",
  evidence: "answer in German",
  confidence: 0.95,
  explicit: true,
  ...patch,
});

const user = (id: string, text: string): UserMessage => ({ id, role: "user", text, attachments: [], origin: "user", created_at: "2026-10-14T00:00:00.000Z" });

const assistant = (id: string, status: TurnStatus, steps: Step[]): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-14T00:00:00.000Z",
  ended_at: status === "streaming" ? null : "2026-10-14T00:00:01.000Z",
  status,
  steps,
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 1,
});

const chat = (messages: Chat["messages"]): Chat => ({
  id: "chat-x",
  title: "t",
  project_path: "D:/Work/Alpha",
  workspace: "",
  pinned: false,
  created_at: "2026-10-14T00:00:00.000Z",
  updated_at: "2026-10-14T00:00:00.000Z",
  message_count: messages.length,
  streaming: false,
  summary: null,
  messages,
  questions: {},
});

const recording = (reply: (prompt: string) => string) => {
  const prompts: string[] = [];
  const side_model: SideModelCall = async (_role, messages) => {
    const prompt = messages[1]?.content ?? "";
    prompts.push(prompt);
    return reply(prompt);
  };
  return { prompts, side_model };
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-memory-flow-"));
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
  await update_settings({ memory: { enabled: true, exclude_tool_chats: false } });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("the finished turn is found by its message id even when a queued message was appended first", async () => {
  await init_memory(await fresh());
  const { prompts, side_model } = recording(() => JSON.stringify([candidate()]));
  const messages = [
    user("u1", "Please answer in German."),
    assistant("a1", "done", [{ id: "t1", round: 0, kind: "text", text: "Okay." }]),
    user("u2", "Next question"),
    assistant("a2", "streaming", []),
  ];
  await extract_memories_after_turn(chat(messages), "a1", side_model);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /SOURCE USER MESSAGE:\nPlease answer in German\.$/);
  assert.equal(is_scanned("u1"), true);
  await extract_memories_after_turn(chat(messages), "a2", side_model);
  assert.equal(prompts.length, 1);
  assert.equal(is_scanned("u2"), false);
});

test("a stopped turn without an answer is scanned and steers from the user count as source text", async () => {
  await init_memory(await fresh());
  const { prompts, side_model } = recording(() => JSON.stringify([candidate({ evidence: "always answer in German" })]));
  const steps: Step[] = [
    { id: "s1", round: 0, kind: "steer", text: "and always answer in German", steer_id: "q1" },
    { id: "s2", round: 0, kind: "steer", text: "note from an agent" },
  ];
  await extract_memories_after_turn(chat([user("u1", "Fix the build."), assistant("a1", "stopped", steps)]), "a1", side_model);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /SOURCE USER MESSAGE:\nFix the build\.\n\nand always answer in German$/);
  assert.doesNotMatch(prompts[0]?.split("SOURCE USER MESSAGE:")[1] ?? "", /note from an agent/);
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants answers in German."]);
});

test("a failed side call is recorded as a failed scan with its error instead of vanishing", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const files = await fresh();
  await init_memory(files);
  const side_model: SideModelCall = async () => {
    throw new Error("provider unavailable");
  };
  await extract_memories_after_turn(chat([user("u1", "Please answer in German."), assistant("a1", "done", [])]), "a1", side_model);
  const saved = JSON.parse(await fs.readFile(files.file, "utf8"));
  assert.equal(saved.scans.u1.outcome, "failed");
  assert.equal(saved.scans.u1.error, "provider unavailable");
  assert.equal(is_scanned("u1"), true);
});

test("scan counts with drop reasons are stored and survive a reload", async () => {
  const files = await fresh();
  await init_memory(files);
  await store_scan_result(
    { chat_id: "c", message_id: "m1", content: "answer in German", project_path: "" },
    [candidate(), candidate({ key: "coding.low", text: "Something else.", confidence: 0.4 }), candidate({ kind: "opinion" })],
    "scanned",
  );
  await init_memory(files);
  await store_scan_result({ chat_id: "c", message_id: "m2", content: "x", project_path: "" }, [], "skipped_tools");
  const saved = JSON.parse(await fs.readFile(files.file, "utf8"));
  assert.deepEqual(saved.scans.m1.counts, { returned: 3, saved: 1, pending: 0, dropped: { kind: 1, low_confidence: 1 } });
  assert.equal(saved.scans.m2.outcome, "skipped_tools");
  assert.equal(memory_records().length, 1);
});

test("waiting candidates with high confidence are saved at startup, the rest stays in review", async (context) => {
  context.mock.method(console, "info", () => undefined);
  const files = await fresh([
    stored("pending_high", "The user wants short answers.", "pending", 0.9),
    stored("pending_low", "The user likes tables.", "pending", 0.6),
    stored("rejected", "The user wants emoji in answers.", "rejected", 0.95),
    stored("pending_again", "The user wants emoji in answers.", "pending", 0.95),
  ]);
  await init_memory(files);
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants short answers."]);
  assert.deepEqual(review_items().map((item) => item.id).sort(), ["pending_again", "pending_low"]);
  const saved = JSON.parse(await fs.readFile(files.file, "utf8"));
  assert.equal(saved.records.find((entry: { id: string }) => entry.id === "pending_high").status, "confirmed");
  await resolve_pending("pending_low", "discard");
  await resolve_pending("pending_again", "keep");
  assert.equal(review_items().length, 0);
  assert.equal(memory_records().length, 2);
  await assert.rejects(resolve_pending("pending_low", "keep"), /not pending review/);
});

test("a fact the user discarded before waits for review instead of being saved again", async () => {
  await init_memory(await fresh([stored("old", "The user wants answers in German.", "rejected", 0.95)]));
  const counts = await store_scan_result({ chat_id: "c", message_id: "m1", content: "answer in German", project_path: "" }, [candidate()], "scanned");
  assert.deepEqual(counts, { returned: 1, saved: 0, pending: 1, dropped: {} });
  assert.equal(memory_records().length, 0);
  const [item] = review_items();
  assert.equal(item?.text, "The user wants answers in German.");
  await resolve_pending(item?.id ?? "", "keep");
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants answers in German."]);
});

test("an edited user message that keeps its id is scanned again once its scan is forgotten", async (context) => {
  context.mock.method(console, "info", () => undefined);
  const files = await fresh();
  await init_memory(files);
  const { prompts, side_model } = recording((prompt) => (prompt.includes("always answer in German") ? JSON.stringify([candidate({ evidence: "always answer in German" })]) : "[]"));
  await extract_memories_after_turn(chat([user("u1", "fix the test"), assistant("a1", "done", [])]), "a1", side_model);
  assert.equal(is_scanned("u1"), true);
  assert.equal(memory_records().length, 0);
  await forget_scan("u1");
  assert.equal(is_scanned("u1"), false);
  assert.equal(JSON.parse(await fs.readFile(files.file, "utf8")).scans.u1, undefined);
  await extract_memories_after_turn(chat([user("u1", "fix the test, and always answer in German from now on"), assistant("a2", "done", [])]), "a2", side_model);
  assert.equal(prompts.length, 2);
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants answers in German."]);
  assert.equal(JSON.parse(await fs.readFile(files.file, "utf8")).scans.u1.counts.saved, 1);
  await forget_scan("never-scanned");
});

const held_side_model = () => {
  const prompts: string[] = [];
  let release: (reply: string) => void = () => undefined;
  const side_model: SideModelCall = async (_role, messages) => {
    prompts.push(messages[1]?.content ?? "");
    if (prompts.length > 1) {
      return "[]";
    }
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  return { prompts, side_model, release: (reply: string) => release(reply) };
};

test("an extraction in flight when the first message is edited stores nothing and leaves the edited message to be scanned", async (context) => {
  context.mock.method(console, "info", () => undefined);
  await init_memory(await fresh());
  const held = held_side_model();
  const pending = extract_memories_after_turn(chat([user("e1", "always answer in German"), assistant("a1", "done", [])]), "a1", held.side_model);
  await forget_scan("e1");
  held.release(JSON.stringify([candidate({ evidence: "always answer in German" })]));
  await pending;
  assert.deepEqual(memory_records(), []);
  assert.equal(is_scanned("e1"), false);
  await extract_memories_after_turn(chat([user("e1", "fix the test"), assistant("a2", "done", [])]), "a2", held.side_model);
  assert.equal(held.prompts.length, 2);
  assert.match(held.prompts[1] ?? "", /SOURCE USER MESSAGE:\nfix the test$/);
  assert.equal(is_scanned("e1"), true);
});

test("an extraction in flight when the memories are reset writes nothing back", async (context) => {
  context.mock.method(console, "info", () => undefined);
  await init_memory(await fresh());
  const held = held_side_model();
  const pending = extract_memories_after_turn(chat([user("r1", "always answer in German"), assistant("a1", "done", [])]), "a1", held.side_model);
  await reset_memories();
  held.release(JSON.stringify([candidate({ evidence: "always answer in German" })]));
  await pending;
  assert.deepEqual(memory_records(), []);
  assert.equal(is_scanned("r1"), false);
});
