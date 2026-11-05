import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { build } from "esbuild";
import { decode_wire, encode_wire } from "../shared/remote-wire.ts";

type Handler = (...args: unknown[]) => void;
type FetchInit = { method: string; credentials: string; headers: Record<string, string>; body: string };
type FetchCall = { url: string; init: FetchInit };

class FakeEventSource {
  static CLOSED = 2;
  readyState = 0;
  closed = false;
  url: string;
  onmessage: ((event: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(frame: unknown, id = "") {
    this.onmessage?.({ data: encode_wire(frame), lastEventId: id });
  }

  hello(boot = "b1", id = `${boot}.0`) {
    this.emit({ n: "vx:hello", p: { boot } }, id);
  }
}

const globals = ["window", "document", "location", "fetch", "EventSource"];
const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const sources: FakeEventSource[] = [];
const fetch_calls: FetchCall[] = [];
const opened: unknown[][] = [];
const clicked: { href: string; download: string }[] = [];
const window_handlers = new Map<string, Handler[]>();
const document_handlers = new Map<string, Handler[]>();
const page = { visibility: "visible", focused: true, reloads: 0 };
let respond: (call: FetchCall) => Promise<Response> = async () => ok_reply(undefined);
let client: any;

const ok_reply = (result: unknown) => new Response(encode_wire({ ok: true, result }), { status: 200 });

const flush = () => new Promise((resolve) => setImmediate(resolve));

const listen = (table: Map<string, Handler[]>) => (name: string, handler: Handler) => table.set(name, [...(table.get(name) ?? []), handler]);

const fire = (table: Map<string, Handler[]>, name: string) => {
  for (const handler of table.get(name) ?? []) {
    handler();
  }
};

const fake_anchor = () => {
  const anchor = { href: "", download: "", click: () => clicked.push({ href: anchor.href, download: anchor.download }), remove: () => undefined };
  return anchor;
};

const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });

before(async () => {
  define("window", {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    addEventListener: listen(window_handlers),
    removeEventListener: () => undefined,
    open: (...args: unknown[]) => opened.push(args),
  });
  define("document", {
    get visibilityState() {
      return page.visibility;
    },
    fullscreenElement: null,
    hasFocus: () => page.focused,
    addEventListener: listen(document_handlers),
    removeEventListener: () => undefined,
    createElement: () => fake_anchor(),
    body: { append: () => undefined },
  });
  define("location", { reload: () => void (page.reloads += 1) });
  define("fetch", (url: string, init: FetchInit) => {
    const call = { url, init };
    fetch_calls.push(call);
    return respond(call);
  });
  define("EventSource", FakeEventSource);
  const entry = [
    'export { create_remote_bridge } from "./src/api/remote-bridge.ts";',
    'export { connection_state } from "./src/api/remote-stream.ts";',
    'export { remote_local_channels } from "./shared/remote-policy.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "browser", format: "esm", write: false, legalComments: "none", logLevel: "silent" });
  client = await import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64"));
});

after(() => {
  mock.timers.reset();
  for (const name of globals) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  document_handlers.clear();
  sources.length = 0;
  fetch_calls.length = 0;
  opened.length = 0;
  clicked.length = 0;
  page.visibility = "visible";
  page.focused = true;
  page.reloads = 0;
  respond = async () => ok_reply(undefined);
});

test("an invoke waits for the first hello, then posts the channel with the client header", async () => {
  respond = async () => ok_reply([{ id: "c1" }]);
  const bridge = client.create_remote_bridge();
  const pending = bridge.invoke("chats:list");
  await flush();
  assert.equal(fetch_calls.length, 0);
  assert.equal(sources.length, 1);
  assert.match(sources[0].url, /^\/events\?client=[A-Za-z0-9_-]{22}$/);
  sources[0].hello();
  assert.deepEqual(await pending, [{ id: "c1" }]);
  const [call] = fetch_calls;
  assert.equal(call.url, "/rpc");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.init.headers["x-vx-client"], new URLSearchParams(sources[0].url.split("?")[1]).get("client"));
  assert.deepEqual(decode_wire(call.init.body), { channel: "chats:list", args: [] });
});

test("bytes in arguments travel through the wire encoding", async () => {
  respond = async () => ok_reply({ id: "att_1" });
  const bridge = client.create_remote_bridge();
  bridge.on("turn:event", () => undefined);
  sources[0].hello();
  await bridge.invoke("attachments:save", { name: "a.png", mime: "image/png", bytes: new Uint8Array([1, 2, 255]) });
  const body = decode_wire(fetch_calls[0].init.body) as { args: [{ bytes: Uint8Array }] };
  assert.deepEqual([...body.args[0].bytes], [1, 2, 255]);
});

test("sends go out one after another in call order, and a failed send does not block the next", async () => {
  const gates: ((response: Response) => void)[] = [];
  respond = () => new Promise<Response>((resolve) => gates.push(resolve));
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    bridge.on("terminal:data", () => undefined);
    sources[0].hello();
    bridge.send("terminal:input", "pty-1", "a");
    bridge.send("terminal:input", "pty-1", "b");
    bridge.send("terminal:input", "pty-1", "c");
    await flush();
    assert.equal(fetch_calls.length, 1);
    gates[0](new Response(encode_wire({ ok: false, error: "terminal pty-1 is gone" }), { status: 500 }));
    await flush();
    assert.equal(fetch_calls.length, 2);
    gates[1](ok_reply(undefined));
    await flush();
    assert.equal(fetch_calls.length, 3);
    gates[2](ok_reply(undefined));
    await flush();
    assert.deepEqual(
      fetch_calls.map((call) => (decode_wire(call.init.body) as { args: string[] }).args[1]),
      ["a", "b", "c"],
    );
    assert.equal(errors.mock.callCount(), 1);
  } finally {
    errors.mock.restore();
  }
});

test("a 401 reloads the page and rejects, an error reply rejects with its text, a network failure names the PC", async () => {
  const bridge = client.create_remote_bridge();
  bridge.on("chats:changed", () => undefined);
  sources[0].hello();
  respond = async () => new Response(encode_wire({ ok: false, error: "not paired" }), { status: 401 });
  await assert.rejects(bridge.invoke("chats:list"));
  assert.equal(page.reloads, 1);
  respond = async () => new Response(encode_wire({ ok: false, error: "chat c9 does not exist" }), { status: 500 });
  await assert.rejects(bridge.invoke("chats:get", "c9"), { message: "chat c9 does not exist" });
  respond = async () => new Response(null, { status: 413 });
  await assert.rejects(bridge.invoke("chats:list"), { message: "the PC answered HTTP 413" });
  respond = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(bridge.invoke("chats:list"), { message: "PC not reachable: Failed to fetch" });
  assert.equal(page.reloads, 1);
});

test("refused channels reject at once without a request or a stream", async () => {
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    await assert.rejects(bridge.invoke("projects:choose"), { message: "projects:choose is not available on a remote client" });
    await assert.rejects(bridge.invoke("window:close"), { message: "window:close is not available on a remote client" });
    await assert.rejects(bridge.invoke("remote:status"), { message: "remote:status is not available on a remote client" });
    bridge.send("browser:viewport", { chat_id: "", rect: null, radius: 0 });
    await flush();
    assert.equal(fetch_calls.length, 0);
    assert.equal(sources.length, 0);
    assert.equal(errors.mock.callCount(), 1);
  } finally {
    errors.mock.restore();
  }
});

test("local channels are answered on the device inside the call", async () => {
  const bridge = client.create_remote_bridge();
  assert.deepEqual(await bridge.invoke("window:state"), { maximized: false, fullscreen: false, focused: true, zoom: 0 });
  const opening = bridge.invoke("shell:open_external", "https://example.com/docs");
  assert.deepEqual(opened, [["https://example.com/docs", "_blank", "noopener,noreferrer"]]);
  await opening;
  await assert.rejects(bridge.invoke("shell:open_external", "file:///C:/Windows"), { message: "refusing to open non-http url: file:///C:/Windows" });
  const exporting = bridge.invoke("artifacts:export", "img_k1_a2.png");
  assert.deepEqual(clicked, [{ href: "/media/image/img_k1_a2.png", download: "img_k1_a2.png" }]);
  assert.equal(await exporting, true);
  assert.equal(fetch_calls.length, 0);
  assert.equal(sources.length, 0);
});

test("every channel the policy keeps on the device has a device implementation", async () => {
  const bridge = client.create_remote_bridge();
  const args: Record<string, unknown[]> = { "shell:open_external": ["https://example.com"], "artifacts:export": ["img_k1_a2.png"] };
  for (const name of client.remote_local_channels as Set<string>) {
    await bridge.invoke(name, ...(args[name] ?? []));
  }
  assert.equal(fetch_calls.length, 0);
});

test("window focus changes reach window:changed listeners on the device", () => {
  const bridge = client.create_remote_bridge();
  const states: { focused: boolean }[] = [];
  const stop = bridge.on("window:changed", (state: { focused: boolean }) => states.push(state));
  page.focused = false;
  fire(window_handlers, "blur");
  page.focused = true;
  page.visibility = "hidden";
  fire(document_handlers, "visibilitychange");
  stop();
  fire(window_handlers, "focus");
  assert.deepEqual(
    states.map((state) => state.focused),
    [false, false],
  );
  assert.equal(sources.length, 0);
});

test("stream frames reach their listeners in order and the connection state follows the stream", () => {
  const bridge = client.create_remote_bridge();
  const seen: unknown[] = [];
  bridge.on("chats:changed", (payload: unknown) => seen.push(["chats", payload]));
  const stop = bridge.on("turn:event", (payload: unknown) => seen.push(["turn", payload]));
  const [source] = sources;
  assert.equal(client.connection_state(), "connecting");
  source.hello();
  assert.equal(client.connection_state(), "live");
  source.emit({ n: "turn:event", p: { seq: 1, $kind: "x" } }, "b1.1");
  source.emit({ n: "vx:ping" });
  source.emit({ n: "chats:changed", p: { list: [] } }, "b1.2");
  stop();
  source.emit({ n: "turn:event", p: { seq: 2 } }, "b1.3");
  assert.deepEqual(seen, [
    ["turn", { seq: 1, $kind: "x" }],
    ["chats", { list: [] }],
  ]);
  source.onerror?.();
  assert.equal(client.connection_state(), "offline");
  assert.equal(page.reloads, 0);
  source.hello("b1", "b1.3");
  assert.equal(client.connection_state(), "live");
});

test("resync, a closed stream and a new boot reload the page", () => {
  const bridge = client.create_remote_bridge();
  bridge.on("chats:changed", () => undefined);
  const [source] = sources;
  source.hello("b1");
  source.emit({ n: "vx:resync" });
  assert.equal(page.reloads, 1);
  source.hello("b2");
  assert.equal(page.reloads, 2);
  source.readyState = FakeEventSource.CLOSED;
  source.onerror?.();
  assert.equal(page.reloads, 3);
});

test("a stream refused before its first hello goes offline instead of reloading", () => {
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    bridge.on("chats:changed", () => undefined);
    const [source] = sources;
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    assert.equal(page.reloads, 0);
    assert.equal(client.connection_state(), "offline");
    assert.equal(errors.mock.callCount(), 1);
  } finally {
    errors.mock.restore();
  }
});

test("a stream silent for 45 s while visible reopens with the last event id", () => {
  const bridge = client.create_remote_bridge();
  bridge.on("chats:changed", () => undefined);
  const [first] = sources;
  first.hello("b1", "b1.4");
  first.emit({ n: "chats:changed", p: {} }, "b1.7");
  mock.timers.tick(44_000);
  assert.equal(sources.length, 1);
  first.emit({ n: "vx:ping" });
  mock.timers.tick(44_000);
  assert.equal(sources.length, 1);
  page.visibility = "hidden";
  mock.timers.tick(2_000);
  assert.equal(sources.length, 1);
  page.visibility = "visible";
  fire(document_handlers, "visibilitychange");
  assert.equal(sources.length, 2);
  assert.equal(first.closed, true);
  assert.equal(client.connection_state(), "connecting");
  assert.equal(new URLSearchParams(sources[1].url.split("?")[1]).get("last"), "b1.7");
});

test("terminal refusal before hello rejects RPCs instead of leaving them pending", async () => {
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    const pending = bridge.invoke("chats:list");
    let outcome = "pending";
    void pending.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    sources[0].readyState = FakeEventSource.CLOSED;
    sources[0].onerror?.();
    await flush();
    assert.equal(outcome, "rejected");
    await assert.rejects(pending, /stream|connect|hello/i);
    await assert.rejects(bridge.invoke("chats:list"), /stream|connect|hello/i);
    assert.equal(fetch_calls.length, 0);
  } finally { errors.mock.restore(); }
});

test("a fresh stream after initial refusal accepts fresh RPCs once hello arrives", async () => {
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    const first = bridge.invoke("chats:list");
    const refused = assert.rejects(first, /stream|connect|hello/i);
    let first_state = "pending";
    void first.then(() => { first_state = "resolved"; }, () => { first_state = "rejected"; });
    sources[0].readyState = FakeEventSource.CLOSED;
    sources[0].onerror?.();
    await flush();
    assert.equal(first_state, "rejected");
    await refused;
    mock.timers.tick(45_000);
    assert.equal(sources.length, 2);
    respond = async () => ok_reply(["recovered"]);
    const retry = bridge.invoke("chats:list");
    await flush();
    assert.equal(fetch_calls.length, 0);
    sources[1].hello();
    assert.deepEqual(await retry, ["recovered"]);
    assert.equal(fetch_calls.length, 1);
  } finally { errors.mock.restore(); }
});

test("a transient pre-hello error keeps waiting and succeeds on EventSource recovery", async () => {
  const bridge = client.create_remote_bridge();
  const pending = bridge.invoke("chats:list");
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  sources[0].onerror?.();
  await flush();
  assert.equal(settled, false);
  sources[0].hello();
  await pending;
  assert.equal(settled, true);
});

test("a terminal refusal after event-only subscription also rejects later RPCs", async () => {
  const errors = mock.method(console, "error", () => undefined);
  try {
    const bridge = client.create_remote_bridge();
    bridge.on("chats:changed", () => undefined);
    sources[0].readyState = FakeEventSource.CLOSED;
    sources[0].onerror?.();
    const pending = bridge.invoke("chats:list");
    let outcome = "pending";
    void pending.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
    await flush();
    assert.equal(outcome, "rejected");
    await assert.rejects(pending, /stream|connect|hello/i);
    assert.equal(fetch_calls.length, 0);
  } finally { errors.mock.restore(); }
});
