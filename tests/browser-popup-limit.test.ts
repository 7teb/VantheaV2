import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { build, type Plugin } from "esbuild";

let browser: any;
const electron_stub: Plugin = { name: "browser-popup-stub", setup: (api) => api.onResolve({ filter: /^electron$/ }, () => ({ path: path.resolve("tests/browser-electron-stub.ts") })) };

before(async () => {
  const bundled = await build({ stdin: { contents: 'export * from "./electron/browser/tabs.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));
});

afterEach(async () => { browser.close_all_tabs(); await new Promise((resolve) => setImmediate(resolve)); });

test("page popups cannot allocate unbounded browser tabs", () => {
  const parent = browser.open_user_tab("popup-chat", "https://page.example/");
  for (let index = 0; index < 100; index += 1) assert.deepEqual(parent.guest.open_handler({ url: `https://popup.example/${index}` }), { action: "deny" });
  assert.ok(browser.chat_tabs("popup-chat").length <= 16);
  const child = browser.chat_tabs("popup-chat")[1];
  for (let index = 0; index < 50; index += 1) child.guest.open_handler({ url: `https://popup.example/child-${index}` });
  assert.ok(browser.chat_tabs("popup-chat").length <= 16);
});

test("a closed page cannot create more popup tabs", () => {
  const parent = browser.open_user_tab("closed-popup", "https://page.example/");
  const handler = parent.guest.open_handler;
  browser.close_chat_tabs("closed-popup");
  handler({ url: "https://popup.example/late" });
  assert.equal(browser.chat_tabs("closed-popup").length, 0);
});

test("popup capacity recovers after closing a tab and remains isolated per chat", () => {
  const first = browser.open_user_tab("first-popup", "https://page.example/");
  const second = browser.open_user_tab("second-popup", "https://page.example/");
  for (let index = 0; index < 30; index += 1) first.guest.open_handler({ url: `https://popup.example/${index}` });
  assert.equal(browser.chat_tabs("first-popup").length, 16);
  assert.equal(browser.chat_tabs("second-popup").length, 1);
  second.guest.open_handler({ url: "https://popup.example/other" });
  assert.equal(browser.chat_tabs("second-popup").length, 2);
  browser.close_tab("first-popup", browser.chat_tabs("first-popup")[1].tab_id);
  first.guest.open_handler({ url: "https://popup.example/replacement" });
  assert.equal(browser.chat_tabs("first-popup").length, 16);
  browser.adopt_tabs("first-popup", "adopted-popup");
  first.guest.open_handler({ url: "https://popup.example/after-adoption" });
  assert.equal(browser.chat_tabs("first-popup").length, 0);
  assert.equal(browser.chat_tabs("adopted-popup").length, 16);
});

test("invalid popup URLs and popup post bodies do not consume capacity", () => {
  const parent = browser.open_user_tab("filtered-popup", "https://page.example/");
  parent.guest.open_handler({ url: "javascript:alert(1)" });
  parent.guest.open_handler({ url: "file:///C:/Windows/system.ini" });
  parent.guest.open_handler({ url: "https://popup.example/", postBody: { data: [] } });
  assert.equal(browser.chat_tabs("filtered-popup").length, 1);
  parent.guest.open_handler({ url: "https://popup.example/allowed" });
  assert.equal(browser.chat_tabs("filtered-popup").length, 2);
});
