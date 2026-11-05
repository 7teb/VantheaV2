import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import type { HumanDecision } from "../shared/approval.ts";
import type { AssistantMessage, Message, ToolStep } from "../shared/chat.ts";
import {
  append_message,
  create_chat,
  delete_chat,
  flush_all_sync,
  flush_chat,
  fork_chat,
  get_chat,
  set_streaming,
  truncate_after,
  update_message,
} from "../electron/chats/store.ts";
import { media_path, new_media_id, save_tool_images, write_media } from "../electron/media/files.ts";
import { decisions_in } from "../electron/permissions/decisions.ts";
import { step_outcome } from "../src/features/tools/review-notes.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { assistant_message, boot_chats, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

const roots: string[] = [];

const fresh = async () => {
  const root = await make_root("vx-step-images-");
  roots.push(root);
  return { root, env: await boot_chats(root) };
};

after(async () => {
  flush_all_sync();
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const t: Translate = (key, vars) => translate("en", key, vars);

const tool_step = (call_id: string, extra: Partial<ToolStep> = {}): ToolStep => ({
  id: `tool:${call_id}`,
  round: 0,
  kind: "tool",
  index: 0,
  call_id,
  name: "browser_screenshot",
  args: {},
  status: "done",
  progress: null,
  approval: null,
  view: null,
  error: null,
  result_text: "shot",
  started_at: 1,
  ended_at: 2,
  ...extra,
});

const with_steps = (steps: ToolStep[]) => (message: Message): Message => (message.role === "assistant" ? { ...message, steps: [...message.steps, ...steps] } : message);

const index_refs = async (root: string): Promise<Record<string, number>> => JSON.parse(await fs.readFile(chat_dirs_in(root).index_file, "utf8")).refs;

test("a step image is referenced by its chat, kept by a fork and deleted with the last chat", async () => {
  const { root } = await fresh();
  const [id] = await save_tool_images([{ bytes: Buffer.from("jpeg"), mime: "image/jpeg" }]);
  assert.ok(id);
  const file = media_path("attachment", id);
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look"));
  await append_message(chat.id, assistant_message("a1", "", "done"));
  update_message(chat.id, "a1", with_steps([tool_step("c0_0", { images: [{ id, label: "[Screenshot s1]" }] })]));
  await flush_chat(chat.id);
  assert.equal((await index_refs(root))[id], 1);
  const forked = await fork_chat(chat.id, "a1");
  assert.equal((await index_refs(root))[id], 2);
  await delete_chat(chat.id);
  await fs.access(file);
  const kept = (await get_chat(forked.id))?.messages[1];
  assert.deepEqual(kept?.role === "assistant" && kept.steps.find((step) => step.kind === "tool"), tool_step("c0_0", { images: [{ id, label: "[Screenshot s1]" }] }));
  await delete_chat(forked.id);
  await assert.rejects(fs.access(file));
  assert.deepEqual(await index_refs(root), {});
});

test("truncating a turn deletes its step images and attachments unless a fork still holds them", async () => {
  const { root } = await fresh();
  const [dropped, shared] = await save_tool_images([{ bytes: Buffer.from("jpeg one"), mime: "image/jpeg" }, { bytes: Buffer.from("jpeg two"), mime: "image/jpeg" }]);
  assert.ok(dropped && shared);
  const upload = new_media_id("img", "png");
  await write_media("attachment", upload, Buffer.from("png"));
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "open the page"));
  await append_message(chat.id, assistant_message("a1", "", "done"));
  update_message(chat.id, "a1", with_steps([tool_step("c0_0", { images: [{ id: shared, label: "[Screenshot s1]" }] })]));
  await append_message(chat.id, user_message("u2", "look again", [{ id: upload, kind: "image", name: "ref.png", mime: "image/png", size: 3, vision_note: null }]));
  await append_message(chat.id, assistant_message("a2", "", "done"));
  update_message(chat.id, "a2", with_steps([tool_step("c0_0", { images: [{ id: dropped, label: "[Screenshot s2]" }] })]));
  await flush_chat(chat.id);
  const forked = await fork_chat(chat.id, "a1");
  await truncate_after(chat.id, "u1");
  await assert.rejects(fs.access(media_path("attachment", dropped)));
  await fs.access(media_path("attachment", shared));
  await assert.rejects(fs.access(media_path("attachment", upload)));
  assert.deepEqual(await index_refs(root), { [shared]: 1 });
  await delete_chat(forked.id);
  await assert.rejects(fs.access(media_path("attachment", shared)));
});

test("step images with a foreign or broken id are dropped when the chat loads", async () => {
  const { root } = await fresh();
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look"));
  const message: AssistantMessage = {
    ...assistant_message("a1", "done"),
    steps: [tool_step("c0_0", { images: [{ id: "img_a_b.jpg", label: "[ok]" }, { id: "..\\..\\secret.txt", label: "[bad]" }, { id: "img_c_d.jpg" } as never] })],
  };
  await append_message(chat.id, message);
  await flush_chat(chat.id);
  flush_all_sync();
  await boot_chats(root);
  const loaded = (await get_chat(chat.id))?.messages[1];
  assert.deepEqual(loaded?.role === "assistant" && loaded.steps[0]?.kind === "tool" && loaded.steps[0].images, [{ id: "img_a_b.jpg", label: "[ok]" }]);
});

test("a stored browser_vision approval and decision still load, settle and render", async () => {
  const { root } = await fresh();
  const chat = await create_chat("");
  await append_message(chat.id, user_message("u1", "look at the page"));
  const decision: HumanDecision = { id: "d1", at: 5, actor: "main", tool: "browser_vision", subject: "https://e.com", cwd: "", approved: true, grant: "chat", feedback: "", reason: "" };
  const legacy_approval = { kind: "browser_vision", url: "https://e.com" } as unknown as ToolStep["approval"];
  const running: AssistantMessage = {
    ...assistant_message("a1", "", "streaming"),
    steps: [
      tool_step("c0_0", { name: "browser_visual_analyze", decisions: [decision] }),
      tool_step("c1_0", { name: "browser_visual_analyze", status: "awaiting_approval", approval: legacy_approval, result_text: "", ended_at: null }),
    ],
  };
  await append_message(chat.id, running);
  set_streaming(chat.id, true);
  flush_all_sync();
  await boot_chats(root);
  const loaded = (await get_chat(chat.id))?.messages ?? [];
  const last = loaded[1];
  assert.equal(last?.role, "assistant");
  if (last?.role !== "assistant") {
    return;
  }
  assert.equal(last.status, "interrupted");
  const [done, pending] = last.steps.filter((step): step is ToolStep => step.kind === "tool");
  assert.equal(pending?.status, "cancelled");
  assert.equal(pending?.approval, null);
  assert.deepEqual(done?.decisions, [decision]);
  assert.deepEqual(decisions_in(loaded).map((entry) => `${entry.tool} ${entry.subject}`), ["browser_vision https://e.com"]);
  assert.deepEqual(step_outcome(t, done as ToolStep), { notice: null, footer: ["Approved by you"] });
});
