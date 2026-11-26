import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;

const events: { name: string; payload: any }[] = [];

const stub_path = path.resolve("tests/browser-electron-stub.ts");

const electron_stub: Plugin = { name: "electron-stub", setup: (build_api) => build_api.onResolve({ filter: /^electron$/ }, () => ({ path: stub_path })) };

const flushed = () => new Promise((resolve) => setImmediate(resolve));

const never = new AbortController().signal;

const ctx = { chat_id: "chat-s", signal: never, profile: "main" };

before(async () => {
  const entry = [
    'export * from "./electron/browser/tabs.ts";',
    'export { browser_tools } from "./electron/tools/browser/index.ts";',
    'export { add_event_tap } from "./electron/ipc/handle.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  browser.add_event_tap((_target: unknown, name: string, payload: unknown) => events.push({ name, payload }));
});

afterEach(async () => {
  browser.close_all_tabs();
  await flushed();
  events.length = 0;
});

const tab_tool = () => browser.browser_tools.find((entry: { spec: { name: string } }) => entry.spec.name === "browser_tab");

const shows = () => events.filter((event) => event.name === "browser:show");

const assert_shown_after_update = (tab_id: string) => {
  const index = events.findIndex((event) => event.name === "browser:show");
  assert.deepEqual(events[index].payload, { chat_id: "chat-s" });
  assert.equal(events[index - 1].name, "browser:changed");
  assert.equal(events[index - 1].payload.chat_id, "chat-s");
  assert.equal(events[index - 1].payload.active_id, tab_id);
};

test("a new tab stays in the background unless show is set, and a shown tab reaches the window after its tab update", async () => {
  const hidden = await tab_tool().execute(ctx, { action: "new", url: "https://a.example/" });
  await flushed();
  assert.equal(hidden.status, "done");
  assert.doesNotMatch(hidden.text, /browser panel/);
  assert.equal(shows().length, 0);
  const shown = await tab_tool().execute(ctx, { action: "new", url: "https://b.example/", show: true });
  await flushed();
  assert.equal(shown.status, "done");
  assert.match(shown.text, /The browser panel opens on it for the user in this chat\./);
  assert.equal(shows().length, 1);
  const tabs = browser.list_tabs("chat-s");
  assert.equal(tabs.length, 2);
  assert_shown_after_update(tabs[1].tab_id);
});

test("select with show opens the panel on that tab, close refuses show and show must be a boolean", async () => {
  const first = browser.open_user_tab("chat-s", "https://a.example/");
  browser.open_user_tab("chat-s", "https://b.example/");
  await flushed();
  events.length = 0;
  const plain = await tab_tool().execute(ctx, { action: "select", tab_id: first.tab_id });
  await flushed();
  assert.equal(plain.status, "done");
  assert.equal(shows().length, 0);
  const selected = await tab_tool().execute(ctx, { action: "select", tab_id: first.tab_id, show: true });
  await flushed();
  assert.equal(selected.status, "done");
  assert.match(selected.text, /browser panel opens on it/);
  assert.equal(shows().length, 1);
  assert_shown_after_update(first.tab_id);
  events.length = 0;
  assert.throws(() => tab_tool().execute(ctx, { action: "close", tab_id: first.tab_id, show: true }), /show applies only to new and select/);
  assert.throws(() => tab_tool().execute(ctx, { action: "select", show: "yes" }), /show must be a boolean/);
  await flushed();
  assert.equal(browser.is_open(first), true);
  assert.equal(shows().length, 0);
});
