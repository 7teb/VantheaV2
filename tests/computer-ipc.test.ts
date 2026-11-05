import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { remote_hidden_events, remote_refused } from "../shared/remote-policy.ts";

let ipc: any;
let folder = "";
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "vx-computer-ipc-"));
  const built = await build({ stdin: { contents: 'export {register_computer_ipc} from "./electron/ipc/computer.ts"; export {handle} from "./electron/ipc/handle.ts"; export * from "./tests/computer-ipc-stub.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, plugins: [{ name: "computer-ipc", setup: (api) => { api.onResolve({ filter: /^electron$|\/app\/window\.ts$|\/computer\/(indicator|service)\.ts$|\/turn\/run\.ts$/ }, () => ({ path: path.resolve("tests/computer-ipc-stub.ts") })); } }] });
  const file = path.join(folder, "ipc.mjs");
  await fs.writeFile(file, built.outputFiles[0].contents);
  ipc = await import(pathToFileURL(file).href);
  ipc.register_computer_ipc();
  ipc.handle("settings:get", () => ({ protected: true }));
});
after(async () => { if (folder) await fs.rm(folder, { recursive: true, force: true }); });

test("only main or the exact overlay main frame can read computer state or stop", async () => {
  for (const window of [ipc.main, ipc.overlay]) {
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    assert.equal((await ipc.invokes.get("computer:state")(event)).chat_id, "computer-chat");
    ipc.sends.get("computer:stop")(event);
  }
  assert.deepEqual(ipc.stopped, ["computer-chat", "computer-chat"]);
  for (const event of [{ sender: {}, senderFrame: {} }, { sender: ipc.overlay.webContents, senderFrame: {} }]) {
    await assert.rejects(ipc.invokes.get("computer:state")(event), /untrusted sender/);
    ipc.sends.get("computer:stop")(event);
  }
  assert.equal(ipc.stopped.length, 2);
});

test("overlay permission does not grant access to unrelated IPC channels", async () => {
  await assert.rejects(ipc.invokes.get("settings:get")({ sender: ipc.overlay.webContents, senderFrame: ipc.overlay.webContents.mainFrame }), /untrusted sender/);
  assert.deepEqual(await ipc.invokes.get("settings:get")({ sender: ipc.main.webContents, senderFrame: ipc.main.webContents.mainFrame }), { protected: true });
});

test("phone clients can read the live state but cannot issue overlay commands", () => {
  for (const name of ["computer:stop", "computer:indicator_size"] as const) assert.ok(remote_refused.has(name));
  assert.equal(remote_refused.has("computer:state"), false);
  assert.equal(remote_hidden_events.has("computer:changed"), false);
});
