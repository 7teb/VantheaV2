import assert from "node:assert/strict";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";

type FrameEvent = { url: string; isMainFrame: boolean; prevented: boolean; preventDefault: () => void };

type RequestHandler = (contents: unknown, permission: string, callback: (granted: boolean) => void, details: { isMainFrame: boolean; requestingUrl: string }) => void;

type CheckHandler = (contents: unknown, permission: string, origin: string, details: { isMainFrame: boolean }) => boolean;

type FakeContents = {
  emit: (name: string, event: FrameEvent) => boolean;
  main_url: string;
  session: { request_handler: RequestHandler; check_handler: CheckHandler };
};

const stubs: Record<string, string> = {
  electron: [
    'import { EventEmitter } from "node:events";',
    "export const app = { getAppPath: () => process.cwd() };",
    "export const shell = { openExternal: async () => {} };",
    "class FakeSession { setPermissionRequestHandler(handler) { this.request_handler = handler; } setPermissionCheckHandler(handler) { this.check_handler = handler; } }",
    'class FakeContents extends EventEmitter { main_url = "file:///D:/VantheaX/dist/index.html"; session = new FakeSession(); setWindowOpenHandler() {} getZoomLevel() { return 0; } getURL() { return this.main_url; } }',
    "export class BrowserWindow extends EventEmitter { webContents = new FakeContents(); isMaximized() { return false; } isFullScreen() { return false; } isFocused() { return false; } maximize() {} show() {} loadURL() { return Promise.resolve(); } loadFile() { return Promise.resolve(); } }",
  ].join("\n"),
  spellcheck: "export const init_spellcheck = () => {};",
};

const window_stubs: Plugin = {
  name: "window-stubs",
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
    builder.onResolve({ filter: /[\\/]spellcheck\.ts$/ }, () => ({ path: "spellcheck", namespace: "stub" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js", resolveDir: process.cwd() }));
  },
};

let contents: FakeContents;

before(async () => {
  const result = await build({
    stdin: { contents: 'export { create_window } from "./electron/app/window.ts";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [window_stubs],
    logLevel: "silent",
  });
  const module = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
  contents = module.create_window(() => {}).webContents;
});

const navigate = (url: string, isMainFrame = false): boolean => {
  const event: FrameEvent = {
    url,
    isMainFrame,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  contents.emit("will-frame-navigate", event);
  return event.prevented;
};

test("the main window lets a sub-frame load the visual frame shell next to the app page", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(navigate("file:///D:/VantheaX/dist/visual-frame.html"), false);
  contents.main_url = "http://127.0.0.1:5173/";
  assert.equal(navigate("http://127.0.0.1:5173/visual-frame.html"), false);
  contents.main_url = "file:///D:/VantheaX/dist/index.html";
  assert.equal(warn.mock.callCount(), 0);
});

test("the main window refuses every other sub-frame navigation and logs it", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const targets = [
    "https://example.com/collect?d=1",
    "http://127.0.0.1:5173/",
    "http://127.0.0.1:5173/visual-frame.html",
    "file:///D:/VantheaX/dist/visual-frame.html?x=1",
    "file:///D:/VantheaX/visual-frame.html",
    "about:srcdoc",
    "about:blank",
    "data:text/html,<p>x</p>",
    "blob:null/1b2c",
    "file:///C:/Windows/win.ini",
  ];
  for (const url of targets) {
    assert.equal(navigate(url), true, `${url} was not refused`);
  }
  assert.equal(warn.mock.callCount(), targets.length);
  assert.match(String(warn.mock.calls[0].arguments[0]), /sub-frame navigation of the main window to https:\/\/example\.com\/collect\?d=1/);
});

test("the sub-frame guard leaves main-frame navigations to the will-navigate handler", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(navigate("https://example.com/", true), false);
});

test("the app session grants permissions to the main frame only", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const answers: boolean[] = [];
  const request = (isMainFrame: boolean, permission: string) =>
    contents.session.request_handler(null, permission, (granted) => answers.push(granted), { isMainFrame, requestingUrl: "file:///D:/VantheaX/dist/visual-frame.html" });
  request(true, "clipboard-sanitized-write");
  request(false, "clipboard-read");
  request(false, "notifications");
  assert.deepEqual(answers, [true, false, false]);
  assert.equal(warn.mock.callCount(), 2);
  assert.match(String(warn.mock.calls[0].arguments[0]), /denied clipboard-read to a sub-frame of the main window/);
  const check = contents.session.check_handler;
  assert.equal(check(null, "clipboard-sanitized-write", "file://", { isMainFrame: true }), true);
  assert.equal(check(null, "clipboard-read", "null", { isMainFrame: false }), false);
  assert.equal(check(null, "deprecated-sync-clipboard-read", "file://", { isMainFrame: true }), false);
});
