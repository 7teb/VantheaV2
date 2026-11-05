import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;
let main: any;

const stub_path = path.resolve("tests/browser-electron-stub.ts");

const electron_stub: Plugin = { name: "electron-stub", setup: (build_api) => build_api.onResolve({ filter: /^electron$/ }, () => ({ path: stub_path })) };

const flushed = () => new Promise((resolve) => setImmediate(resolve));

const rect = { x: 100, y: 50, width: 640, height: 480 };

const shown_in_main = (tab: any) => tab.view.parent === main.contentView;

const parked = (tab: any) => tab.view.parent === tab.surface.contentView;

before(async () => {
  const entry = [
    'export * from "./electron/browser/tabs.ts";',
    'export { freeze_frame, init_dock, set_viewport, shown_tab } from "./electron/browser/dock.ts";',
    'export { FakeBrowserWindow } from "./tests/browser-electron-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  main = new browser.FakeBrowserWindow({ show: true });
  main.webContents.zoom = 1.25;
  browser.init_dock(main);
});

test("the dock shows the active tab of the viewport's chat, scaled to the window zoom", async () => {
  const mine = browser.open_user_tab("chat-a", "https://a.example/");
  const theirs = browser.open_user_tab("chat-b", "https://b.example/");
  await flushed();
  assert.equal(parked(mine), true);
  browser.set_viewport({ chat_id: "chat-a", rect, radius: 12 });
  assert.equal(shown_in_main(mine), true);
  assert.deepEqual(mine.view.bounds, { x: 125, y: 63, width: 800, height: 600 });
  assert.equal(mine.view.radius, 15);
  assert.equal(parked(theirs), true);
  assert.equal(browser.shown_tab(), mine);
});

test("switching chats swaps the shown page without reloading either page", () => {
  const mine = browser.active_tab("chat-a");
  const theirs = browser.active_tab("chat-b");
  browser.set_viewport({ chat_id: "chat-b", rect, radius: 12 });
  assert.equal(shown_in_main(theirs), true);
  assert.equal(parked(mine), true);
  assert.deepEqual(mine.surface.getContentSize(), [1280, 800]);
  assert.deepEqual(mine.view.bounds, { x: 0, y: 0, width: 1280, height: 800 });
  assert.equal(mine.view.radius, 0);
  assert.deepEqual(mine.guest.loads, ["https://a.example/"]);
  assert.deepEqual(theirs.guest.loads, ["https://b.example/"]);
  assert.equal(browser.is_open(mine), true);
});

test("closing the dock parks the page at the default tab size and keeps it running", () => {
  const theirs = browser.active_tab("chat-b");
  assert.deepEqual(theirs.view.bounds, { x: 125, y: 63, width: 800, height: 600 });
  browser.set_viewport({ chat_id: "chat-b", rect: null, radius: 0 });
  assert.equal(parked(theirs), true);
  assert.deepEqual(theirs.view.bounds, { x: 0, y: 0, width: 1280, height: 800 });
  assert.deepEqual(theirs.surface.getContentSize(), [1280, 800]);
  assert.equal(browser.is_open(theirs), true);
  assert.equal(theirs.guest.isDestroyed(), false);
  assert.equal(browser.shown_tab(), null);
});

test("a tab the agent opens or closes while the dock is open is followed live", async () => {
  const first = browser.active_tab("chat-a");
  browser.set_viewport({ chat_id: "chat-a", rect, radius: 12 });
  const opened = browser.open_user_tab("chat-a", "https://next.example/");
  await flushed();
  assert.equal(shown_in_main(opened), true);
  assert.equal(parked(first), true);
  browser.close_tab("chat-a", opened.tab_id);
  await flushed();
  assert.equal(opened.view.parent, null);
  assert.equal(shown_in_main(first), true);
});

test("a frozen frame exists only for the chat whose page is shown", async () => {
  assert.match(await browser.freeze_frame("chat-a"), /^data:image\/jpeg;base64,/);
  assert.equal(await browser.freeze_frame("chat-b"), null);
});

test("minimizing the window parks the shown page and restoring shows it again", () => {
  const first = browser.active_tab("chat-a");
  main.minimized = true;
  main.emit("minimize");
  assert.equal(parked(first), true);
  main.minimized = false;
  main.emit("restore");
  assert.equal(shown_in_main(first), true);
});

test("a reload of the app renderer takes the page out of the window", () => {
  const first = browser.active_tab("chat-a");
  main.webContents.emit("did-start-navigation", { isMainFrame: false });
  assert.equal(shown_in_main(first), true);
  main.webContents.emit("did-start-navigation", { isMainFrame: true });
  assert.equal(parked(first), true);
});

test("deleting the shown chat closes its tabs and leaves nothing in the window", async () => {
  const first = browser.active_tab("chat-a");
  browser.set_viewport({ chat_id: "chat-a", rect, radius: 12 });
  assert.equal(shown_in_main(first), true);
  browser.close_chat_tabs("chat-a");
  await flushed();
  assert.equal(main.contentView.children.length, 0);
  assert.equal(first.guest.isDestroyed(), true);
  assert.equal(browser.shown_tab(), null);
});

test("closing the main window closes every tab", async () => {
  const theirs = browser.active_tab("chat-b");
  browser.open_user_tab("", "about:blank");
  main.destroy();
  await flushed();
  assert.equal(theirs.guest.isDestroyed(), true);
  assert.equal(theirs.surface.isDestroyed(), true);
  assert.deepEqual([...browser.list_tabs("chat-b"), ...browser.list_tabs("")], []);
});
