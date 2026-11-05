import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import path from "node:path";
import type { Plugin } from "esbuild";
import type { FilesRoot, FilesScope } from "../shared/ipc/files.ts";
import { bundle, install_dom, type Vx } from "./dom-kit.ts";

const calls: { name: string; args: unknown[] }[] = [];
const project = "D:/project";
const parent: FilesRoot = { path: project, name: "project", kind: "project" };
const roots = new Map<string, FilesRoot>();
let client: any;
let restore = () => {};
let next_chat = "worktree-chat";
let hold_root = false;
let release_root: (() => void) | null = null;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const vx: Vx = {
  invoke: async (name, ...args) => {
    calls.push({ name, args });
    if (name === "worktrees:create_chat" || name === "chats:create") return { id: next_chat, project_path: project };
    if (name === "files:root") {
      const scope = args[0] as FilesScope;
      const root = scope.chat_id ? roots.get(scope.chat_id) ?? parent : parent;
      if (hold_root) { hold_root = false; await new Promise<void>((resolve) => { release_root = resolve; }); }
      return root;
    }
    if (name === "files:list") return { path: args[1], entries: [], more: 0 };
    if (name === "files:read") return { kind: "text", path: args[1], text: "parent contents", size: 15, truncated: false };
    if (name === "files:find") return { paths: ["parent.ts"], truncated: false };
    if (name === "git:write_message") return { kind: "text", text: "change" };
    return undefined;
  },
  on: () => () => {},
  send: () => {},
};

const stubs: Record<string, string> = {
  composer: 'import {create_store} from "./src/state/create-store.ts"; export const composer_store=create_store({drafts:{},queues:{},sending:{},errors:{},compacting:{}}); export const set_sending=(key,value)=>composer_store.update(state=>({...state,sending:{...state.sending,[key]:value}}));',
  terminal: 'export const adopt_terminals=()=>{};',
  "model-choice": 'export const take_new_chat_choice=()=>null; export const set_choice=async()=>{};',
  "chat-actions": 'export const init_turn=async()=>({ok:true});',
  worktree: 'export const clear_worktree_choice=()=>{}; export const worktree_choice=()=>true;',
};
const isolate: Plugin = {
  name: "chat-create-effects",
  setup: (builder) => {
    builder.onResolve({ filter: /\.ts$/ }, (args) => {
      const name = path.basename(args.path, ".ts");
      return path.basename(args.importer) === "chat-create.ts" && name in stubs ? { path: name, namespace: "chat-effect" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "chat-effect" }, (args) => ({ contents: stubs[args.path], loader: "ts", resolveDir: process.cwd() }));
  },
};

before(async () => {
  const dom = install_dom(vx);
  restore = dom.restore;
  client = await bundle([
    'export {create_chat} from "./src/state/chat-create.ts";',
    'export {files_store,init_files,open_file,set_query,shown_view,sync_files} from "./src/state/files.ts";',
    'export {git_store,init_git,set_surface} from "./src/state/git.ts";',
    'export {action_target,write_commit_message} from "./src/state/git-actions.ts";',
    'export {ui_store,start_new_chat,open_chat} from "./src/state/ui.ts";',
  ], [isolate]);
  client.init_files();
  client.init_git();
});
after(() => restore());
beforeEach(() => {
  calls.length = 0;
  roots.clear();
  client.files_store.set({ key: "new:D:/project", views: {} });
  client.git_store.set({ views: {}, ui: {}, readable: null });
  client.start_new_chat(project);
  hold_root = false;
  release_root = null;
});

const child_root = (id: string): FilesRoot => ({ path: `C:/worktrees/${id}/project`, name: "project", kind: "project", worktree: { branch: `vx/${id}`, missing: false } });
const shown = () => client.shown_view(client.files_store.get());

test("a newly created worktree resolves Files and Git to its own root before actions become available", async () => {
  next_chat = "worktree-fresh";
  roots.set(next_chat, child_root(next_chat));
  await client.sync_files();
  await client.open_file("parent.ts");
  client.set_surface("changes");
  const id = await client.create_chat(project, `new:${project}`, null, true);
  assert.equal(id, next_chat);
  assert.equal(client.action_target(), null);
  await client.sync_files();
  await settled();
  assert.equal(shown().root.root.path, child_root(next_chat).path);
  assert.deepEqual(shown().tabs, []);
  assert.equal(client.git_store.get().ui[next_chat], undefined);
  await client.write_commit_message();
  assert.deepEqual(client.action_target(), { root: child_root(next_chat).path, scope: { chat_id: next_chat, project_path: project } });
  assert.ok(calls.some((call) => call.name === "files:root" && (call.args[0] as FilesScope).chat_id === next_chat));
  assert.ok(calls.some((call) => call.name === "git:write_message" && (call.args[0] as FilesScope).chat_id === next_chat));
});

test("an ordinary new chat still adopts its project's open files and selected Git surface", async () => {
  next_chat = "ordinary-fresh";
  await client.sync_files();
  await client.open_file("parent.ts");
  client.set_surface("changes");
  calls.length = 0;
  await client.create_chat(project, `new:${project}`, null, false);
  await client.sync_files();
  assert.equal(shown().root.root.path, parent.path);
  assert.equal(shown().tabs[0].path, "parent.ts");
  assert.equal(client.git_store.get().ui[next_chat].surface, "changes");
  assert.equal(calls.some((call) => call.name === "files:root"), false);
});

test("a parent-root request completing after worktree creation cannot replace the child's root", async () => {
  next_chat = "worktree-parent-pending";
  roots.set(next_chat, child_root(next_chat));
  hold_root = true;
  const pending = client.sync_files();
  await settled();
  await client.create_chat(project, `new:${project}`, null, true);
  await client.sync_files();
  release_root?.();
  await pending;
  await settled();
  assert.equal(shown().root.root.path, child_root(next_chat).path);
  client.start_new_chat(project);
  await client.sync_files();
  assert.equal(shown().root.root.path, parent.path);
  client.open_chat(next_chat, project);
  assert.equal(shown().root.root.path, child_root(next_chat).path);
});

test("a child-root request completing while another project is shown stays in its child view", async () => {
  next_chat = "worktree-child-pending";
  roots.set(next_chat, child_root(next_chat));
  await client.sync_files();
  await client.create_chat(project, `new:${project}`, null, true);
  hold_root = true;
  const pending = client.sync_files();
  await settled();
  client.start_new_chat("D:/other-project");
  const shown_key = client.files_store.get().key;
  release_root?.();
  await pending;
  assert.equal(client.files_store.get().key, shown_key);
  assert.equal(client.action_target(), null);
  client.open_chat(next_chat, project);
  assert.equal(shown().root.root.path, child_root(next_chat).path);
});
