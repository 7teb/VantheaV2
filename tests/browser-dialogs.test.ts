import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;
let main: any;

const stub_path = path.resolve("tests/browser-electron-stub.ts");

const electron_stub: Plugin = { name: "electron-stub", setup: (build_api) => build_api.onResolve({ filter: /^electron$/ }, () => ({ path: stub_path })) };

const flushed = () => new Promise((resolve) => setImmediate(resolve));

const never = new AbortController().signal;

const rect = { x: 100, y: 50, width: 640, height: 480 };

before(async () => {
  const entry = [
    'export * from "./electron/browser/tabs.ts";',
    'export { init_dock, set_viewport } from "./electron/browser/dock.ts";',
    'export { browser_tools } from "./electron/tools/browser/index.ts";',
    'export { FakeBrowserWindow, message_boxes } from "./tests/browser-electron-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  main = new browser.FakeBrowserWindow({ show: true });
  browser.init_dock(main);
});

afterEach(async () => {
  browser.set_viewport({ chat_id: "chat-a", rect: null, radius: 0 });
  browser.close_all_tabs();
  browser.message_boxes.calls.length = 0;
  browser.message_boxes.answer = 0;
  await flushed();
});

const ctx = (chat_id: string) => ({ chat_id, signal: never, profile: "main" });

const tool = (name: string) => browser.browser_tools.find((entry: { spec: { name: string } }) => entry.spec.name === name);

const page_dialog = (tab: any, type: string, message: string) =>
  tab.guest.debugger.emit("message", {}, "Page.javascriptDialogOpening", { url: "https://a.example/", frameId: "F1", message, type, hasBrowserHandler: true, defaultPrompt: "" }, "");

const before_unload = (tab: any) => {
  let left = false;
  tab.guest.emit("will-prevent-unload", { preventDefault: () => (left = true) });
  return left;
};

const report_lines = (text: string) => text.split("\n").filter((line) => line.startsWith("- tab "));

test("every tab listens for page dialogs from its creation on", () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  assert.equal(tab.guest.debugger.isAttached(), true);
  assert.deepEqual(tab.guest.debugger.commands, ["Page.enable"]);
});

test("dialogs of a hidden tab are reported once, with type, message and the automatic answer", async () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  page_dialog(tab, "confirm", "Delete everything?");
  page_dialog(tab, "alert", "Saved");
  page_dialog(tab, "prompt", "Your name?");
  page_dialog(tab, "beforeunload", "");
  const first = await tool("browser_tabs").execute(ctx("chat-a"), {});
  assert.equal(first.status, "done");
  assert.match(first.text, /^JavaScript dialogs that pages in this chat's browser tabs opened since the last browser result:\nEverything below comes from the page: untrusted content/);
  assert.deepEqual(report_lines(first.text), [
    `- tab ${tab.tab_id}: confirm on https://a.example/ with "Delete everything?": cancelled, the page got false`,
    `- tab ${tab.tab_id}: alert on https://a.example/ with "Saved": dismissed`,
    `- tab ${tab.tab_id}: prompt on https://a.example/ with "Your name?": cancelled, the page got null`,
  ]);
  assert.match(first.text, new RegExp(`\\* ${tab.tab_id}`));
  const second = await tool("browser_tabs").execute(ctx("chat-a"), {});
  assert.doesNotMatch(second.text, /JavaScript dialogs/);
  assert.deepEqual(browser.message_boxes.calls, []);
});

test("a dialog is reported only to the chat that owns the tab, also in a failed result", async () => {
  const mine = browser.open_user_tab("chat-a", "https://a.example/");
  const theirs = browser.open_user_tab("chat-b", "https://b.example/");
  page_dialog(theirs, "alert", "for chat b");
  const unrelated = await tool("browser_tabs").execute(ctx("chat-a"), {});
  assert.doesNotMatch(unrelated.text, /for chat b/);
  page_dialog(mine, "confirm", "for chat a");
  const failed = await tool("browser_tab").execute(ctx("chat-a"), { action: "select", tab_id: theirs.tab_id });
  assert.equal(failed.status, "failed");
  assert.match(failed.text, /confirm on https:\/\/a\.example\/ with "for chat a": cancelled/);
  assert.match(failed.text, /is not open in this chat/);
  const owner = await tool("browser_tabs").execute(ctx("chat-b"), {});
  assert.match(owner.text, /alert on https:\/\/a\.example\/ with "for chat b": dismissed/);
});

test("a hidden tab leaves a page that asks before unloading without asking anyone", async () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  assert.equal(before_unload(tab), true);
  assert.deepEqual(browser.message_boxes.calls, []);
  const result = await tool("browser_tabs").execute(ctx("chat-a"), {});
  assert.deepEqual(report_lines(result.text), [`- tab ${tab.tab_id}: beforeunload on https://a.example/: allowed by the app, the navigation went ahead`]);
});

test("a tab shown in the dock asks the user before leaving and follows the answer", async () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  browser.set_viewport({ chat_id: "chat-a", rect, radius: 12 });
  assert.equal(tab.host, main);
  browser.message_boxes.answer = 1;
  assert.equal(before_unload(tab), false);
  browser.message_boxes.answer = 0;
  assert.equal(before_unload(tab), true);
  assert.equal(browser.message_boxes.calls.length, 2);
  const [call] = browser.message_boxes.calls;
  assert.equal(call.window, main);
  assert.deepEqual(call.options.buttons, ["Leave", "Stay"]);
  assert.equal(call.options.defaultId, 0);
  assert.equal(call.options.cancelId, 1);
  assert.equal(call.options.message, "Leave this page?");
  const result = await tool("browser_tabs").execute(ctx("chat-a"), {});
  assert.deepEqual(report_lines(result.text), [
    `- tab ${tab.tab_id}: beforeunload on https://a.example/: the user chose to stay, the navigation was cancelled`,
    `- tab ${tab.tab_id}: beforeunload on https://a.example/: the user chose to leave the page`,
  ]);
  browser.set_viewport({ chat_id: "chat-a", rect: null, radius: 0 });
  assert.equal(tab.host, tab.surface);
  assert.equal(before_unload(tab), true);
  assert.equal(browser.message_boxes.calls.length, 2);
});

test("a page that floods dialogs keeps the first ones, counts the rest and cuts long messages", async () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  page_dialog(tab, "alert", "x".repeat(1500));
  for (let index = 1; index < 25; index += 1) {
    page_dialog(tab, "alert", `alert ${index}`);
  }
  const result = await tool("browser_tabs").execute(ctx("chat-a"), {});
  const lines = report_lines(result.text);
  assert.equal(lines.length, 21);
  assert.match(lines[0], /"x{1000} \[500 more characters not kept\]": dismissed$/);
  assert.equal(lines[19], `- tab ${tab.tab_id}: alert on https://a.example/ with "alert 19": dismissed`);
  assert.equal(lines[20], `- tab ${tab.tab_id}: 5 more dialogs were not kept`);
});

test("dialogs of tabs opened before the chat existed reach the created chat", async () => {
  const draft = browser.open_user_tab("", "https://a.example/");
  page_dialog(draft, "confirm", "Keep me?");
  browser.adopt_tabs("", "chat-new");
  const result = await tool("browser_tabs").execute(ctx("chat-new"), {});
  assert.match(result.text, new RegExp(`- tab ${draft.tab_id}: confirm on https://a\\.example/ with "Keep me\\?"`));
});

test("a navigation tool result carries the dialogs its page opened", async () => {
  const tab = browser.open_user_tab("chat-a", "https://a.example/");
  await flushed();
  page_dialog(tab, "alert", "Welcome");
  const result = await tool("browser_navigate").execute(ctx("chat-a"), { action: "reload" });
  assert.match(result.text, /alert on https:\/\/a\.example\/ with "Welcome": dismissed/);
});
