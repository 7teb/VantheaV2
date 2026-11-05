import assert from "node:assert/strict";
import native_fs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, mock, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { assistant_message, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

let main: any;
let root = "";
let published = false;
let index_file = "";
const stubs: Record<string, string> = {
  electron: 'export const app={getAppPath:()=>process.cwd(),getPath:()=>process.cwd()};export const ipcMain={handle(){},on(){}};export const Menu={};export const BrowserWindow=class{};export const shell={};export const nativeImage={};',
  drive: 'export const drive=async()=>{};',
};
const plugin: Plugin = { name: "chat-edit-stub", setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "review-stub" }));
  api.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "review-stub" }));
  api.onLoad({ filter: /.*/, namespace: "review-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
} };

before(async () => {
  root = await make_root("vx-chat-edit-");
  const bundled = await build({ stdin: { contents: [
    'export {edit_turn,stop_turn} from "./electron/turn/run.ts";',
    'export {append_message,create_chat,flush_all_sync,flush_chat,get_chat,init_chats,update_meta} from "./electron/chats/store.ts";',
    'export {set_storage_root} from "./electron/storage/paths.ts";',
  ].join("\n"), resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  const file = path.join(root, "review.mjs");
  await fs.writeFile(file, bundled.outputFiles[0].contents);
  main = await import(pathToFileURL(file).href);
  main.set_storage_root(root);
  index_file = chat_dirs_in(root).index_file;
  await main.init_chats({ dirs: chat_dirs_in(root), legacy_root: path.join(root, "absent"), events: { changed: () => {}, removed: () => {}, appended: () => {}, truncated: () => { published = true; }, questions: () => {} } });
});
after(async () => { mock.restoreAll(); main?.flush_all_sync(); if (root) await fs.rm(root, { recursive: true, force: true }); });

for (const target of ["u1", "u2"]) for (const fail_at of ["chat", "index"]) test(`editing ${target} commits history once when ${fail_at} persistence fails`, async () => {
  const chat = await main.create_chat("");
  for (const message of [user_message("u1", "First"), assistant_message("a1", "Answer one"), user_message("u2", "Second"), assistant_message("a2", "Answer two")]) await main.append_message(chat.id, message);
  await main.update_meta(chat.id, { choice: { model: "deepseek/deepseek-v4.1-flash-1017", effort: "", pro: false }, archived: true });
  await main.flush_chat(chat.id);
  const before = await main.get_chat(chat.id);
  const file = path.join(chat_dirs_in(root).data_dir, `${chat.id}.vxc`);
  const bytes = await fs.readFile(file);
  published = false;
  const rename = native_fs.renameSync;
  let failed = false;
  const fault = mock.method(native_fs, "renameSync", (from: Parameters<typeof native_fs.renameSync>[0], to: Parameters<typeof native_fs.renameSync>[1]) => {
    if (!failed && String(to) === (fail_at === "chat" ? file : index_file)) {
      failed = true;
      throw Object.assign(new Error("independent fixture disk-full failure"), { code: "ENOSPC" });
    }
    return rename(from, to);
  });
  try {
    if (fail_at === "chat") {
      await assert.rejects(main.edit_turn(chat.id, target, "Replacement"), /disk-full failure/);
      assert.deepEqual(await main.get_chat(chat.id), before);
      assert.deepEqual(await fs.readFile(file), bytes);
      assert.equal(published, false);
    } else {
      const started = await main.edit_turn(chat.id, target, "Replacement");
      const edited = await main.get_chat(chat.id);
      assert.equal(edited.messages.at(-2).text, "Replacement");
      assert.equal(edited.messages.at(-1).id, started.message_id);
      assert.equal(edited.messages.length, target === "u1" ? 2 : 4);
      assert.equal(edited.archived, undefined);
      assert.equal(published, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(failed, true);
      main.stop_turn(chat.id);
    }
  } finally { fault.mock.restore(); published = false; }
});
