import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, Chat, UserMessage } from "../shared/chat.ts";
import { extract_memories_after_turn } from "../electron/memory/extract.ts";
import { memory_prompt_section } from "../electron/memory/prompt.ts";
import {
  confirm_memory,
  find_confirmed,
  init_memory,
  is_scanned,
  memory_records,
  resolve_pending,
  retrieve_memories,
  review_items,
  store_scan_result,
} from "../electron/memory/store.ts";
import { new_memory_id } from "../electron/memory/records.ts";
import { contains_secret, memory_handle, redact_secrets } from "../electron/memory/text.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";
import type { SideModelCall } from "../electron/tools/types.ts";

let root = "";
let counter = 0;

const fresh = async () => {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  return { file: path.join(dir, "memories.json"), legacy_file: path.join(dir, "memories-v2.json"), dir };
};

const source = (message_id: string, content: string, project_path = "D:\\Work\\Alpha") => ({ chat_id: "chat-1", message_id, content, project_path });

const candidate = (patch: Record<string, unknown>) => ({
  kind: "global_preference",
  key: "communication.language",
  text: "The user wants answers in German.",
  evidence: "answer in German",
  confidence: 0.95,
  explicit: true,
  ...patch,
});

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-memory-"));
  const codec = { available: () => true, encrypt: (plain: string) => plain, decrypt: (cipher: string) => cipher };
  await init_settings({
    files: { settings: path.join(root, "settings.json"), secrets: path.join(root, "secrets.json"), legacy_settings: path.join(root, "legacy.json") },
    codec,
    on_change: () => undefined,
  });
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("redaction keeps the key name instead of a literal $1 and catches provider keys", () => {
  assert.equal(redact_secrets("my api_key: abc123, fine"), "my api_key=[redacted], fine");
  assert.equal(redact_secrets("Password=hunter2 and token: x"), "Password=[redacted] and token=[redacted]");
  assert.equal(redact_secrets("use sk-or-v1-abcdef0123456789 here"), "use [redacted] here");
  assert.equal(redact_secrets("tvly-dev-0123456789abcdef"), "[redacted]");
  assert.equal(contains_secret("access token = 12345"), true);
  assert.equal(contains_secret("prefers tabs"), false);
  assert.equal(contains_secret("my api key: 123"), true);
  assert.equal(contains_secret("my api key: 123"), true);
});

test("a corrupt memory file is kept aside, logged and replaced by an empty store", async () => {
  const files = await fresh();
  await fs.writeFile(files.file, "{not json");
  await init_memory(files);
  const names = await fs.readdir(files.dir);
  const copy = names.find((name) => name.startsWith("memories.json.corrupt-"));
  assert.ok(copy);
  assert.equal(await fs.readFile(path.join(files.dir, copy), "utf8"), "{not json");
  assert.deepEqual(JSON.parse(await fs.readFile(files.file, "utf8")), { version: 1, records: [], scans: {} });
});

test("a memory file with an unknown version is kept aside instead of being overwritten silently", async () => {
  const files = await fresh();
  await fs.writeFile(files.file, JSON.stringify({ version: 7, records: [{ text: "x" }] }));
  await init_memory(files);
  const names = await fs.readdir(files.dir);
  assert.ok(names.some((name) => name.startsWith("memories.json.corrupt-")));
  assert.deepEqual(memory_records(), []);
});

test("the legacy memories-v2.json is imported once when the new file is missing", async () => {
  const files = await fresh();
  const legacy = {
    version: 2,
    records: [
      { id: "mem-1111-aaaaaa", key: "coding.comments", kind: "global_preference", scope: "global", projectPath: "", text: "No code comments.", evidence: "no comments", confidence: 1, status: "confirmed", sourceChatId: "c", sourceMessageId: "m", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "mem-2222-bbbbbb", key: "project.build", kind: "project_rule", scope: "project", projectPath: "d:\\work\\alpha", text: "Build with npm run package.", evidence: "", confidence: 1, status: "confirmed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
      { id: "mem-3333-cccccc", key: "workflow.x", kind: "global_preference", scope: "global", text: "Pending one.", evidence: "pending one", confidence: 0.9, status: "pending" },
    ],
    scans: { "msg-1": { version: 2, scannedAt: "2026-01-01T00:00:00.000Z", outcome: "scanned" } },
  };
  await fs.writeFile(files.legacy_file, JSON.stringify(legacy));
  await init_memory(files);
  assert.equal(memory_records().length, 3);
  assert.equal(review_items().length, 0);
  assert.equal(is_scanned("msg-1"), true);
  assert.equal(find_confirmed("bbbbbb")?.project_path, "d:/work/alpha");
  await fs.writeFile(files.legacy_file, JSON.stringify({ ...legacy, records: [] }));
  await init_memory(files);
  assert.equal(memory_records().length, 3);
});

test("scan results keep only explicit, evidenced, confident and secret-free candidates", async () => {
  await init_memory(await fresh());
  const text = "Please always answer in German from now on.";
  const counts = await store_scan_result(
    source("m1", text),
    [
      candidate({}),
      candidate({ key: "communication.tone", text: "Likes jokes.", evidence: "jokes" }),
      candidate({ key: "x.y", explicit: false }),
      candidate({ key: "coding.secret", text: "password: abc", evidence: "answer in German" }),
    ],
    "scanned",
  );
  assert.deepEqual(counts, { returned: 3, saved: 1, pending: 0, dropped: { not_explicit: 1, evidence_not_in_message: 1 } });
  assert.equal(is_scanned("m1"), true);
  assert.equal((await store_scan_result(source("m1", text), [candidate({ key: "coding.other", text: "Other." })], "scanned")).saved, 0);
  const low = await store_scan_result(source("m2", text), [candidate({ key: "coding.low", confidence: 0.5 })], "scanned");
  assert.deepEqual(low, { returned: 1, saved: 0, pending: 0, dropped: { low_confidence: 1 } });
  const secret = await store_scan_result(source("m3", text), [candidate({ key: "coding.secret", text: "password: abc", evidence: "answer in German" })], "scanned");
  assert.deepEqual(secret.dropped, { secret: 1 });
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants answers in German."]);
});

test("a similar candidate updates the saved memory instead of adding a duplicate", async () => {
  await init_memory(await fresh());
  await store_scan_result(source("m1", "answer in German please"), [candidate({ key: "communication.language" })], "scanned");
  await store_scan_result(
    source("m2", "again: answer in German"),
    [candidate({ key: "communication.reply_language", text: "The user wants all answers in German." })],
    "scanned",
  );
  assert.equal(review_items().length, 0);
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants all answers in German."]);
});

test("a saved candidate merges into the confirmed memory with the same key", async () => {
  await init_memory(await fresh());
  await store_scan_result(source("m1", "answer in German"), [candidate({})], "scanned");
  const first = memory_records()[0];
  assert.ok(first);
  await store_scan_result(source("m2", "answer in German"), [candidate({ text: "Answers must be in German." })], "scanned");
  const records = memory_records();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, first.id);
  assert.equal(records[0]?.text, "Answers must be in German.");
  await store_scan_result(source("m3", "answer in German"), [candidate({ key: "communication.other", text: "Something else entirely." })], "scanned");
  assert.equal(memory_records().length, 2);
  assert.equal(review_items().length, 0);
});

test("retrieval returns global memories plus only the open project's rules", async () => {
  await init_memory(await fresh());
  await store_scan_result(
    source("m1", "in this repo run npm run package after changes"),
    [candidate({ kind: "project_rule", key: "project.package", text: "Run npm run package after changes.", evidence: "run npm run package" })],
    "scanned",
  );
  await store_scan_result(source("m2", "answer in German"), [candidate({})], "scanned");
  for (const item of review_items()) {
    await resolve_pending(item.id, "keep");
  }
  const alpha = retrieve_memories("D:/Work/Alpha/", "package", 24);
  assert.deepEqual(alpha.map((entry) => entry.kind), ["project_rule", "global_preference"]);
  const beta = retrieve_memories("D:\\Work\\Beta", "package", 24);
  assert.deepEqual(beta.map((entry) => entry.kind), ["global_preference"]);
  assert.deepEqual(retrieve_memories("", "", 24).map((entry) => entry.kind), ["global_preference"]);
});

test("memory_prompt_section is null while memory is off and lists handles when on", async () => {
  await init_memory(await fresh());
  await store_scan_result(source("m1", "answer in German"), [candidate({})], "scanned");
  const main_tools = new Set(["remember", "forget", "list_memories"]);
  assert.equal(await memory_prompt_section("D:/Work/Alpha", "hello", main_tools), null);
  await update_settings({ memory: { enabled: true } });
  const section = await memory_prompt_section("D:/Work/Alpha", "hello", main_tools);
  const record = memory_records()[0];
  assert.ok(section && record);
  assert.match(section.body, /REMEMBERED CONTEXT/);
  assert.ok(section.body.includes(`- (${memory_handle(record.id)}) [global/global_preference] The user wants answers in German.`));
  assert.match(section.body, /remember\(text\) proposes saving/);
  const sub_agent = await memory_prompt_section("D:/Work/Alpha", "hello", new Set(["read_file"]));
  assert.ok(sub_agent);
  assert.match(sub_agent.body, /^REMEMBERED CONTEXT \(/);
  assert.doesNotMatch(sub_agent.body, /remember\(text\)|forget\(id\)/);
  assert.ok(sub_agent.body.includes(`- (${memory_handle(record.id)})`));
  assert.doesNotMatch(section.body, /more saved memories/);
});

test("memory_prompt_section says how many saved memories it leaves out", async () => {
  await init_memory(await fresh());
  await update_settings({ memory: { enabled: true } });
  const now = new Date().toISOString();
  for (let index = 0; index < 27; index += 1) {
    await confirm_memory({
      id: new_memory_id(),
      key: `workflow.build_fact_${index}`,
      kind: "global_preference",
      scope: "global",
      project_path: "",
      text: `Build fact number ${index}.`,
      evidence: `build fact number ${index}`,
      confidence: 1,
      status: "confirmed",
      source_chat_id: "chat-1",
      source_message_id: `n${index}`,
      created_at: now,
      updated_at: now,
    });
  }
  const section = await memory_prompt_section("D:/Work/Alpha", "build", new Set(["remember", "forget", "list_memories"]));
  assert.ok(section);
  assert.match(section.body, /\n\n\(3 more saved memories are not shown here, these are the 24 most relevant to this request\. list_memories lists every memory\.\)$/);
  const sub_agent = await memory_prompt_section("D:/Work/Alpha", "build", new Set(["read_file"]));
  assert.ok(sub_agent);
  assert.match(sub_agent.body, /\(3 more saved memories are not shown here, these are the 24 most relevant to this request\.\)$/);
});

const user = (id: string, text: string, origin: UserMessage["origin"] = "user"): UserMessage => ({ id, role: "user", text, attachments: [], origin, created_at: "2026-10-06T00:00:00.000Z" });

const assistant = (id: string, text: string, with_tool = false): AssistantMessage => ({
  id,
  role: "assistant",
  model: "m",
  effort: "high",
  mode: "auto",
  plan: false,
  created_at: "2026-10-06T00:00:00.000Z",
  ended_at: "2026-10-06T00:00:01.000Z",
  status: "done",
  steps: [
    { id: "t", round: 0, kind: "text", text },
    ...(with_tool
      ? [{ id: "tool", round: 0, kind: "tool" as const, index: 0, call_id: "c", name: "read_file", args: {}, status: "done" as const, progress: null, approval: null, view: null, error: null, result_text: "", started_at: 1, ended_at: 2 }]
      : []),
  ],
  reasoning_details: [],
  retry: null,
  error: null,
  context: null,
  last_seq: 3,
});

const chat = (messages: Chat["messages"]): Chat => ({
  id: "chat-x",
  title: "t",
  project_path: "D:/Work/Alpha",
  workspace: "",
  pinned: false,
  created_at: "2026-10-06T00:00:00.000Z",
  updated_at: "2026-10-06T00:00:00.000Z",
  message_count: messages.length,
  streaming: false,
  summary: null,
  messages,
  questions: {},
});

test("extraction after a turn asks the memory side model and saves confident candidates", async () => {
  await init_memory(await fresh());
  await update_settings({ memory: { enabled: true, exclude_tool_chats: true } });
  const roles: string[] = [];
  let prompt = "";
  const side_model: SideModelCall = async (role, messages) => {
    roles.push(role);
    prompt = messages[1]?.content ?? "";
    return `Here: ${JSON.stringify([candidate({})])}`;
  };
  await extract_memories_after_turn(chat([user("u1", "Please answer in German."), assistant("a1", "Okay.")]), "a1", side_model);
  assert.deepEqual(roles, ["memory"]);
  assert.match(prompt, /SOURCE USER MESSAGE:\nPlease answer in German\./);
  assert.equal(memory_records().length, 1);
  assert.equal(review_items().length, 0);
  await extract_memories_after_turn(chat([user("u1", "Please answer in German."), assistant("a1", "Okay.")]), "a1", side_model);
  assert.equal(roles.length, 1);
  await extract_memories_after_turn(chat([user("u2", "answer in German"), assistant("a2", "Done.", true)]), "a2", side_model);
  assert.equal(roles.length, 1);
  assert.equal(is_scanned("u2"), true);
  await extract_memories_after_turn(chat([user("u3", "answer in German", "background"), assistant("a3", "Done.")]), "a3", side_model);
  assert.equal(roles.length, 1);
  await update_settings({ memory: { enabled: false, exclude_tool_chats: false } });
  await extract_memories_after_turn(chat([user("u4", "answer in German"), assistant("a4", "Done.")]), "a4", side_model);
  assert.equal(roles.length, 1);
});
