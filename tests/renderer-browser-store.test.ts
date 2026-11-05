import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import type { BrowserChatTabs, BrowserTabInfo } from "../shared/ipc/browser.ts";
import { covered_by, intersects, same_rect } from "../src/features/docks/browser/viewport-geometry.ts";

const globals = ["window", "localStorage"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const calls: { name: string; args: unknown[] }[] = [];
const main_tabs: Record<string, BrowserChatTabs> = {};
let client: any;

const tab = (tab_id: string, url: string): BrowserTabInfo => ({ tab_id, url, title: "", loading: false, can_back: false, can_forward: false, error: "", crashed: false });

const answer = (name: string, args: unknown[]) => {
  const chat_id = args[0] as string;
  if (name === "browser:tabs") {
    return main_tabs[chat_id] ?? { chat_id, tabs: [], active_id: "" };
  }
  if (name === "browser:open") {
    const created = tab(`tab-${calls.length}`, args[1] as string);
    const current = main_tabs[chat_id] ?? { chat_id, tabs: [], active_id: "" };
    main_tabs[chat_id] = { chat_id, tabs: [...current.tabs, created], active_id: created.tab_id };
    return created.tab_id;
  }
  return undefined;
};

before(async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 1440,
      setTimeout,
      clearTimeout,
      vx: {
        invoke: async (name: string, ...args: unknown[]) => {
          calls.push({ name, args });
          return answer(name, args);
        },
        on: () => () => undefined,
        send: (name: string, ...args: unknown[]) => calls.push({ name, args }),
      },
    },
  });
  const entry = 'export * from "./src/state/browser.ts";';
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", write: false, legalComments: "none", logLevel: "silent" });
  client = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

after(() => {
  for (const name of globals) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test("each chat keeps its own tab list and the no-chat view uses the draft key", () => {
  client.apply_browser_tabs({ chat_id: "chat-a", tabs: [tab("a1", "https://a.example/")], active_id: "a1" });
  client.apply_browser_tabs({ chat_id: "chat-b", tabs: [tab("b1", "https://b.example/")], active_id: "b1" });
  const state = client.browser_store.get();
  assert.deepEqual(state.chats["chat-a"].tabs.map((entry: BrowserTabInfo) => entry.tab_id), ["a1"]);
  assert.deepEqual(state.chats["chat-b"].tabs.map((entry: BrowserTabInfo) => entry.tab_id), ["b1"]);
  assert.equal(client.browser_chat_key(null), "");
  assert.equal(client.browser_chat_key("chat-a"), "chat-a");
});

test("an empty dock opens exactly one tab in its own chat even when asked twice", async () => {
  await client.sync_browser("chat-c");
  calls.length = 0;
  await Promise.all([client.ensure_browser_tab("chat-c"), client.ensure_browser_tab("chat-c")]);
  const opens = calls.filter((call) => call.name === "browser:open");
  assert.deepEqual(opens.map((call) => call.args), [["chat-c", "about:blank"]]);
  assert.equal(client.browser_store.get().chats["chat-c"].tabs.length, 1);
  calls.length = 0;
  await client.ensure_browser_tab("chat-c");
  assert.equal(calls.length, 0);
});

test("a typed address survives updates until the page navigates while the field is not being edited", () => {
  client.set_browser_draft("a1", "half typed");
  client.apply_browser_tabs({ chat_id: "chat-a", tabs: [{ ...tab("a1", "https://a.example/"), title: "A" }], active_id: "a1" });
  assert.equal(client.browser_store.get().drafts.a1, "half typed");
  client.set_browser_editing("a1");
  client.apply_browser_tabs({ chat_id: "chat-a", tabs: [tab("a1", "https://a.example/next")], active_id: "a1" });
  assert.equal(client.browser_store.get().drafts.a1, "half typed");
  client.set_browser_editing("");
  client.apply_browser_tabs({ chat_id: "chat-a", tabs: [tab("a1", "https://a.example/third")], active_id: "a1" });
  assert.equal("a1" in client.browser_store.get().drafts, false);
  client.set_browser_draft("b1", "other chat");
  client.apply_browser_tabs({ chat_id: "chat-a", tabs: [], active_id: "" });
  assert.equal(client.browser_store.get().drafts.b1, "other chat");
});

test("viewport messages carry the chat they belong to", () => {
  calls.length = 0;
  client.send_browser_viewport({ chat_id: "chat-b", rect: { x: 1, y: 2, width: 300, height: 200 }, radius: 8 });
  assert.deepEqual(calls, [{ name: "browser:viewport", args: [{ chat_id: "chat-b", rect: { x: 1, y: 2, width: 300, height: 200 }, radius: 8 }] }]);
});

test("an overlay hides the live page only where it overlaps the page area", () => {
  const page = { x: 900, y: 100, width: 600, height: 700 };
  assert.equal(intersects(page, { x: 1400, y: 90, width: 200, height: 40 }), true);
  assert.equal(intersects(page, { x: 100, y: 100, width: 400, height: 300 }), false);
  assert.equal(intersects(page, { x: 1000, y: 200, width: 0, height: 30 }), false);
  assert.equal(intersects(page, { x: 1500, y: 100, width: 50, height: 50 }), false);
  assert.equal(covered_by(page, [{ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 4000, height: 2000 }]), true);
  assert.equal(covered_by(page, []), false);
  assert.equal(same_rect(page, { ...page }), true);
  assert.equal(same_rect(page, null), false);
  assert.equal(same_rect(null, null), true);
});
