import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import type { ChatWorktree } from "../shared/chat.ts";
import { assistant_message, chat_dirs_in, make_root, user_message } from "./fixtures/legacy/harness.ts";

let main: any;
let root = "";
const model = "deepseek/deepseek-v4.1-flash-1017";
const truncated: unknown[] = [];
const stubs: Record<string, string> = {
  electron: 'export const app={getAppPath:()=>process.cwd(),getPath:()=>process.cwd()};export const ipcMain={handle(){},on(){}};export const Menu={};export const BrowserWindow=class{};export const shell={};export const nativeImage={};',
  drive: 'export const drive=async()=>{};',
};
const plugin: Plugin = { name: "edit-preflight", setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "edit-stub" }));
  api.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "edit-stub" }));
  api.onLoad({ filter: /.*/, namespace: "edit-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
} };

before(async () => {
  const bundled = await build({ stdin: { contents: [
    'export {edit_turn} from "./electron/turn/run.ts";',
    'export {append_message,create_chat,flush_all_sync,flush_chat,get_chat,init_chats,update_meta} from "./electron/chats/store.ts";',
    'export {set_storage_root} from "./electron/storage/paths.ts";',
    'export {set_summary} from "./electron/chats/store.ts";',
  ].join("\n"), resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  main = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));
  root = await make_root("vx-edit-preflight-");
  main.set_storage_root(root);
  await main.init_chats({ dirs: chat_dirs_in(root), legacy_root: path.join(root, "absent"), events: { changed: () => {}, removed: () => {}, appended: () => {}, truncated: (...args: unknown[]) => truncated.push(args), questions: () => {} } });
});
after(async () => { main?.flush_all_sync(); if (root) await fs.rm(root, { recursive: true, force: true }); });

const seeded = async (worktree: ChatWorktree | null = null) => {
  const chat = await main.create_chat("", worktree);
  for (const message of [user_message("u1", "First"), assistant_message("a1", "Answer one"), user_message("u2", "Second"), assistant_message("a2", "Answer two")]) await main.append_message(chat.id, message);
  await main.set_summary(chat.id, { text: "Keep the summary", through_message_id: "a2" });
  await main.update_meta(chat.id, { choice: { model, effort: "", pro: false }, archived: true });
  await main.flush_chat(chat.id);
  return chat.id as string;
};

for (const target of ["u1", "u2"]) {
  for (const failure of ["missing model", "missing worktree"]) {
    test(`editing ${target} preserves memory and disk when startup rejects a ${failure}`, async () => {
      const worktree: ChatWorktree | null = failure === "missing worktree" ? { path: path.join(root, "missing-worktree"), prefix: "", branch: "vx/missing", base: "a".repeat(40), created_at: "2026-11-05T00:00:00.000Z" } : null;
      const id = await seeded(worktree);
      if (failure === "missing model") await main.update_meta(id, { choice: { model: "missing/model", effort: "", pro: false } });
      await main.flush_chat(id);
      const before = await main.get_chat(id);
      const file = path.join(chat_dirs_in(root).data_dir, `${id}.vxc`);
      const disk = await fs.readFile(file);
      const events = truncated.length;
      await assert.rejects(main.edit_turn(id, target, "Replacement"), failure === "missing model" ? /not in the catalog/ : /worktree.*missing|missing.*worktree/i);
      assert.deepEqual(await main.get_chat(id), before);
      assert.deepEqual(await fs.readFile(file), disk);
      assert.equal(truncated.length, events);
    });
  }
}
