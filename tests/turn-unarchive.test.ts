import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import type { ChatMeta } from "../shared/chat.ts";
import { assistant_message, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

const stubs: Record<string, string> = {
  electron:
    "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() }; export const ipcMain = { handle() {}, on() {} }; export const Menu = {}; export const BrowserWindow = class {}; export const shell = {}; export const nativeImage = {};",
  drive: "export const drive = async () => {};",
  title: "export const start_title = () => {};",
};

const main_stubs: Plugin = {
  name: "main-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]side[\\/]title\.ts$/ }, () => ({ path: "title", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

const exports = [
  'export { accept_plan, compact_turn, continue_turn, edit_turn, init_turn, start_internal_turn, start_turn, steer_turn } from "./electron/turn/run.ts";',
  'export { append_message, chat_meta, create_chat, flush_all_sync, get_chat, init_chats, update_meta } from "./electron/chats/store.ts";',
  'export { set_storage_root } from "./electron/storage/paths.ts";',
];

let main: any;
let root = "";
const changed: ChatMeta[] = [];

const model = "deepseek/deepseek-v4.1-flash-1017";

const send = (chat_id: string, text: string, model_id = model) => ({ chat_id, text, attachment_ids: [], model: model_id, effort: "", mode: "auto", plan: false, origin: "user" });

const archived_chat = async (seed: "empty" | "worked" = "empty"): Promise<string> => {
  const meta: ChatMeta = await main.create_chat("");
  if (seed === "worked") {
    await main.append_message(meta.id, user_message("u1", "look around"));
    await main.append_message(meta.id, assistant_message("a1", "looked"));
  }
  await main.update_meta(meta.id, { archived: true });
  assert.equal(main.chat_meta(meta.id)?.archived, true);
  return meta.id;
};

const assert_restored = (chat_id: string) => {
  assert.equal("archived" in (main.chat_meta(chat_id) ?? {}), false);
  const last = changed.findLast((meta) => meta.id === chat_id && !meta.archived);
  assert.ok(last, `no unarchived meta was announced for chat ${chat_id}`);
};

before(async () => {
  const result = await build({
    stdin: { contents: exports.join("\n"), resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [main_stubs],
    logLevel: "silent",
  });
  main = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  root = await make_root("vx-unarchive-");
  main.set_storage_root(root);
  await main.init_chats({
    dirs: chat_dirs_in(root),
    legacy_root: path.join(root, "no-legacy"),
    events: {
      changed: (meta: ChatMeta) => void changed.push(meta),
      removed: () => {},
      appended: () => {},
      truncated: () => {},
      questions: () => {},
    },
  });
});

after(async () => {
  main?.flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

test("sending a message in an archived chat unarchives it", async () => {
  const chat_id = await archived_chat();
  await main.start_turn(send(chat_id, "hello again"), [], "user");
  assert_restored(chat_id);
  const chat = await main.get_chat(chat_id);
  assert.equal(chat.messages[0].text, "hello again");
});

test("Initialize, Continue, accepting a plan and an agent report turn unarchive the chat they start in", async () => {
  const starts: [string, (chat_id: string) => Promise<unknown>][] = [
    ["init", (chat_id) => main.init_turn(chat_id, "init")],
    ["continue", (chat_id) => main.continue_turn(chat_id)],
    ["plan", (chat_id) => main.accept_plan(chat_id, "a1")],
    ["report", (chat_id) => main.start_internal_turn(chat_id, "agent_report", "agent finished")],
  ];
  for (const [name, start] of starts) {
    const chat_id = await archived_chat("worked");
    const started = await start(chat_id);
    assert.ok(started, `${name} did not start a turn`);
    assert_restored(chat_id);
  }
});

test("editing a message and compacting start turns that unarchive the chat too", async () => {
  const edited = await archived_chat("worked");
  await main.edit_turn(edited, "u1", "look again");
  assert_restored(edited);
  const compacted = await archived_chat("worked");
  await main.compact_turn(compacted);
  assert_restored(compacted);
});

test("a steer into a running turn of a chat archived meanwhile unarchives it", async () => {
  const meta: ChatMeta = await main.create_chat("");
  const started = await main.start_turn(send(meta.id, "work"), [], "user");
  await main.update_meta(meta.id, { archived: true });
  const accepted = await main.steer_turn(meta.id, "also this", [], "steer-1");
  assert.equal(accepted, started.message_id);
  assert_restored(meta.id);
});

test("a steer into an archived chat without a running turn is refused and leaves the chat archived", async () => {
  const chat_id = await archived_chat("worked");
  const announced = changed.length;
  const accepted = await main.steer_turn(chat_id, "also this", [], "steer-idle");
  assert.equal(accepted, null);
  assert.equal(main.chat_meta(chat_id)?.archived, true);
  assert.equal(changed.slice(announced).some((meta) => meta.id === chat_id && !meta.archived), false);
});

test("a turn that does not start leaves the chat archived", async () => {
  const chat_id = await archived_chat();
  await assert.rejects(main.start_turn(send(chat_id, "hello", "nobody/no-model"), [], "user"), /not in the catalog/);
  assert.equal(main.chat_meta(chat_id)?.archived, true);
});
