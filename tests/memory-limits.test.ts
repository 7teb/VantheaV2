import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AssistantMessage, UserMessage } from "../shared/chat.ts";
import { canonicalize_memory, parse_canonical } from "../electron/memory/canonical.ts";
import { extraction_messages } from "../electron/memory/extract.ts";
import { new_memory_id, normalize_entry, sanitize_candidate } from "../electron/memory/records.ts";
import { confirm_memory, find_confirmed, init_memory, memory_records, review_items, store_scan_result } from "../electron/memory/store.ts";
import { memory_text_chars } from "../electron/memory/text.ts";
import { memory_tools } from "../electron/tools/memory/index.ts";
import type { SideModelCall, ToolContext } from "../electron/tools/types.ts";

let root = "";

const now = "2026-10-12T10:00:00.000Z";

const long_text = (chars: number) => `The user keeps one long convention: ${"w".repeat(chars - 36)}`;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-memory-limits-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("one constant of 25000 characters bounds a memory text", () => {
  assert.equal(memory_text_chars, 25000);
  assert.equal(long_text(memory_text_chars).length, memory_text_chars);
});

test("remember refuses a longer text with its length and the limit instead of cutting it", async () => {
  const remember = memory_tools.find((tool) => tool.spec.name === "remember");
  assert.ok(remember);
  const text = "x".repeat(memory_text_chars + 1);
  await assert.rejects(
    async () => remember.execute({} as ToolContext, { text }),
    (error: unknown) => error instanceof Error && error.message === `text is ${memory_text_chars + 1} characters, over the ${memory_text_chars}-character limit for one memory. Nothing was saved. Shorten the fact and call remember again.`,
  );
});

test("loading, canonicalizing and candidate handling keep a memory text up to the limit", () => {
  const full = long_text(memory_text_chars);
  const loaded = normalize_entry({ text: full, evidence: full, kind: "global_preference", status: "confirmed" }, now);
  assert.equal(loaded?.text, full);
  assert.equal(loaded?.evidence, full);
  assert.equal(normalize_entry({ text: `${full}tail`, kind: "global_preference" }, now)?.text.length, memory_text_chars);
  assert.equal(parse_canonical(JSON.stringify({ kind: "global_preference", key: "workflow.long", text: full }), "fallback").text, full);
});

test("a long memory survives a save, a reload and an exact-text forget lookup, and a long candidate is saved whole", async () => {
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
  const candidate = long_text(3000);
  await store_scan_result(
    { chat_id: "chat-1", message_id: "m2", content: "please remember: always keep logs", project_path: "" },
    [{ kind: "global_environment", key: "environment.logs", text: candidate, evidence: "always keep logs", confidence: 0.95, explicit: true }],
    "scanned",
  );
  assert.ok(memory_records().some((record) => record.text === candidate));
  assert.equal(review_items().length, 0);
});

test("canonicalizing sends the whole memory without an output cap and reports a failed classification", async () => {
  const full = long_text(memory_text_chars);
  const calls: { max_tokens: number | null; content: string }[] = [];
  const answer: SideModelCall = async (_role, messages, max_tokens) => {
    calls.push({ max_tokens, content: messages.at(-1)?.content ?? "" });
    return JSON.stringify({ kind: "project_rule", key: "project.long", text: full });
  };
  const canonical = await canonicalize_memory(full, [], answer, new AbortController().signal);
  assert.deepEqual(canonical, { kind: "project_rule", key: "project.long", text: full, failure: null });
  assert.equal(calls[0]?.max_tokens, null);
  assert.ok(calls[0]?.content.endsWith(full));
  const broken: SideModelCall = async () => '{"kind":"project_rule","key":"project.long","text":"cut';
  const fallback = await canonicalize_memory("Run the tests before a push.", [], broken, new AbortController().signal);
  assert.equal(fallback.kind, "global_preference");
  assert.equal(fallback.text, "Run the tests before a push.");
  assert.ok(fallback.failure);
});

test("memory extraction sees whole messages and finds evidence anywhere in a long source message", () => {
  const filler = "The build log follows. ".repeat(600);
  const content = `${filler}Please remember: always answer in German.`;
  const user: UserMessage = { id: "u1", role: "user", origin: "user", text: content, attachments: [], created_at: now };
  const assistant = { id: "a1", role: "assistant", status: "done", steps: [{ id: "t1", kind: "text", round: 0, text: "x".repeat(5000) }] } as AssistantMessage;
  const messages = extraction_messages({ previous: [], user, assistant }, []);
  const prompt = messages.at(-1)?.content ?? "";
  assert.ok(prompt.endsWith(`SOURCE USER MESSAGE:\n${content}`));
  assert.ok(prompt.includes(`ASSISTANT: ${"x".repeat(5000)}`));
  const verdict = sanitize_candidate(
    { kind: "global_preference", key: "communication.language", text: "Answer in German.", evidence: "always answer in German", confidence: 0.95, explicit: true },
    { chat_id: "c1", message_id: "u1", content, project_path: "" },
    now,
  );
  assert.equal(verdict.entry?.text, "Answer in German.");
});
