import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { channel_kind } from "../shared/ipc/index.ts";
import { add_memory, confirmed_memories, init_memory, memory_records } from "../electron/memory/store.ts";
import { memory_text_chars } from "../electron/memory/text.ts";

let root = "";
let counter = 0;

const fresh = async () => {
  counter += 1;
  const dir = path.join(root, `case-${counter}`);
  await fs.mkdir(dir, { recursive: true });
  const files = { file: path.join(dir, "memories.json"), legacy_file: path.join(dir, "memories-v2.json") };
  await init_memory(files);
  return files;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-memory-add-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("a memory added by the user is saved confirmed and global, survives a reload and is listed first", async () => {
  const files = await fresh();
  const saved = await add_memory("  The user prefers tabs over spaces in Makefiles.  ");
  assert.equal(saved.text, "The user prefers tabs over spaces in Makefiles.");
  assert.equal(saved.status, "confirmed");
  assert.equal(saved.scope, "global");
  assert.equal(saved.project_path, "");
  assert.equal(memory_records()[0]?.id, saved.id);
  await init_memory(files);
  assert.deepEqual(
    memory_records().map((record) => record.text),
    ["The user prefers tabs over spaces in Makefiles."],
  );
});

test("an empty or whitespace memory is rejected and nothing is written", async () => {
  await fresh();
  await assert.rejects(add_memory("   \n "), /memory text is empty/);
  assert.equal(confirmed_memories().length, 0);
});

test("a memory over the one-memory limit is rejected with its length and the limit", async () => {
  await fresh();
  const text = "a".repeat(memory_text_chars + 1);
  await assert.rejects(add_memory(text), new RegExp(`${memory_text_chars + 1} characters, over the ${memory_text_chars}-character limit`));
  assert.equal(confirmed_memories().length, 0);
  const longest = await add_memory("b".repeat(memory_text_chars));
  assert.equal(longest.text.length, memory_text_chars);
});

test("secrets in an added memory are redacted through the shared write path", async () => {
  await fresh();
  const saved = await add_memory("Deploy with api_key=abc123secret on staging.");
  assert.equal(saved.text, "Deploy with api_key=[redacted] on staging.");
});

test("adding the same memory twice keeps one entry", async () => {
  await fresh();
  await add_memory("The user writes commit messages in English.");
  await add_memory("The user writes commit messages in English.");
  assert.equal(memory_records().length, 1);
});

test("two added memories that share their first words stay two entries", async () => {
  await fresh();
  await add_memory("Antworte auf Deutsch bei Fragen zu VantheaX");
  await add_memory("Antworte auf Deutsch bei Fragen zu Python, aber Code bleibt Englisch");
  await add_memory("Run npm test before every commit in VantheaX");
  await add_memory("Run npm test before every push in other repos");
  assert.deepEqual(
    memory_records().map((record) => record.text).sort(),
    [
      "Antworte auf Deutsch bei Fragen zu Python, aber Code bleibt Englisch",
      "Antworte auf Deutsch bei Fragen zu VantheaX",
      "Run npm test before every commit in VantheaX",
      "Run npm test before every push in other repos",
    ],
  );
  assert.equal(new Set(memory_records().map((record) => record.id)).size, 4);
});

test("an added memory that differs only in whitespace merges with the existing one", async () => {
  await fresh();
  const first = await add_memory("The user writes commit messages in English.");
  const second = await add_memory("The user  writes commit\tmessages in English.");
  assert.equal(second.id, first.id);
  assert.equal(memory_records().length, 1);
});

test("memory:add is a declared invoke channel", () => {
  assert.equal(channel_kind("memory:add"), "invoke");
});
