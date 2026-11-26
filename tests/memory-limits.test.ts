import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { new_memory_id, normalize_entry } from "../electron/memory/records.ts";
import { confirm_memory, find_confirmed, init_memory, memory_records } from "../electron/memory/store.ts";
import { memory_text_chars } from "../electron/memory/text.ts";
import { memory_tools } from "../electron/tools/memory/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";

let root = "";

const now = "2026-10-12T10:00:00.000Z";

const long_text = (chars: number) => `The user keeps one long convention: ${"w".repeat(chars - 36)}`;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-memory-limits-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("remember refuses a longer text with its length and the limit instead of cutting it", async () => {
  const remember = memory_tools.find((tool) => tool.spec.name === "remember");
  assert.ok(remember);
  const text = "x".repeat(memory_text_chars + 1);
  await assert.rejects(
    async () => remember.execute({} as ToolContext, { text, kind: "global_preference" }),
    (error: unknown) => error instanceof Error && error.message === `text is ${memory_text_chars + 1} characters, over the ${memory_text_chars}-character limit for one memory. Nothing was saved. Shorten the fact and call remember again.`,
  );
});

test("remember refuses a missing or unknown kind and names the allowed ones", async () => {
  const remember = memory_tools.find((tool) => tool.spec.name === "remember");
  assert.ok(remember);
  const expected = (error: unknown) => error instanceof Error && error.message === "kind must be one of global_preference, global_environment, project_rule. Nothing was saved.";
  await assert.rejects(async () => remember.execute({} as ToolContext, { text: "Answer in German." }), expected);
  await assert.rejects(async () => remember.execute({} as ToolContext, { text: "Answer in German.", kind: "preference" }), expected);
});

test("loading keeps a memory text up to the limit", () => {
  const full = long_text(memory_text_chars);
  const loaded = normalize_entry({ text: full, evidence: full, kind: "global_preference", status: "confirmed" }, now);
  assert.equal(loaded?.text, full);
  assert.equal(loaded?.evidence, full);
  assert.equal(normalize_entry({ text: `${full}tail`, kind: "global_preference" }, now)?.text.length, memory_text_chars);
});

test("a long memory survives a save, a reload and an exact-text forget lookup", async () => {
  const files = { file: path.join(root, "memories.json"), legacy_file: path.join(root, "memories-v2.json") };
  await init_memory(files);
  const full = long_text(memory_text_chars);
  const saved = await confirm_memory({
    id: new_memory_id(),
    key: "workflow.long_convention",
    kind: "global_preference",
    scope: "global",
    project_path: "",
    text: full,
    evidence: full,
    confidence: 1,
    status: "confirmed",
    source_chat_id: "chat-1",
    source_message_id: "m1",
    created_at: now,
    updated_at: now,
  });
  assert.equal(saved.text, full);
  assert.equal(find_confirmed(full)?.id, saved.id);
  await init_memory(files);
  assert.equal(memory_records()[0]?.text, full);
});
