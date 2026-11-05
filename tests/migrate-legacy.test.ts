import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { brotliCompressSync } from "node:zlib";
import type { AssistantMessage, Chat, Message, Step, ToolStep, UserMessage } from "../shared/chat.ts";
import { convert_legacy_chat } from "../electron/chats/legacy/message.ts";
import { legacy_chat_file } from "../electron/chats/legacy/import.ts";
import { get_chat, list_chats, search_chats } from "../electron/chats/store.ts";
import { init_artifacts, list_artifacts } from "../electron/media/artifacts.ts";
import { media_path } from "../electron/media/files.ts";
import { boot_chats, make_root, media_dirs_in } from "./fixtures/legacy/harness.ts";

const fixtures = path.join(import.meta.dirname, "fixtures", "legacy");
const chat_names = ["plain-turn", "tools-segments", "interrupted", "attachments", "web-search", "generated-image"];
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38]);

const load_fixture = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path.join(fixtures, "chats", `${name}.json`), "utf8"));

const convert = async (name: string) => convert_legacy_chat(await load_fixture(name), "2026-10-06T00:00:00.000Z", legacy_root);

const assistant = (chat: Chat, index: number): AssistantMessage => {
  const message = chat.messages[index];
  assert.equal(message?.role, "assistant");
  return message as AssistantMessage;
};

const user = (chat: Chat, index: number): UserMessage => {
  const message = chat.messages[index];
  assert.equal(message?.role, "user");
  return message as UserMessage;
};

const tools = (message: Message): ToolStep[] => (message.role === "assistant" ? message.steps.filter((step): step is ToolStep => step.kind === "tool") : []);

const kinds = (steps: Step[]) => steps.map((step) => (step.kind === "tool" ? `${step.name}:${step.status}:${step.view?.kind}` : step.kind));

let legacy_root = "";
let root = "";

before(async () => {
  root = await make_root("vx-migrate-");
  legacy_root = path.join(root, "legacy");
  const store = path.join(legacy_root, "chat-store");
  await fs.mkdir(path.join(store, "data-v2"), { recursive: true });
  const entries = [];
  for (const name of chat_names) {
    const chat = await load_fixture(name);
    entries.push({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt });
    await fs.writeFile(legacy_chat_file(store, String(chat.id)), brotliCompressSync(Buffer.from(JSON.stringify(chat))));
  }
  entries.push({ id: "broken-chat", title: "unreadable" });
  await fs.writeFile(legacy_chat_file(store, "broken-chat"), Buffer.from("not brotli"));
  await fs.writeFile(path.join(store, "index.json"), JSON.stringify({ version: 2, chats: entries }));
  await fs.mkdir(path.join(legacy_root, "images"), { recursive: true });
  await fs.mkdir(path.join(legacy_root, "files"), { recursive: true });
  await fs.writeFile(path.join(legacy_root, "images", "img_mfz1abcd_0a1b2c.png"), png);
  await fs.writeFile(path.join(legacy_root, "images", "img_mfq2k1a0_3fa9c1.png"), png);
  await fs.writeFile(path.join(legacy_root, "images", "img_mfq2k9zz_77aa01.webp"), webp);
  await fs.writeFile(path.join(legacy_root, "files", "att_mfz1abce_9f8e7d.log"), "AV at 0x10\n");
  await fs.copyFile(path.join(fixtures, "artifacts.json"), path.join(legacy_root, "artifacts.json"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("plain turn: segments become text steps, content-only messages become one text step", async () => {
  const { chat } = await convert("plain-turn");
  assert.equal(chat.title, "Explain RAII");
  assert.equal(chat.pinned, true);
  assert.equal(chat.project_path, "");
  assert.equal(chat.workspace, path.join(legacy_root, "workspace", "2026-09-12 Explain RAII 0b9e"));
  assert.equal(user(chat, 0).text, "Explain RAII in two sentences.");
  assert.equal(user(chat, 0).origin, "user");
  const first = assistant(chat, 1);
  assert.equal(first.status, "done");
  assert.equal(first.model, "deepseek/deepseek-v4-flash");
  assert.equal(first.ended_at, "2026-09-12T09:00:04.700Z");
  assert.deepEqual(first.steps.map((step) => (step.kind === "text" ? step.text : step.kind)), [
    "RAII ties a resource to an object's lifetime. ",
    "The constructor acquires it and the destructor releases it, so cleanup happens on every exit path.",
  ]);
  const old = assistant(chat, 3);
  assert.deepEqual(old.steps, [{ id: "text:0", round: 0, kind: "text", text: "Older turns stored only content and a flat tools list." }]);
});

test("tools and segments map to terminal tool steps with matching views", async () => {
  const { chat } = await convert("tools-segments");
  const turn = assistant(chat, 1);
  assert.deepEqual(kinds(turn.steps), [
    "text",
    "read_file:done:read",
    "grep_files:done:grep",
    "steer",
    "run_command:done:command",
    "replace_in_file:done:edit",
    "update_todos:done:todos",
    "mcp__ida-pro__decompile_function:done:mcp",
    "run_command:denied:text",
    "notice",
    "text",
  ]);
  const [read, grep, command, edit, todo, mcp] = tools(turn);
  assert.deepEqual(read?.view, { kind: "read", path: "src/render/camera.cpp", start_line: 1, end_line: 80, total_lines: 214, truncated: false });
  assert.equal(grep?.view?.kind === "grep" ? grep.view.matches.length : 0, 2);
  assert.equal(command?.view?.kind === "command" ? command.view.exit_code : -1, 0);
  assert.equal(edit?.view?.kind === "edit" ? edit.view.diff.map((line) => line.kind).join(",") : "", "context,remove,add,context,gap,context");
  assert.deepEqual(todo?.view, { kind: "todos", todos: [{ id: "1", text: "Fix row order", status: "done" }, { id: "2", text: "Rebuild", status: "pending" }] });
  assert.deepEqual(mcp?.view, { kind: "mcp", server: "ida-pro", tool: "decompile_function", text: "__int64 __fastcall sub_1800A2F40(float *a1) { ... }", is_error: false });
  assert.equal(read?.call_id, "call_read_1");
  assert.ok((read?.result_text ?? "").includes("camera.cpp"));
  assert.equal(turn.steps.at(-1)?.round, 1);
  const notice = turn.steps.find((step) => step.kind === "notice");
  assert.equal(notice?.kind === "notice" ? notice.notice : "", "output_limit");
  const plan = assistant(chat, 3);
  assert.equal(plan.plan, true);
  const plan_view = tools(plan)[0]?.view;
  assert.ok(plan_view?.kind === "plan" && plan_view.text.startsWith("Move the overlay draw list into its own module.\n\nKey changes:\n- Add overlay::render()"));
  assert.equal(user(chat, 4).origin, "plan_accept");
});

test("interrupted, stopped, failed and blocked turns get terminal statuses and errors", async () => {
  const { chat } = await convert("interrupted");
  assert.equal(chat.title, "");
  const streaming = assistant(chat, 1);
  assert.equal(streaming.status, "interrupted");
  assert.equal(streaming.error?.kind, "app_closed");
  assert.deepEqual(kinds(streaming.steps), ["text", "start_background_task:done:background", "run_command:cancelled:text"]);
  assert.equal(user(chat, 2).origin, "continue");
  const timed_out = assistant(chat, 3);
  assert.equal(timed_out.status, "interrupted");
  assert.deepEqual(timed_out.error, { kind: "timeout", message: "The provider sent nothing for 300 s." });
  assert.deepEqual(kinds(timed_out.steps), ["run_command:cancelled:text", "text"]);
  const stopped = assistant(chat, 5);
  assert.equal(stopped.status, "stopped");
  assert.equal(tools(stopped)[0]?.status, "cancelled");
  const failed = assistant(chat, 7);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.error, { kind: "internal", message: "OpenRouter returned HTTP 401: No auth credentials found" });
  assert.deepEqual(failed.steps, []);
  const blocked = assistant(chat, 8);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.error?.kind, "policy");
  for (const message of chat.messages) {
    for (const step of tools(message)) {
      assert.ok(["done", "failed", "denied", "cancelled"].includes(step.status));
    }
  }
});

test("attachments keep their ids, display names and vision notes, unsafe names are dropped", async () => {
  const { chat, media } = await convert("attachments");
  assert.deepEqual(user(chat, 0).attachments, [
    {
      id: "img_mfz1abcd_0a1b2c.png",
      kind: "image",
      name: "img_mfz1abcd_0a1b2c.png",
      mime: "image/png",
      size: 48213,
      vision_note: "A Windows error dialog: access violation reading 0x0000000000000010 in client.dll.",
    },
    { id: "att_mfz1abce_9f8e7d.log", kind: "file", name: "crash-2026-09-25.log", mime: "text/plain", size: 1824, vision_note: null },
  ]);
  assert.equal(user(chat, 2).attachments[0]?.id, "att_mfz1abce_9f8e7d.log");
  assert.deepEqual(user(chat, 3).attachments, []);
  assert.deepEqual(chat.summary, { text: "User shared a crash screenshot and log; cause is a null pawn.", through_message_id: "d4000000-0000-4000-8000-000000000002" });
  assert.deepEqual(new Set(media.map((ref) => `${ref.bucket}:${ref.name}`)), new Set(["attachment:img_mfz1abcd_0a1b2c.png", "attachment:att_mfz1abce_9f8e7d.log"]));
});

test("web searches become web_search views, a failed one keeps its error", async () => {
  const { chat } = await convert("web-search");
  assert.equal(chat.project_path, "D:\\Projects\\vanthea");
  assert.equal(chat.workspace, "");
  const [advanced, basic, failed] = tools(assistant(chat, 1));
  assert.deepEqual(advanced?.view, {
    kind: "web_search",
    query: "Electron 39 protocol.handle changes",
    depth: "advanced",
    answer: "Electron 39 added range request streaming to protocol.handle [1] and deprecated registerFileProtocol [2].",
    sources: [
      { title: "Electron 39.0.0 release notes", url: "https://www.electronjs.org/blog/electron-39-0", snippet: "" },
      { title: "protocol | Electron", url: "https://www.electronjs.org/docs/latest/api/protocol", snippet: "" },
    ],
  });
  assert.equal(basic?.view?.kind === "web_search" ? basic.view.depth : "", "basic");
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.error, "Web search failed: HTTP 432");
});

test("generated images, agents, browser, skills, memory and background continuations", async () => {
  const { chat, media } = await convert("generated-image");
  const turn = assistant(chat, 1);
  assert.deepEqual(kinds(turn.steps), [
    "generate_image:done:image",
    "generate_image:failed:text",
    "deploy_agent:done:agent",
    "browser_navigate:done:browser",
    "read_skill:done:skill",
    "remember:done:memory",
    "datetime:done:text",
    "text",
  ]);
  const [image, , agent, browser, , memory, datetime] = tools(turn);
  assert.deepEqual(image?.view, { kind: "image", images: [{ id: "img_mfq2k1a0_3fa9c1.png", width: null, height: null }] });
  assert.equal(agent?.view?.kind === "agent" ? agent.view.name : "", "palette-scout");
  assert.deepEqual(browser?.view, { kind: "browser", action: "navigate", url: "https://dribbble.com/search/hex-logo", title: "", detail: "goto" });
  assert.deepEqual(memory?.view, { kind: "memory", action: "remember", text: "User prefers flat two-color logos" });
  assert.deepEqual(datetime?.view, { kind: "text", text: "2026-09-14T12:22:05+02:00 Europe/Berlin" });
  assert.deepEqual(media, [{ bucket: "image", name: "img_mfq2k1a0_3fa9c1.png" }]);
  const background = user(chat, 2);
  assert.equal(background.origin, "background");
  assert.equal(assistant(chat, 3).id, "f6000000-0000-4000-8000-000000000003");
  assert.equal(chat.summary?.through_message_id, "f6000000-0000-4000-8000-000000000002");
});

test("first start imports legacy chats, media and artifacts and skips a broken chat", async () => {
  await boot_chats(root, legacy_root);
  const listed = list_chats();
  assert.equal(listed.length, chat_names.length);
  assert.equal(listed[0]?.title, "Electron 39 release notes");
  assert.equal(listed.find((meta) => meta.id === "3f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a")?.title, "");
  assert.equal(listed.find((meta) => meta.title === "Explain RAII")?.pinned, true);
  const dirs = media_dirs_in(root);
  assert.deepEqual((await fs.readdir(dirs.attachments)).sort(), ["att_mfz1abce_9f8e7d.log", "img_mfz1abcd_0a1b2c.png"]);
  assert.deepEqual(await fs.readdir(dirs.images), ["img_mfq2k1a0_3fa9c1.png"]);
  assert.equal(await fs.readFile(media_path("attachment", "att_mfz1abce_9f8e7d.log"), "utf8"), "AV at 0x10\n");
  const chat = await get_chat("9a8b7c6d-5e4f-4031-a2b1-c0d9e8f7a6b5");
  assert.equal(chat?.messages.length, 4);
  const index = JSON.parse(await fs.readFile(path.join(root, "v2", "chats", "index.json"), "utf8"));
  assert.equal(index.refs["att_mfz1abce_9f8e7d.log"], 1);
  assert.equal((await search_chats("null pawn"))[0]?.chat_id, "9a8b7c6d-5e4f-4031-a2b1-c0d9e8f7a6b5");
  await boot_chats(root, legacy_root);
  assert.equal(list_chats().length, chat_names.length);
  const changes: string[] = [];
  await init_artifacts({
    file: path.join(root, "v2", "artifacts.json"),
    legacy_file: path.join(legacy_root, "artifacts.json"),
    legacy_root,
    on_change: (project_path) => changes.push(project_path),
  });
  const artifacts = list_artifacts("d:/projects/vanthea");
  assert.deepEqual(artifacts.map((entry) => [entry.id, entry.title, entry.pinned]), [["img_mfq2k1a0_3fa9c1.png", "Logo draft", true]]);
  assert.deepEqual(list_artifacts("").map((entry) => entry.id), ["img_mfq2k9zz_77aa01.webp"]);
  assert.deepEqual((await fs.readdir(dirs.images)).sort(), ["img_mfq2k1a0_3fa9c1.png", "img_mfq2k9zz_77aa01.webp"]);
  await fs.access(path.join(legacy_root, "images", "img_mfq2k1a0_3fa9c1.png"));
});
