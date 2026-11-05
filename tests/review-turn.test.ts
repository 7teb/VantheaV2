import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { build, type Plugin } from "esbuild";
import type { UserMessage } from "../shared/chat.ts";
import { chat_dirs_in, make_root, read_disk_chat } from "./fixtures/legacy/harness.ts";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

const frame = {};

const contents = { mainFrame: frame, send: () => undefined };

Object.assign(globalThis, { review_turn_ipc: { handlers, window: { isDestroyed: () => false, webContents: contents } } });

const stubs: Record<string, string> = {
  electron:
    "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() }; export const ipcMain = { handle: (name, handler) => globalThis.review_turn_ipc.handlers.set(name, handler), on() {} }; export const Menu = {}; export const BrowserWindow = class {}; export const BaseWindow = class {}; export const WebContentsView = class {}; export const shell = {}; export const nativeImage = {}; export const dialog = {}; export const net = {}; export const powerSaveBlocker = {}; export const protocol = {}; export const safeStorage = {}; export const screen = {}; export const session = {}; export const webUtils = {};",
  window: "export const main_window = () => globalThis.review_turn_ipc.window; export const window_state = () => ({}); export const create_window = () => undefined;",
  drive: "export const drive = async () => {};",
  title: "export const start_title = () => {};",
};

const main_stubs: Plugin = {
  name: "review-turn-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]app[\\/]window\.ts$/ }, () => ({ path: "window", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]side[\\/]title\.ts$/ }, () => ({ path: "title", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

const exports = [
  'export { register_turn_ipc } from "./electron/ipc/turn.ts";',
  'export { create_chat, flush_all_sync, get_chat, init_chats } from "./electron/chats/store.ts";',
  'export { set_storage_root } from "./electron/storage/paths.ts";',
];

const trusted_event = { sender: contents, senderFrame: frame };

const call = (name: string, ...args: unknown[]) => {
  const handler = handlers.get(name);
  assert.ok(handler, `no handler for ${name}`);
  return handler(trusted_event, ...args);
};

let main: any;
let root = "";

const boot = () =>
  main.init_chats({
    dirs: chat_dirs_in(root),
    legacy_root: path.join(root, "no-legacy"),
    events: { changed: () => {}, removed: () => {}, appended: () => {}, truncated: () => {}, questions: () => {} },
  });

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
  root = await make_root("vx-review-turn-");
  main.set_storage_root(root);
  await boot();
  main.register_turn_ipc();
});

after(async () => {
  main?.flush_all_sync();
  await fs.rm(root, { recursive: true, force: true });
});

test("turn:init accepts a pull request number only for review and refuses every other argument", async (t: TestContext) => {
  t.mock.method(console, "error", () => {});
  const chat = await main.create_chat("");
  for (const value of ["abc", "-1", "0", "042", "1234567890", "4 2", 42, undefined]) {
    await assert.rejects(call("turn:init", chat.id, "review", value), /invalid argument for the review command turn/, String(value));
  }
  for (const command of ["init", "git_init"]) {
    await assert.rejects(call("turn:init", chat.id, command, "42"), new RegExp(`invalid argument for the ${command} command turn`));
  }
  await assert.rejects(call("turn:init", chat.id, "deploy", null), /unknown command turn deploy/);
  assert.equal((await main.get_chat(chat.id)).messages.length, 0);
});

test("a pull request review carries its number on the user message, which survives a save and a restart", async () => {
  const chat = await main.create_chat("");
  await call("turn:init", chat.id, "review", "42");
  const user = (await main.get_chat(chat.id)).messages.find((message: UserMessage) => message.role === "user");
  assert.equal(user.origin, "review");
  assert.equal(user.command_arg, "42");
  assert.match(user.text, /^Review pull request #42 with one independent reviewer/);
  assert.match(user.text, /its context window is [\d,]+ tokens, and the app compacts its conversation once it reaches [\d,]+ tokens/);
  main.flush_all_sync();
  const disk = await read_disk_chat(root, chat.id);
  assert.equal(disk.messages.find((message: UserMessage) => message.role === "user")?.command_arg, "42");
  await boot();
  const reloaded = (await main.get_chat(chat.id)).messages.find((message: UserMessage) => message.role === "user");
  assert.equal(reloaded.command_arg, "42");
});

test("a review of the current changes and an Initialize store no command argument", async () => {
  for (const [command, start] of [
    ["review", /^Review the current changes of this project/],
    ["init", /^Set up AGENTS\.md for this project/],
  ] as const) {
    const chat = await main.create_chat("");
    await call("turn:init", chat.id, command, null);
    const user = (await main.get_chat(chat.id)).messages.find((message: UserMessage) => message.role === "user");
    assert.equal(user.origin, command);
    assert.equal("command_arg" in user, false);
    assert.match(user.text, start);
  }
});
