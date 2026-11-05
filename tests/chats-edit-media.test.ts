import assert from "node:assert/strict";
import native_fs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { after, before, mock, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { assistant_message, chat_dirs_in, make_root, media_dirs_in, user_message } from "./fixtures/legacy/harness.ts";

let main: any;
let root = "";
let deliveries: any[] = [];
const emitted: any[] = [];
const stubs: Record<string, string> = {
  electron: 'export const app={getAppPath:()=>process.cwd(),getPath:()=>process.cwd()};export const ipcMain={handle(){},on(){}};export const Menu={};export const BrowserWindow=class{};export const shell={};export const nativeImage={};',
  drive: 'export const drive=async()=>{};',
  ipc: 'export const emit=(name,payload)=>globalThis.edit_review_emitted.push({name,payload});export const emit_to=emit;export const handle=()=>{};export const handle_client=()=>{};export const listen=()=>{};export const listen_client=()=>{};',
};
const plugin: Plugin = { name: "independent-edit-media", setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "review-stub" }));
  api.onResolve({ filter: /[\\/]drive\.ts$/ }, () => ({ path: "drive", namespace: "review-stub" }));
  api.onResolve({ filter: /[\\/]ipc[\\/]handle\.ts$/ }, () => ({ path: "ipc", namespace: "review-stub" }));
  api.onLoad({ filter: /.*/, namespace: "review-stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
} };

before(async () => {
  root = await make_root("vx-independent-edit-media-");
  Reflect.set(globalThis, "edit_review_emitted", emitted);
  const built = await build({ stdin: { contents: [
    'export {edit_turn,stop_turn} from "./electron/turn/run.ts";',
    'export {append_message,create_chat,fork_chat,flush_all_sync,flush_chat,get_chat,init_chats,update_message,update_meta} from "./electron/chats/store.ts";',
    'export {set_storage_root} from "./electron/storage/paths.ts";',
    'export {init_media} from "./electron/media/files.ts";',
    'export {refs} from "./electron/chats/state.ts";',
    'export {begin_load,finish_load,receive,empty_chat_view} from "./src/state/chat-view-reduce.ts";',
  ].join("\n"), resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [plugin], logLevel: "silent" });
  const bundle = path.join(root, "review.mjs");
  await fs.writeFile(bundle, built.outputFiles[0].contents);
  main = await import(pathToFileURL(bundle).href);
  main.set_storage_root(root);
  const media = media_dirs_in(root);
  await fs.mkdir(media.attachments, { recursive: true });
  await fs.mkdir(media.images, { recursive: true });
  main.init_media(media);
  await main.init_chats({ dirs: chat_dirs_in(root), legacy_root: path.join(root, "absent"), events: {
    changed: () => {}, removed: () => {}, questions: () => {},
    appended: (chat_id: string, message: unknown) => deliveries.push({ kind: "appended", chat_id, message }),
    truncated: (chat_id: string, message_id: string) => deliveries.push({ kind: "truncated", chat_id, message_id }),
  } });
});
after(async () => { mock.restoreAll(); main?.flush_all_sync(); if (root) await fs.rm(root, { recursive: true, force: true }); Reflect.deleteProperty(globalThis, "edit_review_emitted"); });

const disk = async (id: string) => JSON.parse(brotliDecompressSync(await fs.readFile(path.join(chat_dirs_in(root).data_dir, `${id}.vxc`))).toString());
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const seed = async () => {
  const chat = await main.create_chat("");
  const stamp = chat.id.slice(0, 8);
  const attachment = (name: string) => ({ id: `img_${stamp}_${name}.png`, kind: "image" as const, name, mime: "image/png", size: 1, width: 20, height: 10, vision_note: null, model: { id: `img_${stamp}_${name}copy.jpg`, width: 20, height: 10 } });
  const first = attachment("first");
  const second = attachment("second");
  const ids = [first.id, first.model.id, second.id, second.model.id];
  for (const id of ids) await fs.writeFile(path.join(media_dirs_in(root).attachments, id), "fixture");
  for (const message of [user_message("u1", "first", [first]), assistant_message("a1", "answer first"), user_message("u2", "second", [second]), assistant_message("a2", "answer second")]) await main.append_message(chat.id, message);
  await main.update_meta(chat.id, { choice: { model: "deepseek/deepseek-v4.1-flash-1017", effort: "", pro: false }, archived: true });
  await main.flush_chat(chat.id);
  deliveries = [];
  emitted.length = 0;
  return { chat, first, second, ids };
};

for (const target of ["u1", "u2"]) test(`edit ${target} preserves its attachment copies and renderer order after canonical commit`, async () => {
  const fixture = await seed();
  const before = await main.get_chat(fixture.chat.id);
  let ui = main.finish_load(main.begin_load(main.empty_chat_view, fixture.chat.id), fixture.chat.id, before);
  const started = await main.edit_turn(fixture.chat.id, target, "replacement");
  const after = await main.get_chat(fixture.chat.id);
  const stored = await disk(fixture.chat.id);
  assert.equal(stored.messages.at(-2).text, "replacement");
  assert.equal(stored.messages.at(-1).id, started.message_id);
  assert.deepEqual(stored.messages, after.messages);
  for (const delivery of deliveries) ui = main.receive(ui, [delivery]);
  for (const event of emitted.filter((entry) => entry.name === "chats:message_replaced")) ui = main.receive(ui, [{ kind: "replaced", chat_id: event.payload.chat_id, message: event.payload.message }]);
  assert.deepEqual(ui.entries[fixture.chat.id].chat.messages, after.messages);
  const retained = target === "u1" ? [fixture.first.id, fixture.first.model.id] : fixture.ids;
  for (const id of fixture.ids) assert.equal(await exists(path.join(media_dirs_in(root).attachments, id)), retained.includes(id), id);
  for (const id of retained) assert.equal(main.refs.get(id), 1);
  main.stop_turn(fixture.chat.id);
});

test("canonical rename failure retains all original history, attachment copies and references", async () => {
  const fixture = await seed();
  const before = await main.get_chat(fixture.chat.id);
  const file = path.join(chat_dirs_in(root).data_dir, `${fixture.chat.id}.vxc`);
  const bytes = await fs.readFile(file);
  const rename = native_fs.renameSync;
  const fault = mock.method(native_fs, "renameSync", (from: Parameters<typeof native_fs.renameSync>[0], to: Parameters<typeof native_fs.renameSync>[1]) => { if (String(to) === file) throw Object.assign(new Error("review canonical ENOSPC"), { code: "ENOSPC" }); return rename(from, to); });
  try {
    await assert.rejects(main.edit_turn(fixture.chat.id, "u1", "replacement"), /ENOSPC/);
    assert.deepEqual(await main.get_chat(fixture.chat.id), before);
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.deepEqual(deliveries, []);
    for (const id of fixture.ids) { assert.equal(await exists(path.join(media_dirs_in(root).attachments, id)), true); assert.equal(main.refs.get(id), 1); }
  } finally { fault.mock.restore(); }
});

test("editing a chat does not remove media still referenced by its fork", async () => {
  const fixture = await seed();
  const fork = await main.fork_chat(fixture.chat.id, "a2");
  await main.edit_turn(fixture.chat.id, "u1", "replacement");
  for (const id of fixture.ids) assert.equal(await exists(path.join(media_dirs_in(root).attachments, id)), true, id);
  assert.equal((await main.get_chat(fork.id)).messages.length, 4);
  assert.equal(main.refs.get(fixture.second.id), 1);
  main.stop_turn(fixture.chat.id);
});

test("a retained prefix update arriving during edit persistence is not overwritten", async () => {
  const fixture = await seed();
  const file = path.join(chat_dirs_in(root).data_dir, `${fixture.chat.id}.vxc`);
  let entered: () => void = () => {};
  let resume: () => void = () => {};
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  let paused = false;
  const write = fs.writeFile;
  const gate = mock.method(fs, "writeFile", async (target: Parameters<typeof fs.writeFile>[0], ...args: unknown[]) => {
    await Reflect.apply(write, fs, [target, ...args]);
    if (!paused && String(target).startsWith(file + ".") && String(target).endsWith(".tmp")) { paused = true; entered(); await released; }
  });
  try {
    const editing = main.edit_turn(fixture.chat.id, "u2", "replacement");
    await reached;
    main.update_message(fixture.chat.id, "a1", (message: any) => ({ ...message, steps: [{ id: "background", round: 0, kind: "text", text: "background update" }] }));
    resume();
    await editing;
    const after = await main.get_chat(fixture.chat.id);
    assert.equal(after.messages.find((message: any) => message.id === "a1").steps[0].text, "background update");
  } finally { resume(); gate.mock.restore(); main.stop_turn(fixture.chat.id); }
});
