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
  const entry = ['export * from "./electron/browser/tabs.ts";', 'export { sessions } from "./tests/browser-electron-stub.ts";'].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [electron_stub] });
  browser = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

afterEach(async () => {
  browser.close_all_tabs();
  await flushed();
});

const partition_of = (tab: any): string => tab.view.options.webPreferences.partition;

const session_of = (tab: any) => browser.sessions.get(partition_of(tab));

const wipes = (tab: any) => session_of(tab).wipes;

test("every chat browses in its own in-memory profile, created with the chat's first tab", () => {
  assert.equal(browser.sessions.has("vx-browser-chat-chat-a"), false);
  const first = browser.open_user_tab("chat-a", "https://a.example/");
  const second = browser.open_user_tab("chat-a", "https://a.example/two");
  const other = browser.open_user_tab("chat-b", "https://b.example/");
  assert.equal(partition_of(first), "vx-browser-chat-chat-a");
  assert.equal(partition_of(second), partition_of(first));
  assert.equal(partition_of(other), "vx-browser-chat-chat-b");
  assert.notEqual(session_of(first), session_of(other));
  assert.equal(first.partition, partition_of(first));
  assert.equal(partition_of(first).startsWith("persist:"), false);
  assert.equal(session_of(first).secured, 1);
  assert.equal(session_of(other).secured, 1);
});

test("closing a chat's last tab clears its profile, closing one of several does not", () => {
  const first = browser.open_user_tab("chat-a", "https://a.example/");
  const second = browser.open_user_tab("chat-a", "https://a.example/two");
  const other = browser.open_user_tab("chat-b", "https://b.example/");
  const before_a = wipes(first);
  const before_b = wipes(other);
  browser.close_tab("chat-a", first.tab_id);
  assert.equal(wipes(first), before_a);
  browser.close_tab("chat-a", second.tab_id);
  assert.equal(wipes(first), before_a + 1);
  assert.equal(session_of(first).auth_wipes, session_of(first).wipes);
  assert.equal(wipes(other), before_b);
});

test("deleting a chat clears its profile and leaves other chats' profiles alone", () => {
  const doomed = browser.open_user_tab("chat-a", "https://a.example/");
  browser.open_user_tab("chat-a", "https://a.example/two");
  const survivor = browser.open_user_tab("chat-b", "https://b.example/");
  const before_a = wipes(doomed);
  const before_b = wipes(survivor);
  browser.close_chat_tabs("chat-a");
  assert.equal(wipes(doomed), before_a + 1);
  assert.equal(wipes(survivor), before_b);
});

test("quitting clears every profile", () => {
  const tabs = [browser.open_user_tab("chat-a", "about:blank"), browser.open_user_tab("chat-b", "about:blank"), browser.open_user_tab("", "about:blank")];
  const before = tabs.map(wipes);
  browser.close_all_tabs();
  assert.deepEqual(tabs.map(wipes), before.map((count: number) => count + 1));
});

test("a chat that opens a tab while its old profile is still being cleared loads only after the clearing", async () => {
  const old = browser.open_user_tab("chat-c", "https://c.example/");
  const profile = session_of(old);
  let finish: () => void = () => undefined;
  profile.wipe_gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  browser.close_tab("chat-c", old.tab_id);
  const again = browser.open_user_tab("chat-c", "https://c.example/again");
  assert.equal(partition_of(again), partition_of(old));
  assert.equal(profile.secured, 1);
  let ran = false;
  const work = browser.run_on_tab("chat-c", again.tab_id, never, async () => {
    ran = true;
  });
  await flushed();
  assert.deepEqual(again.guest.loads, []);
  assert.equal(ran, false);
  finish();
  await work;
  await flushed();
  assert.deepEqual(again.guest.loads, ["https://c.example/again"]);
  assert.equal(ran, true);
  profile.wipe_gate = Promise.resolve();
});

test("a tab closed before its profile finished clearing never loads", async () => {
  const old = browser.open_user_tab("chat-d", "https://d.example/");
  const profile = session_of(old);
  let finish: () => void = () => undefined;
  profile.wipe_gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  browser.close_tab("chat-d", old.tab_id);
  const again = browser.open_user_tab("chat-d", "https://d.example/again");
  browser.close_tab("chat-d", again.tab_id);
  finish();
  await flushed();
  await flushed();
  assert.deepEqual(again.guest.loads, []);
  profile.wipe_gate = Promise.resolve();
});

test("tabs opened on the new-chat screen keep their profile in the chat created from it", () => {
  const draft = browser.open_user_tab("", "https://draft.example/");
  const draft_partition = partition_of(draft);
  assert.match(draft_partition, /^vx-browser-draft-\d+$/);
  browser.adopt_tabs("", "chat-new");
  const next = browser.open_user_tab("chat-new", "https://next.example/");
  assert.equal(partition_of(next), draft_partition);
  const later_draft = browser.open_user_tab("", "about:blank");
  assert.match(partition_of(later_draft), /^vx-browser-draft-\d+$/);
  assert.notEqual(partition_of(later_draft), draft_partition);
  const before = wipes(draft);
  browser.close_tab("chat-new", draft.tab_id);
  assert.equal(wipes(draft), before);
  browser.close_tab("chat-new", next.tab_id);
  assert.equal(wipes(draft), before + 1);
  const fresh = browser.open_user_tab("chat-new", "about:blank");
  assert.equal(partition_of(fresh), "vx-browser-chat-chat-new");
});

test("a popup opens in the profile of its opener's chat", () => {
  const opener = browser.open_user_tab("chat-a", "https://a.example/");
  opener.guest.open_handler({ url: "https://popup.example/" });
  const popup = browser.active_tab("chat-a");
  assert.notEqual(popup, opener);
  assert.equal(partition_of(popup), partition_of(opener));
});
