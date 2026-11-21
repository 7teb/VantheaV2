import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

const stubs: Record<string, string> = {
  electron: "export const ipcMain = { handle: () => {}, on: () => {} };",
  window: "export const main_window = () => null;",
};

const tap_stubs: Plugin = {
  name: "tap-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]app[\\/]window\.ts$/ }, () => ({ path: "window", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
  },
};

let vx: any;

type Tapped = { target: string | null; name: string; payload: unknown };

before(async () => {
  const result = await build({
    stdin: {
      contents: ['export { add_event_tap, emit, emit_to } from "./electron/ipc/handle.ts";', 'export * from "./electron/ipc/clients.ts";'].join("\n"),
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [tap_stubs],
    logLevel: "silent",
  });
  vx = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

test("every tap receives each event, a throwing tap is logged and does not stop the others", (t) => {
  const error = t.mock.method(console, "error", () => {});
  const first: Tapped[] = [];
  const second: Tapped[] = [];
  const remove_first = vx.add_event_tap((target: string | null, name: string, payload: unknown) => first.push({ target, name, payload }));
  const remove_broken = vx.add_event_tap(() => {
    throw new Error("tap broke");
  });
  const remove_second = vx.add_event_tap((target: string | null, name: string, payload: unknown) => second.push({ target, name, payload }));
  vx.emit("chats:removed", { chat_id: "c1" });
  assert.deepEqual(first, [{ target: null, name: "chats:removed", payload: { chat_id: "c1" } }]);
  assert.deepEqual(second, first);
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0]?.arguments[0]), /forwarding chats:removed to every remote client failed/);
  remove_broken();
  vx.emit("chats:removed", { chat_id: "c2" });
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(error.mock.callCount(), 1);
  remove_first();
  remove_second();
});

test("a removed tap gets nothing more and removing one tap leaves the rest in place", () => {
  const seen: string[] = [];
  const remove_a = vx.add_event_tap((_target: string | null, name: string) => seen.push(`a:${name}`));
  const remove_b = vx.add_event_tap((_target: string | null, name: string) => seen.push(`b:${name}`));
  remove_a();
  remove_a();
  vx.emit("chats:removed", { chat_id: "c3" });
  assert.deepEqual(seen, ["b:chats:removed"]);
  remove_b();
  vx.emit("chats:removed", { chat_id: "c4" });
  assert.deepEqual(seen, ["b:chats:removed"]);
});

test("a tap added while an event is delivered starts with the next event", () => {
  const seen: string[] = [];
  let remove_late: () => void = () => {};
  const remove_adder = vx.add_event_tap(() => {
    remove_adder();
    remove_late = vx.add_event_tap((_target: string | null, _name: string, payload: { chat_id: string }) => seen.push(payload.chat_id));
  });
  vx.emit("chats:removed", { chat_id: "c5" });
  vx.emit("chats:removed", { chat_id: "c6" });
  assert.deepEqual(seen, ["c6"]);
  remove_late();
});

test("emit_to the window skips the taps and emit_to the api client reaches them with its target", () => {
  const seen: Tapped[] = [];
  const remove = vx.add_event_tap((target: string | null, name: string, payload: unknown) => seen.push({ target, name, payload }));
  vx.emit_to(vx.window_client, "chats:removed", { chat_id: "w" });
  vx.emit_to(vx.api_client, "chats:removed", { chat_id: "a" });
  assert.deepEqual(seen, [{ target: "api", name: "chats:removed", payload: { chat_id: "a" } }]);
  remove();
});

test("the api client is a non-window client that counts as connected only while marked so", () => {
  const presence: string[] = [];
  vx.on_client_presence((client: string, connected: boolean) => presence.push(`${client}:${connected}`));
  assert.equal(vx.api_client, "api");
  assert.equal(vx.client_connected(vx.api_client), false);
  vx.set_client_connected(vx.api_client, true);
  assert.equal(vx.client_connected(vx.api_client), true);
  assert.deepEqual(vx.known_clients(), []);
  assert.equal(vx.client_session(vx.api_client), null);
  assert.equal(vx.client_session(vx.window_client), null);
  assert.equal(vx.client_session(vx.remote_client_id("s1", "p1")), "s1");
  vx.set_client_connected(vx.api_client, false);
  assert.equal(vx.client_connected(vx.api_client), false);
  assert.deepEqual(presence, ["api:true", "api:false"]);
});
