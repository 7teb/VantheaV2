import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;

const stub_path = path.resolve("tests/browser-electron-stub.ts");

const electron_stub: Plugin = { name: "electron-stub", setup: (build_api) => build_api.onResolve({ filter: /^electron$/ }, () => ({ path: stub_path })) };

const flushed = () => new Promise((resolve) => setImmediate(resolve));

const never = new AbortController().signal;

before(async () => {
  const entry = [
    'export * from "./electron/browser/tabs.ts";',
    'export { offscreen_origin } from "./electron/browser/surface.ts";',
    'export { browser_tools } from "./electron/tools/browser/index.ts";',
    'export { set_vision_analyzer, visual_tab_id } from "./electron/browser/vision.ts";',
    'export { created } from "./tests/browser-electron-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

afterEach(async () => {
  browser.close_all_tabs();
  await flushed();
});

const ids = (chat_id: string) => browser.list_tabs(chat_id).map((tab: { tab_id: string }) => tab.tab_id);

const tool = (name: string) => browser.browser_tools.find((entry: { spec: { name: string } }) => entry.spec.name === name);

const field = (text: string, name: string) => text.match(new RegExp(`^${name}: (\\S+)$`, "m"))?.[1] ?? "";

test("a chat lists, drives, selects and closes only its own tabs", async () => {
  const mine = browser.open_user_tab("chat-a", "https://a.example/");
  const theirs = browser.open_user_tab("chat-b", "https://b.example/");
  assert.deepEqual(ids("chat-a"), [mine.tab_id]);
  assert.deepEqual(ids("chat-b"), [theirs.tab_id]);
  assert.throws(() => browser.owned_tab("chat-a", theirs.tab_id), /is not open in this chat/);
  assert.throws(() => browser.run_on_tab("chat-a", theirs.tab_id, never, async () => "used"), /is not open in this chat/);
  assert.throws(() => browser.select_tab("chat-a", theirs.tab_id), /is not open in this chat/);
  assert.throws(() => browser.close_tab("chat-a", theirs.tab_id), /is not open in this chat/);
  assert.throws(() => browser.load_url("chat-a", theirs.tab_id, "https://evil.example/"), /is not open in this chat/);
  assert.equal(browser.is_open(theirs), true);
  assert.deepEqual(theirs.guest.loads, ["https://b.example/"]);
  assert.equal(await browser.run_on_tab("chat-b", theirs.tab_id, never, async (tab: { tab_id: string }) => tab.tab_id), theirs.tab_id);
});

test("without a tab id a chat falls back to its own active tab, never to another chat's", () => {
  const first = browser.open_user_tab("chat-a", "about:blank");
  const second = browser.open_user_tab("chat-a", "about:blank");
  browser.open_user_tab("chat-b", "about:blank");
  assert.equal(browser.owned_tab("chat-a", null), second);
  browser.select_tab("chat-a", first.tab_id);
  assert.equal(browser.owned_tab("chat-a", null), first);
  assert.throws(() => browser.owned_tab("chat-c", null), /This chat has no open browser tab/);
  assert.deepEqual(
    browser.list_tabs("chat-a").map((tab: { active: boolean }) => tab.active),
    [true, false],
  );
});

test("every tab renders in its own hidden offscreen surface that never takes focus", () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  const surface = tab.surface;
  assert.equal(surface.options.show, false);
  assert.equal(surface.options.focusable, false);
  assert.equal(surface.options.skipTaskbar, true);
  assert.equal(surface.visible, true);
  assert.equal(surface.opacity, 0);
  assert.equal(surface.ignores_mouse, true);
  assert.ok(surface.bounds.x + surface.bounds.width < -1920, `surface at x ${surface.bounds.x} overlaps a display`);
  assert.equal(surface.contentView.children[0], tab.view);
  assert.equal(tab.view.options.webPreferences.backgroundThrottling, false);
  assert.equal(tab.view.options.webPreferences.sandbox, true);
  assert.equal(tab.guest.isFocused(), false);
  const other = browser.open_user_tab("chat-a", "https://b.example/");
  assert.notEqual(other.surface, surface);
});

test("the offscreen origin lies left of every display", () => {
  assert.deepEqual(browser.offscreen_origin([{ x: -1920, y: 0 }, { x: 0, y: -300 }]), { x: -11920, y: -300 });
  assert.deepEqual(browser.offscreen_origin([]), { x: -10000, y: 0 });
});

test("closing the active tab activates its neighbour in the same chat", () => {
  const first = browser.open_user_tab("chat-a", "about:blank");
  const second = browser.open_user_tab("chat-a", "about:blank");
  const third = browser.open_user_tab("chat-a", "about:blank");
  browser.select_tab("chat-a", second.tab_id);
  browser.close_tab("chat-a", second.tab_id);
  assert.equal(browser.active_tab("chat-a"), third);
  browser.close_tab("chat-a", third.tab_id);
  assert.equal(browser.active_tab("chat-a"), first);
  browser.close_tab("chat-a", first.tab_id);
  assert.equal(browser.active_tab("chat-a"), null);
  assert.deepEqual(browser.chat_state("chat-a"), { chat_id: "chat-a", tabs: [], active_id: "" });
});

test("deleting a chat closes its pages and surfaces and leaves other chats running", () => {
  const doomed = [browser.open_user_tab("chat-a", "about:blank"), browser.open_user_tab("chat-a", "about:blank")];
  doomed[0].guest.debugger.attach();
  const survivor = browser.open_user_tab("chat-b", "about:blank");
  browser.close_chat_tabs("chat-a");
  for (const tab of doomed) {
    assert.equal(tab.guest.isDestroyed(), true);
    assert.equal(tab.surface.isDestroyed(), true);
    assert.equal(tab.view.parent, null);
    assert.equal(browser.is_open(tab), false);
  }
  assert.equal(doomed[0].guest.debugger.isAttached(), false);
  assert.deepEqual(ids("chat-a"), []);
  assert.equal(survivor.guest.isDestroyed(), false);
  assert.equal(survivor.surface.isDestroyed(), false);
  assert.deepEqual(ids("chat-b"), [survivor.tab_id]);
});

test("quitting closes every tab and destroys every surface", () => {
  const before_count = browser.created.windows.length;
  const tabs = [browser.open_user_tab("chat-a", "about:blank"), browser.open_user_tab("chat-b", "about:blank"), browser.open_user_tab("", "about:blank")];
  browser.close_all_tabs();
  assert.equal(tabs.every((tab) => tab.guest.isDestroyed() && tab.surface.isDestroyed()), true);
  assert.equal(browser.created.windows.slice(before_count).every((window: { destroyed: boolean }) => window.destroyed), true);
  assert.deepEqual([...ids("chat-a"), ...ids("chat-b"), ...ids("")], []);
});

test("a page destroyed from outside leaves no tab behind", () => {
  const tab = browser.open_user_tab("chat-a", "about:blank");
  tab.guest.close();
  assert.equal(browser.is_open(tab), false);
  assert.equal(tab.surface.isDestroyed(), true);
  assert.deepEqual(ids("chat-a"), []);
});

test("a popup opens as a new active tab of the opener's chat", () => {
  const opener = browser.open_user_tab("chat-a", "https://a.example/");
  assert.deepEqual(opener.guest.open_handler({ url: "https://popup.example/" }), { action: "deny" });
  const popup = browser.active_tab("chat-a");
  assert.notEqual(popup, opener);
  assert.deepEqual(popup.guest.loads, ["https://popup.example/"]);
  opener.guest.open_handler({ url: "file:///C:/secret.txt" });
  assert.equal(ids("chat-a").length, 2);
  assert.deepEqual(ids("chat-b"), []);
});

test("tabs opened before the chat existed move to the new chat", () => {
  const draft = browser.open_user_tab("", "https://draft.example/");
  browser.adopt_tabs("", "chat-new");
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("chat-new"), [draft.tab_id]);
  assert.equal(browser.active_tab("chat-new"), draft);
  assert.equal(browser.owned_tab("chat-new", null), draft);
  assert.throws(() => browser.owned_tab("", draft.tab_id), /is not open in this chat/);
});

test("an agent tab waits for its first page and reports changes per chat", async () => {
  const changes: string[] = [];
  const stop = browser.on_tabs_changed(() => changes.push("changed"));
  const tab = await browser.open_tab("chat-a", "https://a.example/", never);
  await flushed();
  stop();
  assert.equal(tab.guest.url, "https://a.example/");
  assert.equal(changes.length, 1);
  assert.equal(browser.chat_state("chat-a").tabs[0].url, "https://a.example/");
  assert.equal(browser.chat_state("chat-b").tabs.length, 0);
});

test("browser tools of one chat never see or touch another chat's tabs", async () => {
  const theirs = browser.open_user_tab("chat-b", "https://b.example/");
  const ctx = { chat_id: "chat-a", signal: never, profile: "main" };
  assert.match((await tool("browser_tabs").execute(ctx, {})).text, /This chat has no open browser tabs/);
  for (const [name, args] of [
    ["browser_tab", { action: "select", tab_id: theirs.tab_id }],
    ["browser_tab", { action: "close", tab_id: theirs.tab_id }],
    ["browser_navigate", { action: "reload", tab_id: theirs.tab_id }],
    ["browser_console", { tab_id: theirs.tab_id }],
  ] as const) {
    const result = await tool(name).execute(ctx, args);
    assert.equal(result.status, "failed", name);
    assert.match(result.text, /is not open in this chat/, name);
  }
  assert.equal(browser.is_open(theirs), true);
  assert.deepEqual(theirs.guest.loads, ["https://b.example/"]);
  const opened = await tool("browser_tab").execute(ctx, { action: "new", url: "https://a.example/" });
  assert.equal(opened.status, "done");
  assert.deepEqual(ids("chat-b"), [theirs.tab_id]);
  assert.equal(ids("chat-a").length, 1);
  assert.doesNotMatch((await tool("browser_tabs").execute({ ...ctx, chat_id: "chat-b" }, {})).text, /a\.example/);
});

test("a tool aimed at another tab makes it the chat's active tab, so calls without a tab id follow it", async () => {
  const first = browser.open_user_tab("chat-a", "https://a.example/");
  const second = browser.open_user_tab("chat-a", "https://b.example/");
  browser.select_tab("chat-a", first.tab_id);
  await flushed();
  const ctx = { chat_id: "chat-a", signal: never, profile: "main" };
  const snapshot = await tool("browser_snapshot").execute(ctx, { tab_id: second.tab_id });
  assert.equal(snapshot.status, "done", snapshot.text);
  assert.equal(field(snapshot.text, "tab_id"), second.tab_id);
  assert.equal(browser.active_tab("chat-a"), second);
  assert.equal(browser.chat_state("chat-a").active_id, second.tab_id);
  first.guest.debugger.commands.length = 0;
  second.guest.debugger.commands.length = 0;
  const key = await tool("browser_key").execute(ctx, { key: "Enter" });
  assert.equal(key.status, "done", key.text);
  assert.match(key.text, new RegExp(`in tab ${second.tab_id}`));
  assert.ok(second.guest.debugger.commands.includes("Input.dispatchKeyEvent"));
  assert.deepEqual(first.guest.debugger.commands, []);
  assert.equal(browser.active_tab("chat-a"), second);
});

test("a visual click runs on the tab its screenshot came from, even after another tab became active", async () => {
  browser.set_vision_analyzer(async () => ({ text: JSON.stringify({ summary: "a page", text: [], regions: [{ label: "Buy", box: [100, 100, 200, 300], confidence: 0.9 }] }), finish_reason: "stop" }));
  const first = browser.open_user_tab("chat-a", "https://a.example/");
  const second = browser.open_user_tab("chat-a", "https://b.example/");
  browser.select_tab("chat-a", first.tab_id);
  const ctx = { chat_id: "chat-a", signal: never, profile: "main" };
  const analyzed = await tool("browser_visual_analyze").execute(ctx, { question: "where is Buy", tab_id: second.tab_id });
  assert.equal(analyzed.status, "done", analyzed.text);
  const screenshot_id = field(analyzed.text, "screenshot_id");
  assert.equal(browser.visual_tab_id(screenshot_id), second.tab_id);
  assert.equal(browser.active_tab("chat-a"), second);
  browser.select_tab("chat-a", first.tab_id);
  first.guest.debugger.commands.length = 0;
  second.guest.debugger.commands.length = 0;
  const clicked = await tool("browser_visual_click").execute(ctx, { screenshot_id, ref: "v1" });
  assert.equal(clicked.status, "done", clicked.text);
  assert.match(clicked.text, new RegExp(`in tab ${second.tab_id}`));
  assert.ok(second.guest.debugger.commands.includes("Input.dispatchMouseEvent"));
  assert.deepEqual(first.guest.debugger.commands, []);
  assert.equal(browser.active_tab("chat-a"), second);
  assert.equal(browser.visual_tab_id("v1"), "");
  const other_chat = await tool("browser_visual_click").execute({ ...ctx, chat_id: "chat-b" }, { screenshot_id, ref: "v1" });
  assert.equal(other_chat.status, "failed");
  assert.match(other_chat.text, /is not open in this chat/);
});
