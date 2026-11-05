import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { AssistantMessage, ToolStep } from "../shared/chat.ts";
import { append_message, create_chat, flush_all_sync } from "../electron/chats/store.ts";
import { style_check, style_findings, style_marker, style_note } from "../electron/tools/fs/style-check.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { assistant_message, boot_chats, make_root } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const write_step = (index: number, result_text: string): ToolStep => ({
  id: `tool:${index}`,
  round: index,
  kind: "tool",
  index: 0,
  call_id: `call-${index}`,
  name: "write_file",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text,
  started_at: null,
  ended_at: null,
});

const banner = "// ==========================================";

test("new g_ names and banner lines in a code file are found", () => {
  const content = ["int g_count = 0;", "static Device* g_device;", banner, "int msg_total = g_count;", "; ------------------", "void tick() {}"].join("\n");
  assert.deepEqual(style_findings("src/main.cpp", null, content), { names: ["g_count", "g_device"], separators: 2 });
});

test("only what the write added counts", () => {
  const previous = ["int g_count = 0;", banner, "void tick() {}"].join("\n");
  assert.equal(style_findings("src/main.cpp", previous, `${previous}\nvoid tock() {}`), null);
  assert.deepEqual(style_findings("src/main.cpp", previous, `${previous}\nint g_extra = 1;\n${banner}`), { names: ["g_extra"], separators: 1 });
});

test("strings, longer names, short rules and non-code files are left alone", () => {
  assert.equal(style_findings("src/main.cpp", null, 'puts("=================="); int log_g_ok = 0; int msg_x = 1; // ----'), null);
  assert.equal(style_findings("README.md", null, "Title\n==========\nint g_state;"), null);
  assert.equal(style_findings("notes.txt", null, "g_state"), null);
  assert.deepEqual(style_findings("tool.py", null, "##############\nx = 1"), { names: [], separators: 1 });
});

test("the note names what was added and that overrides are fine", () => {
  const note = style_note({ names: ["g_a", "g_b", "g_c", "g_d", "g_e", "g_f", "g_g"], separators: 1 });
  assert.ok(note.startsWith(`${style_marker}: you added names with a g_ prefix (g_a, g_b, g_c, g_d, g_e and 2 more) and 1 separator or banner line, which the code rules turn off by default.`));
  assert.match(note, /fine when the user, their custom instructions, the project's instruction files or the project's existing code ask for this style/);
  assert.match(style_note({ names: [], separators: 3 }), /you added 3 separator or banner lines,/);
});

test("a sub-agent gets the note at most twice", async () => {
  const ctx = { chat_id: "chat-style", review: { actor: { id: "agent-1", name: "Worker", kind: "agent" } } } as unknown as ToolContext;
  const other = { chat_id: "chat-style", review: { actor: { id: "agent-2", name: "Other", kind: "agent" } } } as unknown as ToolContext;
  const notes = [];
  for (let round = 0; round < 3; round += 1) {
    notes.push(await style_check(ctx, "a.ts", null, "let g_x = 1;"));
  }
  assert.deepEqual(notes.map(Boolean), [true, true, false]);
  assert.ok((await style_check(other, "a.ts", null, "let g_x = 1;")).startsWith(style_marker));
  assert.equal(await style_check(ctx, "a.ts", null, "let x = 1;"), "");
});

test("the main chat gets the note at most twice, counted from the stored tool results", async () => {
  const root = await make_root("vx-style-");
  roots.push(root);
  await boot_chats(root);
  const meta = await create_chat("D:/Projects/fresh");
  const ctx = { chat_id: meta.id, review: { actor: { id: "main", name: "main", kind: "main" } } } as unknown as ToolContext;
  const first = await style_check(ctx, "main.cpp", null, "int g_state;");
  assert.ok(first.startsWith(style_marker));
  const message: AssistantMessage = { ...assistant_message("a-1", ""), steps: [write_step(1, `Created main.cpp\n\n${first}`)] };
  await append_message(meta.id, message);
  assert.ok((await style_check(ctx, "util.cpp", null, "int g_other;")).startsWith(style_marker));
  await append_message(meta.id, { ...message, id: "a-2", steps: [write_step(2, `Created util.cpp\n\n${first}`)] });
  assert.equal(await style_check(ctx, "more.cpp", null, "int g_third;"), "");
});
