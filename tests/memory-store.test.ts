import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { memory_prompt_section } from "../electron/memory/prompt.ts";
import { confirm_memory, find_confirmed, init_memory, memory_records, resolve_pending, retrieve_memories, review_items } from "../electron/memory/store.ts";
import { new_memory_id, type MemoryEntry } from "../electron/memory/records.ts";
import { memory_handle, redact_secrets } from "../electron/memory/text.ts";
import { init_settings, update_settings } from "../electron/settings/store.ts";

let root = "";
let counter = 0;

const fresh = async () => {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  return { file: path.join(dir, "memories.json"), legacy_file: path.join(dir, "memories-v2.json"), dir };
};

const save = (patch: Partial<MemoryEntry>) => {
  const now = new Date().toISOString();
  return confirm_memory({
    id: new_memory_id(),
    key: "communication.language",
    kind: "global_preference",
    scope: "global",
    project_path: "",
    text: "The user wants answers in German.",
    evidence: "answer in German",
    confidence: 1,
    status: "confirmed",
    source_chat_id: "chat-1",
    source_message_id: "m1",
    created_at: now,
    updated_at: now,
    ...patch,
  });
};

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
  assert.equal(redact_secrets("my api key: 123"), "my api key=[redacted]");
});

test("a corrupt memory file is kept aside, logged and replaced by an empty store", async () => {
  const files = await fresh();
  await fs.writeFile(files.file, "{not json");
  await init_memory(files);
  const names = await fs.readdir(files.dir);
  const copy = names.find((name) => name.startsWith("memories.json.corrupt-"));
  assert.ok(copy);
  assert.equal(await fs.readFile(path.join(files.dir, copy), "utf8"), "{not json");
  assert.deepEqual(JSON.parse(await fs.readFile(files.file, "utf8")), { version: 1, records: [] });
});

test("a memory file with an unknown version is kept aside instead of being overwritten silently", async () => {
  const files = await fresh();
  await fs.writeFile(files.file, JSON.stringify({ version: 7, records: [{ text: "x" }] }));
  await init_memory(files);
  const names = await fs.readdir(files.dir);
  assert.ok(names.some((name) => name.startsWith("memories.json.corrupt-")));
  assert.deepEqual(memory_records(), []);
});

test("a memory file with scan records from an earlier version loads and is saved without them", async () => {
  const files = await fresh();
  const record = { id: "mem-4444-dddddd", key: "coding.comments", kind: "global_preference", scope: "global", text: "No code comments.", evidence: "", confidence: 1, status: "confirmed" };
  await fs.writeFile(files.file, JSON.stringify({ version: 1, records: [record], scans: { "msg-1": { scanned_at: "2026-01-01T00:00:00.000Z", outcome: "scanned" } } }));
  await init_memory(files);
  assert.deepEqual(memory_records().map((entry) => entry.text), ["No code comments."]);
  await save({ key: "communication.other", text: "Short answers." });
  const written = JSON.parse(await fs.readFile(files.file, "utf8"));
  assert.deepEqual(Object.keys(written).sort(), ["records", "version"]);
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
  assert.equal(find_confirmed("bbbbbb")?.project_path, "d:/work/alpha");
  await fs.writeFile(files.legacy_file, JSON.stringify({ ...legacy, records: [] }));
  await init_memory(files);
  assert.equal(memory_records().length, 3);
});

test("pending memories from an earlier version wait for review and can be kept or discarded", async () => {
  const files = await fresh();
  const entry = (id: string, text: string, status: string, confidence: number) => ({ id, key: `workflow.${id}`, kind: "global_preference", scope: "global", text, evidence: text, confidence, status });
  const records = [
    entry("rejected_one", "The user wants short answers.", "rejected", 0.95),
    entry("pending_again", "The user wants short answers please.", "pending", 0.95),
    entry("pending_low", "The user uses tabs.", "pending", 0.5),
  ];
  await fs.writeFile(files.file, JSON.stringify({ version: 1, records }));
  await init_memory(files);
  assert.deepEqual(review_items().map((item) => item.id).sort(), ["pending_again", "pending_low"]);
  await resolve_pending("pending_low", "discard");
  await resolve_pending("pending_again", "keep");
  assert.equal(review_items().length, 0);
  assert.deepEqual(memory_records().map((record) => record.text), ["The user wants short answers please."]);
  await assert.rejects(resolve_pending("pending_low", "keep"), /not pending review/);
});

test("a saved memory merges into the confirmed memory with the same key", async () => {
  await init_memory(await fresh());
  await save({});
  const first = memory_records()[0];
  assert.ok(first);
  await save({ text: "Answers must be in German." });
  const records = memory_records();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, first.id);
  assert.equal(records[0]?.text, "Answers must be in German.");
  await save({ key: "communication.other", text: "Something else entirely." });
  assert.equal(memory_records().length, 2);
  assert.equal(review_items().length, 0);
});

test("retrieval returns global memories plus only the open project's rules", async () => {
  await init_memory(await fresh());
  await save({ kind: "project_rule", scope: "project", project_path: "D:/Work/Alpha", key: "project.package", text: "Run npm run package after changes." });
  await save({});
  const alpha = retrieve_memories("D:/Work/Alpha/", "package", 24);
  assert.deepEqual(alpha.map((entry) => entry.kind), ["project_rule", "global_preference"]);
  const beta = retrieve_memories("D:\\Work\\Beta", "package", 24);
  assert.deepEqual(beta.map((entry) => entry.kind), ["global_preference"]);
  assert.deepEqual(retrieve_memories("", "", 24).map((entry) => entry.kind), ["global_preference"]);
});

test("memory_prompt_section is null while memory is off and lists handles when on", async () => {
  await init_memory(await fresh());
  await save({});
  const main_tools = new Set(["remember", "forget", "list_memories"]);
  assert.equal(await memory_prompt_section("D:/Work/Alpha", "hello", main_tools), null);
  await update_settings({ memory: { enabled: true } });
  const section = await memory_prompt_section("D:/Work/Alpha", "hello", main_tools);
  const record = memory_records()[0];
  assert.ok(section && record);
  assert.match(section.body, /REMEMBERED CONTEXT/);
  assert.ok(section.body.includes(`- (${memory_handle(record.id)}) [global/global_preference] The user wants answers in German.`));
  assert.doesNotMatch(section.body, /remember\(text\)|forget\(id\)/);
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
  for (let index = 0; index < 27; index += 1) {
    await save({ key: `workflow.build_fact_${index}`, text: `Build fact number ${index}.`, evidence: `build fact number ${index}`, source_message_id: `n${index}` });
  }
  const section = await memory_prompt_section("D:/Work/Alpha", "build", new Set(["remember", "forget", "list_memories"]));
  assert.ok(section);
  assert.match(section.body, /\n\n\(3 more saved memories are not shown here, these are the 24 most relevant to this request\. list_memories lists every memory\.\)$/);
  const sub_agent = await memory_prompt_section("D:/Work/Alpha", "build", new Set(["read_file"]));
  assert.ok(sub_agent);
  assert.match(sub_agent.body, /\(3 more saved memories are not shown here, these are the 24 most relevant to this request\.\)$/);
});
