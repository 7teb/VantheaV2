import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { encode_wire } from "../shared/remote-wire.ts";
import { build_api_messages } from "../electron/turn/history.ts";
import { continuation_text } from "../electron/turn/user-input.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { completed, harness, model, transcript } from "./turn-loop-harness.ts";

test("all pending calls reject together, while fresh calls and queued sends recover after hello", async (t) => {
  const bundled = await build({
    stdin: { contents: 'export {create_remote_stream} from "./src/api/remote-stream.ts";export {create_rpc} from "./src/api/remote-rpc.ts";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "browser", format: "esm", write: false, legalComments: "none", logLevel: "silent",
  });
  const client = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].contents).toString("base64"));
  const names = ["window", "document", "location", "EventSource", "fetch"];
  const descriptors = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const sources: Source[] = [];
  const posts: string[] = [];
  class Source {
    static CLOSED = 2;
    readyState = 0;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string; lastEventId: string }) => void) | null = null;
    constructor() { sources.push(this); }
    close() { this.readyState = Source.CLOSED; }
    hello() { this.onmessage?.({ data: encode_wire({ n: "vx:hello", p: { boot: "test" } }), lastEventId: "test.0" }); }
  }
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  t.mock.method(console, "error", () => {});
  define("window", { setTimeout: (run: () => void, delay: number) => setTimeout(run, delay), clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) });
  define("document", { visibilityState: "visible", addEventListener: () => {} });
  define("location", { reload: () => assert.fail("unexpected reload") });
  define("EventSource", Source);
  define("fetch", async (_url: string, request: { body: string }) => { posts.push(request.body); return new Response(encode_wire({ ok: true, result: "recovered" }), { status: 200 }); });
  try {
    const stream = client.create_remote_stream("independent");
    const rpc = client.create_rpc("independent", stream.ready);
    const first = rpc.invoke("first", []);
    const second = rpc.invoke("second", []);
    const rejected = [assert.rejects(first, /refused/), assert.rejects(second, /refused/)];
    rpc.send("failed-send", []);
    sources[0].readyState = Source.CLOSED;
    sources[0].onerror?.();
    await Promise.all(rejected);
    await assert.rejects(rpc.invoke("after-refusal", []), /refused/);
    assert.deepEqual(posts, []);
    t.mock.timers.tick(45_000);
    assert.equal(sources.length, 2);
    const third = rpc.invoke("third", []);
    const fourth = rpc.invoke("fourth", []);
    assert.equal(posts.length, 0);
    sources[1].hello();
    assert.deepEqual(await Promise.all([third, fourth]), ["recovered", "recovered"]);
    rpc.send("fresh-send", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posts.length, 3);
  } finally {
    t.mock.timers.reset();
    for (const name of names) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("a stopped continuation retains its original prompt before the stopped partial output", async () => {
  let calls = 0;
  const run = harness(async (_request, callbacks) => {
    calls += 1;
    callbacks.on_text(calls === 1 ? "initial partial" : "continued partial");
    if (calls === 2) run.controller.abort();
    return completed({ content: calls === 1 ? "initial partial" : "continued partial", finish_reason: calls === 1 ? "length" : "stop" });
  }, []);
  await run_turn_loop(run.session, run.messages);
  const out = await build_api_messages({ system: "s", messages: [transcript(run.events)], summary: null, model, agent_tools: false });
  const continuation = out.findIndex((entry) => entry.role === "user" && entry.content === continuation_text);
  assert.ok(continuation > 0);
  assert.equal(out[continuation - 1].content, "initial partial");
  assert.equal(out[continuation + 1].content, "continued partial");
  assert.equal(out.filter((entry) => entry.content === continuation_text).length, 1);
});
