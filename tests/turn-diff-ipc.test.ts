import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, test } from "node:test";
import { build, type Plugin } from "esbuild";
import { scratch } from "./git-kit.ts";

let ipc: any;

const window_stub = path.resolve("tests/git-ipc-stub.ts");

const service_stub = path.resolve("tests/turn-diff-ipc-stub.ts");

const stubs: Plugin = {
  name: "turn-diff-ipc-stubs",
  setup: (build_api) => {
    build_api.onResolve({ filter: /^electron$|[\/]app[\/]window\.ts$/ }, () => ({ path: window_stub }));
    build_api.onResolve({ filter: /[\/]chats[\/]store\.ts$|[\/]turn-diff[\/]index\.ts$/ }, () => ({ path: service_stub }));
  },
};

before(async () => {
  const entry = [
    'export { register_turn_diff_ipc } from "./electron/ipc/turn-diff.ts";',
    'export { handlers, sent, trusted_event } from "./tests/git-ipc-stub.ts";',
    'export { calls, fire_change } from "./tests/turn-diff-ipc-stub.ts";',
  ].join("\n");
  const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [stubs] });
  const bundle = path.join(await scratch("turn-diff-ipc-bundle"), "turn-diff-ipc.mjs");
  await fs.writeFile(bundle, result.outputFiles[0].contents);
  ipc = await import(pathToFileURL(bundle).href);
  ipc.register_turn_diff_ipc();
});

const summaries = (...args: unknown[]) => ipc.handlers.get("turn_diff:summaries")(ipc.trusted_event, ...args);

const file = (...args: unknown[]) => ipc.handlers.get("turn_diff:file")(ipc.trusted_event, ...args);

const turn = { kind: "turn", from_id: "a1", to_id: "a2" };

test("valid calls reach the service with the parsed scopes", async () => {
  assert.deepEqual(await summaries("chat-1", [turn, { kind: "chat", extra: true }]), [{ kind: "none" }, { kind: "none" }]);
  assert.deepEqual(ipc.calls.at(-1), ["summaries", ["chat-1", [turn, { kind: "chat" }]]]);
  assert.deepEqual(await file("chat-1", turn, "src/a.ts"), { kind: "unchanged" });
  assert.deepEqual(ipc.calls.at(-1), ["file", ["chat-1", turn, "src/a.ts"]]);
});

test("invalid and unknown chat ids are rejected", async () => {
  const count = ipc.calls.length;
  await assert.rejects(summaries(42, []), /chat id must be a string/);
  await assert.rejects(summaries("x".repeat(201), []), /chat id is longer than 200 characters/);
  await assert.rejects(summaries("chat-unknown", []), /chat chat-unknown not found/);
  await assert.rejects(file("chat-unknown", turn, "a.txt"), /chat chat-unknown not found/);
  assert.equal(ipc.calls.length, count);
});

test("bad scopes, overlong ids and paths are rejected", async () => {
  const count = ipc.calls.length;
  await assert.rejects(summaries("chat-1", { kind: "chat" }), /diff scopes must be an array/);
  await assert.rejects(summaries("chat-1", [{ kind: "commit" }]), /diff scope kind must be "turn" or "chat"/);
  await assert.rejects(summaries("chat-1", [null]), /diff scope must be an object/);
  await assert.rejects(summaries("chat-1", [{ kind: "turn", from_id: "a1" }]), /last turn id must be a string/);
  await assert.rejects(summaries("chat-1", [{ kind: "turn", from_id: "a".repeat(201), to_id: "a2" }]), /first turn id is longer than 200 characters/);
  await assert.rejects(file("chat-1", { kind: "turn", from_id: "a1", to_id: 5 }, "a.txt"), /last turn id must be a string/);
  await assert.rejects(file("chat-1", turn, 7), /file path must be a string/);
  await assert.rejects(file("chat-1", turn, "x".repeat(4001)), /file path is longer than 4000 characters/);
  assert.equal(ipc.calls.length, count);
});

test("an untrusted sender is refused and service changes go out as turn_diff:changed", async () => {
  await assert.rejects(ipc.handlers.get("turn_diff:summaries")({ sender: {}, senderFrame: {} }, "chat-1", []), /untrusted sender/);
  ipc.fire_change({ chat_id: "chat-1" });
  assert.deepEqual(ipc.sent.at(-1), ["turn_diff:changed", { chat_id: "chat-1" }]);
});
