import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, mock, test } from "node:test";
import type { AssistantMessage, Message, ToolStep } from "../shared/chat.ts";
import type { ReviewRecord } from "../shared/review.ts";
import {
  append_message,
  create_chat,
  delete_chat,
  flush_all_sync,
  flush_chat,
  fork_chat,
  get_chat,
  list_chats,
  search_chats,
  set_streaming,
  set_summary,
  truncate_after,
  update_message,
  update_meta,
} from "../electron/chats/store.ts";
import { media_path, save_attachment } from "../electron/media/files.ts";
import { assistant_message, boot_chats, chat_dirs_in, make_root, read_disk_chat, sleep, user_message } from "./fixtures/legacy/harness.ts";
import { review_record } from "./fixtures/review/record.ts";

const roots: string[] = [];

const fresh = async () => {
  const root = await make_root("vx-chats-");
  roots.push(root);
  return { root, env: await boot_chats(root) };
};

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const append_text = (text: string) => (message: Message): Message =>
  message.role === "assistant" ? { ...message, steps: [{ id: "text:1", round: 0, kind: "text", text }] } : message;

test("create, append and reload a chat from disk", async () => {
  const { root, env } = await fresh();
  const meta = await create_chat("D:\\Projects\\demo");
  assert.equal(meta.title, "");
  await append_message(meta.id, user_message("u1", "hello"));
  await append_message(meta.id, assistant_message("a1", "hi there"));
  await update_meta(meta.id, { title: "Greeting", pinned: true });
  assert.equal(env.changed.at(-1)?.title, "Greeting");
  await boot_chats(root);
  const [listed] = list_chats();
  assert.equal(listed?.id, meta.id);
  assert.equal(listed?.message_count, 2);
  assert.equal(listed?.pinned, true);
  const chat = await get_chat(meta.id);
  assert.deepEqual(chat?.messages.map((message) => message.id), ["u1", "a1"]);
  await assert.rejects(append_message(meta.id, user_message("u1", "dup")), /already exists/);
});

test("reasoning details survive a reload and chats saved without them load with none", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  const details = [{ type: "reasoning.text", text: "plan", format: "unknown", index: 0, signature: "sig" }];
  const older = Object.fromEntries(Object.entries(assistant_message("a0", "old")).filter(([key]) => key !== "reasoning_details")) as AssistantMessage;
  await append_message(meta.id, user_message("u1", "go"));
  await append_message(meta.id, older);
  await append_message(meta.id, user_message("u2", "again"));
  await append_message(meta.id, { ...assistant_message("a1", "new"), reasoning_details: [{ round: 0, details }] });
  await flush_chat(meta.id);
  await boot_chats(root);
  const chat = await get_chat(meta.id);
  const stored = chat?.messages.map((message) => (message.role === "assistant" ? message.reasoning_details : null));
  assert.deepEqual(stored, [null, [], null, [{ round: 0, details }]]);
});

test("a chat whose last turn was streaming loads as interrupted with app_closed", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, user_message("u1", "run it"));
  const running: AssistantMessage = {
    ...assistant_message("a1", "working", "streaming"),
    steps: [
      { id: "text:1", round: 0, kind: "text", text: "working" },
      {
        id: "tool:0:1",
        round: 0,
        kind: "tool",
        index: 1,
        call_id: "c1",
        name: "run_command",
        args: { command: "npm test" },
        status: "running",
        progress: null,
        approval: null,
        view: null,
        error: null,
        result_text: "",
        started_at: 1,
        ended_at: null,
      },
    ],
  };
  await append_message(meta.id, running);
  set_streaming(meta.id, true);
  await boot_chats(root);
  assert.equal(list_chats()[0]?.streaming, false);
  const chat = await get_chat(meta.id);
  const last = chat?.messages.at(-1);
  assert.equal(last?.role, "assistant");
  if (last?.role !== "assistant") {
    return;
  }
  assert.equal(last.status, "interrupted");
  assert.deepEqual(last.error, { kind: "app_closed", message: "The app was closed while this turn was still running." });
  assert.equal(last.last_seq, 2);
  assert.notEqual(last.ended_at, null);
  assert.deepEqual(last.steps.map((step) => (step.kind === "tool" ? step.status : step.kind)), ["text", "cancelled"]);
  await flush_chat(meta.id);
  const disk = await read_disk_chat(root, meta.id);
  assert.equal(disk.messages[1].status, "interrupted");
});

test("update_message is synchronous in memory and writes at most once per two seconds", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, assistant_message("a1", "", "streaming"));
  set_streaming(meta.id, true);
  update_message(meta.id, "a1", append_text("one"));
  update_message(meta.id, "a1", append_text("one two"));
  const live = await get_chat(meta.id);
  const step = live?.messages[0]?.role === "assistant" ? live.messages[0].steps[0] : null;
  assert.equal(step?.kind === "text" ? step.text : "", "one two");
  await sleep(900);
  assert.deepEqual((await read_disk_chat(root, meta.id)).messages[0].steps, []);
  update_message(meta.id, "a1", append_text("one two three"));
  await sleep(1500);
  assert.equal((await read_disk_chat(root, meta.id)).messages[0].steps[0].text, "one two three");
  update_message(meta.id, "a1", append_text("final"));
  await flush_chat(meta.id);
  assert.equal((await read_disk_chat(root, meta.id)).messages[0].steps[0].text, "final");
  assert.throws(() => update_message(meta.id, "missing", append_text("x")), /not found/);
});

test("flush_all_sync writes pending chat state synchronously", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, assistant_message("a1", "", "streaming"));
  update_message(meta.id, "a1", append_text("written on quit"));
  flush_all_sync();
  assert.equal((await read_disk_chat(root, meta.id)).messages[0].steps[0].text, "written on quit");
  const index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.equal(index.chats[0].id, meta.id);
});

test("a partial save still encoding when the quit save runs does not overwrite the quit save", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, assistant_message("a1", "", "streaming"));
  update_message(meta.id, "a1", append_text("OLD"));
  const pending = flush_chat(meta.id);
  for (let tick = 0; tick < 5; tick += 1) {
    await Promise.resolve();
  }
  update_message(meta.id, "a1", append_text("NEW"));
  flush_all_sync();
  await pending;
  await sleep(50);
  assert.equal((await read_disk_chat(root, meta.id)).messages[0].steps[0].text, "NEW");
});

test("deleting a chat removes an attachment only when no other chat references it", async () => {
  const { root, env } = await fresh();
  const attachment = await save_attachment({ name: "notes.md", mime: "text/markdown", bytes: new TextEncoder().encode("# notes") });
  const file = media_path("attachment", attachment.id);
  const first = await create_chat("");
  await append_message(first.id, user_message("u1", "see file", [attachment]));
  await append_message(first.id, assistant_message("a1", "read it"));
  const forked = await fork_chat(first.id, "u1");
  const other = await create_chat("");
  await append_message(other.id, user_message("u9", "same file", [attachment]));
  let index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.equal(index.refs[attachment.id], 3);
  await delete_chat(first.id);
  await delete_chat(forked.id);
  await fs.access(file);
  await delete_chat(other.id);
  await assert.rejects(fs.access(file));
  index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.deepEqual(index.refs, {});
  assert.deepEqual(env.removed, [first.id, forked.id, other.id]);
  assert.equal(await get_chat(first.id), null);
  await assert.rejects(fs.access(path.join(chat_dirs_in(root).data_dir, `${first.id}.vxc`)));
});

test("an attachment sent with a steer is referenced by its chat and removed with it", async () => {
  const { root } = await fresh();
  const attachment = await save_attachment({ name: "ref.md", mime: "text/markdown", bytes: new TextEncoder().encode("# ref") });
  const file = media_path("attachment", attachment.id);
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "go"));
  await append_message(chat.id, assistant_message("a1", "working", "streaming"));
  update_message(chat.id, "a1", (message) =>
    message.role === "assistant" ? { ...message, steps: [...message.steps, { id: "steer:9", round: 0, kind: "steer", text: "use this", attachments: [attachment] }] } : message,
  );
  await update_meta(chat.id, { pinned: true });
  const index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.equal(index.refs[attachment.id], 1);
  await delete_chat(chat.id);
  await assert.rejects(fs.access(file));
});

test("overlapping deletes of one chat release its attachment references once", async () => {
  const { root } = await fresh();
  const attachment = await save_attachment({ name: "shared.md", mime: "text/markdown", bytes: new TextEncoder().encode("# shared") });
  const file = media_path("attachment", attachment.id);
  const first = await create_chat("");
  await append_message(first.id, user_message("u1", "see file", [attachment]));
  const forked = await fork_chat(first.id, "u1");
  flush_all_sync();
  const env = await boot_chats(root);
  await Promise.all([delete_chat(first.id), delete_chat(first.id), delete_chat(first.id)]);
  await fs.access(file);
  const index = JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8"));
  assert.equal(index.refs[attachment.id], 1);
  assert.deepEqual(env.removed, [first.id]);
  assert.equal((await get_chat(forked.id))?.messages[0]?.role, "user");
  await delete_chat(forked.id);
  await assert.rejects(fs.access(file));
});

test("fork copies messages up to the given message and keeps a covered summary", async () => {
  await fresh();
  const meta = await create_chat("D:\\p");
  await update_meta(meta.id, { title: "Origin" });
  await append_message(meta.id, user_message("u1", "a"));
  await append_message(meta.id, assistant_message("a1", "b"));
  await append_message(meta.id, user_message("u2", "c"));
  await set_summary(meta.id, { text: "summary", through_message_id: "a1" });
  const forked = await fork_chat(meta.id, "a1");
  assert.equal(forked.title, "Origin (fork)");
  assert.equal(forked.message_count, 2);
  const chat = await get_chat(forked.id);
  assert.deepEqual(chat?.summary, { text: "summary", through_message_id: "a1" });
  const shallow = await fork_chat(meta.id, "u1");
  assert.equal((await get_chat(shallow.id))?.summary, null);
});

test("truncate_after drops later messages and a summary that no longer applies", async () => {
  await fresh();
  const meta = await create_chat("");
  await append_message(meta.id, user_message("u1", "a"));
  await append_message(meta.id, assistant_message("a1", "b"));
  await append_message(meta.id, user_message("u2", "c"));
  await append_message(meta.id, assistant_message("a2", "d"));
  await set_summary(meta.id, { text: "s", through_message_id: "a2" });
  await truncate_after(meta.id, "u2");
  const chat = await get_chat(meta.id);
  assert.deepEqual(chat?.messages.map((message) => message.id), ["u1", "a1", "u2"]);
  assert.equal(chat?.message_count, 3);
  assert.equal(chat?.summary, null);
});

test("search is case-insensitive over title, project, user text and assistant text, with snippets and a cap", async () => {
  await fresh();
  const titled = await create_chat("D:\\Projects\\Overlay");
  await update_meta(titled.id, { title: "Matrix Math" });
  const body = await create_chat("");
  await append_message(body.id, user_message("u1", `${"x ".repeat(80)}the VIEW matrix row order is wrong${" y".repeat(80)}`));
  const answer = await create_chat("");
  await append_message(answer.id, assistant_message("a1", "Use a column-major Matrix here."));
  const none = await create_chat("");
  await append_message(none.id, user_message("u1", "unrelated"));
  const hits = await search_chats("  MATRIX ");
  assert.deepEqual(new Set(hits.map((hit) => hit.chat_id)), new Set([titled.id, body.id, answer.id]));
  const body_hit = hits.find((hit) => hit.chat_id === body.id);
  assert.match(body_hit?.snippet ?? "", /^\.\.\..*VIEW matrix row order.*\.\.\.$/);
  assert.equal(hits.find((hit) => hit.chat_id === titled.id)?.snippet, "");
  assert.equal((await search_chats("overlay"))[0]?.chat_id, titled.id);
  assert.equal((await search_chats("overlay"))[0]?.snippet, "");
  assert.deepEqual(await search_chats("   "), []);
  for (let index = 0; index < 55; index += 1) {
    const chat = await create_chat("");
    await update_meta(chat.id, { title: `bulk ${index}` });
  }
  assert.equal((await search_chats("bulk")).length, 50);
});

const tool_step = (call_id: string, extra: Partial<ToolStep> = {}): ToolStep => ({
  id: `tool:0:${call_id}`,
  round: 0,
  kind: "tool",
  index: 0,
  call_id,
  name: "run_command",
  args: { command: "git push" },
  status: "denied",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "denied",
  started_at: 1,
  ended_at: 2,
  ...extra,
});

test("a chat saved before review records loads unchanged", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  const decision = {
    id: "d1",
    at: 3,
    actor: "main",
    tool: "run_command",
    subject: "git push",
    cwd: "D:/p",
    approved: false,
    grant: "once" as const,
    feedback: "not yet",
    reason: "pushes to the remote",
    context_hash: "abc",
  };
  const older: AssistantMessage = {
    ...assistant_message("a1", ""),
    steps: [
      tool_step("c1", { decisions: [decision] }),
      { id: "steer:4", round: 1, kind: "steer", text: "use the other remote", steer_id: "s1" },
      { id: "text:5", round: 1, kind: "text", text: "ok" },
    ],
  };
  await append_message(meta.id, user_message("u1", "push it"));
  await append_message(meta.id, older);
  await flush_chat(meta.id);
  await boot_chats(root);
  const chat = await get_chat(meta.id);
  assert.deepEqual(chat?.messages, [user_message("u1", "push it"), older]);
});

test("review records on tool steps are coerced on load and malformed ones are dropped", async () => {
  const { root } = await fresh();
  const meta = await create_chat("");
  const kept = review_record("r1", { verdict: "deny", reason: "pushes" });
  const broken = { ...review_record("r2"), verdict: "perhaps" };
  const reviewed = {
    ...assistant_message("a1", ""),
    steps: [tool_step("c1", { reviews: [kept, broken] as ReviewRecord[] }), tool_step("c2", { reviews: "garbage" as unknown as ReviewRecord[] })],
  };
  await append_message(meta.id, reviewed);
  await flush_chat(meta.id);
  const warn = mock.method(console, "warn", () => {});
  try {
    await boot_chats(root);
    const chat = await get_chat(meta.id);
    const message = chat?.messages[0];
    const steps = message?.role === "assistant" ? message.steps : [];
    assert.deepEqual(steps[0]?.kind === "tool" ? steps[0].reviews : null, [kept]);
    assert.equal(Object.hasOwn(steps[1] ?? {}, "reviews"), false);
    const texts = warn.mock.calls.map((call) => String(call.arguments[0]));
    assert.equal(texts.length, 2);
    assert.match(texts[0] ?? "", new RegExp(`chat ${meta.id}, step c1: record r2 has no valid verdict`));
    assert.match(texts[1] ?? "", new RegExp(`chat ${meta.id}, step c2: not a list`));
  } finally {
    warn.mock.restore();
  }
});
