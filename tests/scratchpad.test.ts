import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { PermissionMode } from "../shared/chat.ts";
import { to_posix } from "../electron/project/scope.ts";
import { close_scratchpads, open_scratchpad, remove_scratchpad, scratch_path } from "../electron/scratchpad/index.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { fs_tools } from "../electron/tools/fs/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let project = "";

let storage = "";

const tool = (name: string) => {
  const found = fs_tools.find((entry) => entry.spec.name === name);
  assert.ok(found, name);
  return found;
};

const context = (chat_id: string, mode: PermissionMode = "full"): ToolContext => ({
  chat_id,
  turn_id: `turn-${chat_id}`,
  call_id: "call",
  project_root: project,
  user_request: "test something",
  mode,
  profile: "main",
  model: tool_model,
  image_fit: [],
  settings: {} as ToolContext["settings"],
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async () => {
    throw new Error("no approval expected");
  },
  side_model: async () => "",
  review: review_stub([]),
  message_main: null,
  send_peer: null,
  context: () => ({ used: 0, limit: 0, compact_at: null }),
});

before(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), "vx-scratch-project-"));
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "vx-scratch-storage-"));
  set_storage_root(storage);
});

after(async () => {
  close_scratchpads();
  await fs.rm(project, { recursive: true, force: true });
  await fs.rm(storage, { recursive: true, force: true });
});

test("every chat gets its own scratchpad folder under the temp folder, and it stays the same for that chat", async () => {
  const first = await open_scratchpad("chat-a");
  const again = await open_scratchpad("chat-a");
  const other = await open_scratchpad("chat-b");
  assert.equal(again, first);
  assert.notEqual(other, first);
  assert.ok((await fs.stat(first)).isDirectory());
  const base = await fs.realpath(path.join(os.tmpdir(), "VantheaX", "scratchpad"));
  assert.equal(path.dirname(first), base);
  assert.match(path.basename(first), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(await scratch_path("chat-a", path.join(first, "probe", "run.mjs")), { root: first, relative: path.join("probe", "run.mjs") });
  assert.equal(await scratch_path("chat-a", "probe/run.mjs"), null);
  assert.equal(await scratch_path("chat-a", path.join(other, "run.mjs")), null);
});

test("write_file, replace_in_file and read_file take absolute paths inside the chat's scratchpad", async () => {
  const folder = await open_scratchpad("chat-tools");
  const file = path.join(folder, "probe.mjs");
  const written = await tool("write_file").execute(context("chat-tools"), { path: file, content: "console.log(1);\n" });
  assert.equal(written.status, "done", written.text);
  assert.equal(await fs.readFile(file, "utf8"), "console.log(1);\n");
  assert.equal(written.view?.kind === "edit" ? written.view.path : "", to_posix(file));
  const replaced = await tool("replace_in_file").execute(context("chat-tools"), { path: file, old_string: "console.log(1);", new_string: "console.log(2);" });
  assert.equal(replaced.status, "done", replaced.text);
  const read = await tool("read_file").execute(context("chat-tools"), { path: file });
  assert.equal(read.status, "done", read.text);
  assert.match(read.text, /console\.log\(2\);/);
  assert.equal(read.view?.kind === "read" ? read.view.path : "", to_posix(file));
  assert.deepEqual(await fs.readdir(project), []);
});

test("another chat's scratchpad and other absolute paths outside the project stay refused", async () => {
  const foreign = await open_scratchpad("chat-foreign");
  const into_foreign = await tool("write_file").execute(context("chat-tools"), { path: path.join(foreign, "x.txt"), content: "x" });
  assert.equal(into_foreign.status, "failed");
  const outside = await tool("write_file").execute(context("chat-tools"), { path: path.join(os.tmpdir(), "vx-scratch-outside.txt"), content: "x" });
  assert.equal(outside.status, "failed");
  await assert.rejects(() => fs.stat(path.join(foreign, "x.txt")));
  await assert.rejects(() => fs.stat(path.join(os.tmpdir(), "vx-scratch-outside.txt")));
});

test("deleting a chat's scratchpad removes the folder, and the chat gets a new one the next time", async () => {
  const folder = await open_scratchpad("chat-delete");
  await fs.writeFile(path.join(folder, "left.txt"), "x");
  await remove_scratchpad("chat-delete");
  await assert.rejects(() => fs.stat(folder));
  const next = await open_scratchpad("chat-delete");
  assert.notEqual(next, folder);
});

test("closing removes every scratchpad folder of this run", async () => {
  const one = await open_scratchpad("chat-close-1");
  const two = await open_scratchpad("chat-close-2");
  close_scratchpads();
  await assert.rejects(() => fs.stat(one));
  await assert.rejects(() => fs.stat(two));
});
