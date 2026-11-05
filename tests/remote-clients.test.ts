import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

const stubs: Record<string, string> = {
  electron: [
    "export const handlers = new Map();",
    "export const listeners = new Map();",
    "export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) };",
    "export const shell = { showItemInFolder: () => {} };",
    "export const app = { getAppPath: () => process.cwd(), getPath: () => process.cwd() };",
  ].join("\n"),
  window: "export const main_window = () => null;",
  git: "export const git_binds = []; export let git_stops = 0; export const git_service = { bind: (root) => { git_binds.push(root.path); return undefined; }, stop: () => { git_stops += 1; } };",
  project: [
    "export const watches = [];",
    "export const parse_scope = (value) => value;",
    "export const files_root = async (scope) => (scope.project_path ? { path: scope.project_path, name: scope.project_path, kind: 'project' } : null);",
    "export const require_root = async (scope) => files_root(scope);",
    "export const invalidate_index = () => {};",
    "export const find_files = async () => ({ paths: [], truncated: false });",
    "export const list_dir = async () => ({ path: '', entries: [], more: 0 });",
    "export const tree_path = (value) => value;",
    "export const resolve_inside = async (root, target) => ({ target });",
    "export const read_for_view = async () => ({ kind: 'missing', path: '' });",
    "export const watch_tree = (root) => { const entry = { root, closed: false, close() { entry.closed = true; } }; watches.push(entry); return entry; };",
  ].join("\n"),
  chats: "export const chat_meta = () => null; export const worktree_missing = (path) => new Error(`missing ${path}`);",
  pty: [
    "export const ptys = [];",
    "export const spawn_shell = (options) => {",
    "  const pty = { options, written: [], killed: false, data: [], exits: [],",
    "    write(data) { pty.written.push(data); }, resize() {}, kill() { pty.killed = true; },",
    "    on_data(listener) { pty.data.push(listener); }, on_exit(listener) { pty.exits.push(listener); } };",
    "  ptys.push(pty);",
    "  return pty;",
    "};",
  ].join("\n"),
  run: "export const started = []; export const start_internal_turn = async (chat_id, origin, text) => { started.push({ chat_id, origin, text }); return { user_message_id: 'u', message_id: 'm' }; };",
  manager: "export const result_was_read = () => false;",
  active: "export const user_stopped = () => false; export const is_active = () => false; export const has_steers = () => false;",
};

const routes: [RegExp, string][] = [
  [/^electron$/, "electron"],
  [/[\\/]app[\\/]window\.ts$/, "window"],
  [/[\\/]git[\\/]index\.ts$/, "git"],
  [/[\\/]project[\\/](files-root|index|listing|scope|view-read|watch)\.ts$/, "project"],
  [/[\\/]chats[\\/](store|workspace)\.ts$/, "chats"],
  [/[\\/]terminal[\\/]pty\.ts$/, "pty"],
  [/[\\/]turn[\\/]run\.ts$/, "run"],
  [/[\\/]background[\\/]manager\.ts$/, "manager"],
  [/[\\/]turn[\\/]active\.ts$/, "active"],
];

const client_stubs: Plugin = {
  name: "client-stubs",
  setup(builder) {
    for (const [filter, name] of routes) {
      builder.onResolve({ filter }, () => ({ path: name, namespace: "stub" }));
    }
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
  },
};

let vx: any;

const settle = () => new Promise((resolve) => setImmediate(resolve));

before(async () => {
  const result = await build({
    stdin: {
      contents: [
        'export * from "./electron/ipc/clients.ts";',
        'export { dispatch_invoke, dispatch_send, set_event_tap } from "./electron/ipc/handle.ts";',
        'export { newest_claim, register_files_ipc, stop_chat_files_watch } from "./electron/ipc/files.ts";',
        'export { register_terminal_ipc } from "./electron/ipc/terminal.ts";',
        'export { held_union, hold_events_for, notify_background_finished } from "./electron/app/notifications.ts";',
        'export { watches } from "./electron/project/watch.ts";',
        'export { git_binds } from "./electron/git/index.ts";',
        'export { ptys } from "./electron/terminal/pty.ts";',
        'export { started } from "./electron/turn/run.ts";',
      ].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [client_stubs],
    logLevel: "silent",
  });
  vx = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  vx.register_files_ipc();
  vx.register_terminal_ipc();
});

test("presence and gone listeners fire once per change and the window is always connected", (t) => {
  const error = t.mock.method(console, "error", () => {});
  const seen: string[] = [];
  vx.on_client_presence((client: string) => {
    if (client === "remote:s1.p1") {
      throw new Error("listener broke");
    }
  });
  vx.on_client_presence((client: string, connected: boolean) => seen.push(`${client}:${connected}`));
  vx.on_client_gone((client: string) => seen.push(`${client}:gone`));
  assert.equal(vx.client_connected("window"), true);
  vx.set_client_connected("window", false);
  assert.equal(vx.client_connected("window"), true);
  vx.set_client_connected("remote:s1.p1", true);
  vx.set_client_connected("remote:s1.p1", true);
  assert.equal(vx.client_connected("remote:s1.p1"), true);
  assert.deepEqual(vx.known_clients(), ["remote:s1.p1"]);
  vx.set_client_connected("remote:s1.p1", false);
  vx.client_gone("remote:s1.p1");
  assert.deepEqual(seen, ["remote:s1.p1:true", "remote:s1.p1:false", "remote:s1.p1:gone"]);
  assert.deepEqual(vx.known_clients(), []);
  assert.equal(error.mock.callCount(), 2);
  assert.match(String(error.mock.calls[0].arguments[0]), /presence listener \d+ failed for client remote:s1\.p1/);
});

test("remote client ids carry the session and parse back", () => {
  const client = vx.remote_client_id("S".repeat(22), "P".repeat(22));
  assert.equal(client, `remote:${"S".repeat(22)}.${"P".repeat(22)}`);
  assert.equal(vx.client_session(client), "S".repeat(22));
  assert.equal(vx.client_session("window"), null);
});

test("held chats are the union of every connected client's holds", () => {
  const holds: [string, string[]][] = [
    ["window", ["a"]],
    ["remote:s.p1", ["b", "a"]],
    ["remote:s.p2", ["c"]],
  ];
  const connected = (client: string) => client !== "remote:s.p2";
  assert.deepEqual([...vx.held_union(holds, connected)].sort(), ["a", "b"]);
  assert.deepEqual([...vx.held_union([], connected)], []);
});

const finished = (chat_id: string, id: string) => ({
  id,
  chat_id,
  name: "tests",
  command: "npm test",
  shell: "powershell",
  cwd: ".",
  status: "completed",
  exit_code: 0,
  started_at: "2026-10-15T10:00:00.000Z",
  ended_at: "2026-10-15T10:01:00.000Z",
  output_tail: "ok",
});

const output = { text: () => "ok", tail: () => "ok", chars: () => 2, lines: () => 1 };

test("a phone hold keeps a chat waiting until the phone disconnects or is gone", async () => {
  vx.started.length = 0;
  vx.set_client_connected("remote:h.p1", true);
  vx.hold_events_for("remote:h.p1", ["h1"]);
  vx.notify_background_finished(finished("h1", "t1"), output);
  await settle();
  assert.deepEqual(vx.started, []);
  vx.set_client_connected("remote:h.p1", false);
  await settle();
  assert.deepEqual(
    vx.started.map((entry: { chat_id: string }) => entry.chat_id),
    ["h1"],
  );
  vx.hold_events_for("remote:h.p2", ["h2"]);
  vx.set_client_connected("remote:h.p2", true);
  vx.notify_background_finished(finished("h2", "t2"), output);
  await settle();
  assert.equal(vx.started.length, 1);
  vx.client_gone("remote:h.p2");
  await settle();
  assert.deepEqual(
    vx.started.map((entry: { chat_id: string }) => entry.chat_id),
    ["h1", "h2"],
  );
  vx.set_client_connected("remote:h.p2", true);
  vx.notify_background_finished(finished("h2", "t3"), output);
  await settle();
  assert.equal(vx.started.length, 3);
  vx.client_gone("remote:h.p2");
});

test("the newest claim among connected clients wins", () => {
  const scope = (project_path: string) => ({ chat_id: null, project_path });
  const claims: [string, { scope: unknown; at: number }][] = [
    ["window", { scope: scope("A"), at: 1 }],
    ["remote:s.p1", { scope: scope("B"), at: 3 }],
    ["remote:s.p2", { scope: scope("C"), at: 5 }],
  ];
  assert.deepEqual(vx.newest_claim(claims, (client: string) => client !== "remote:s.p2")?.scope, scope("B"));
  assert.deepEqual(vx.newest_claim(claims, () => true)?.scope, scope("C"));
  assert.equal(vx.newest_claim([], () => true), null);
});

test("the files watch follows the newest viewer and falls back when it leaves", async () => {
  const roots = () => vx.watches.filter((entry: { closed: boolean }) => !entry.closed).map((entry: { root: string }) => entry.root);
  await vx.dispatch_invoke("window", "files:watch", [{ chat_id: "c1", project_path: "D:/pc" }]);
  assert.deepEqual(roots(), ["D:/pc"]);
  vx.set_client_connected("remote:f.p1", true);
  await vx.dispatch_invoke("remote:f.p1", "files:watch", [{ chat_id: "c2", project_path: "D:/phone" }]);
  assert.deepEqual(roots(), ["D:/phone"]);
  vx.set_client_connected("remote:f.p1", false);
  await settle();
  assert.deepEqual(roots(), ["D:/pc"]);
  vx.set_client_connected("remote:f.p1", true);
  await settle();
  assert.deepEqual(roots(), ["D:/phone"]);
  vx.client_gone("remote:f.p1");
  await settle();
  assert.deepEqual(roots(), ["D:/pc"]);
  vx.stop_chat_files_watch("c1");
  await settle();
  assert.deepEqual(roots(), []);
});

test("terminal output goes only to the client that opened it and others cannot drive it", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const tapped: { target: string | null; name: string; payload: { terminal_id: string; data?: string } }[] = [];
  vx.set_event_tap((target: string | null, name: string, payload: { terminal_id: string }) => tapped.push({ target, name, payload }));
  const owner = "remote:t.p1";
  const terminal_id = await vx.dispatch_invoke(owner, "terminal:create", [{ chat_id: null, project_path: "", cols: 80, rows: 24 }]);
  const pty = vx.ptys.at(-1);
  pty.data[0]("hello");
  assert.deepEqual(tapped, [{ target: owner, name: "terminal:data", payload: { terminal_id, data: "hello" } }]);
  vx.dispatch_send("remote:t.p2", "terminal:input", [terminal_id, "intruder"]);
  vx.dispatch_send("window", "terminal:input", [terminal_id, "window"]);
  vx.dispatch_send("remote:t.p2", "terminal:close", [terminal_id]);
  vx.dispatch_send(owner, "terminal:input", [terminal_id, "ls\r"]);
  assert.deepEqual(pty.written, ["ls\r"]);
  assert.equal(pty.killed, false);
  assert.equal(warn.mock.callCount(), 3);
  vx.client_gone(owner);
  assert.equal(pty.killed, true);
  vx.dispatch_send(owner, "terminal:input", [terminal_id, "late"]);
  assert.deepEqual(pty.written, ["ls\r"]);
  vx.set_event_tap(null);
});

test("a window terminal is driven by the window and its output stays off the tap", async () => {
  const tapped: string[] = [];
  vx.set_event_tap((target: string | null) => tapped.push(String(target)));
  const terminal_id = await vx.dispatch_invoke("window", "terminal:create", [{ chat_id: null, project_path: "", cols: 80, rows: 24 }]);
  const pty = vx.ptys.at(-1);
  pty.data[0]("prompt> ");
  vx.dispatch_send("window", "terminal:input", [terminal_id, "dir\r"]);
  assert.deepEqual(pty.written, ["dir\r"]);
  assert.deepEqual(tapped, []);
  vx.dispatch_send("window", "terminal:close", [terminal_id]);
  assert.equal(pty.killed, true);
  vx.set_event_tap(null);
});

test("dispatch refuses a channel without a handler", async () => {
  await assert.rejects(vx.dispatch_invoke("window", "chats:list", []), /no handler for chats:list/);
  assert.throws(() => vx.dispatch_send("window", "browser:viewport", [{}]), /no handler for browser:viewport/);
});
