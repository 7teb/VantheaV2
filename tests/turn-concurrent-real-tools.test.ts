import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { resolve_decision, wait_for_decision } from "../electron/permissions/approvals.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { fs_tools } from "../electron/tools/fs/index.ts";
import { run_turn_loop } from "../electron/turn/loop.ts";
import { asked, assert_tool_protocol, calls_of, end_status, ended, marks, scripted, tool_contents, watch } from "./concurrent-kit.ts";
import { ends, harness, transcript, use_media_root } from "./turn-loop-harness.ts";

use_media_root();

let project = "";
let storage = "";

before(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), "vx-concurrent-project-"));
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "vx-concurrent-storage-"));
  set_storage_root(storage);
  await fs.writeFile(path.join(project, "a.ts"), "const a = 1;\n");
  await fs.writeFile(path.join(project, "b.ts"), "const b = 1;\n");
  await fs.writeFile(path.join(project, ".env"), "SECRET=1\n");
});

after(async () => {
  await fs.rm(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await fs.rm(storage, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const read = (file: string, extra: Record<string, unknown> = {}): [string, string] => ["read_file", JSON.stringify({ path: file, ...extra })];

test("real file tools of one response: parallel reads feed the read ledger, the edit is a barrier and the read after it sees the edit", async () => {
  const { stream, requests } = scripted(
    calls_of([
      read("a.ts"),
      read(".env"),
      ["list_files", "{}"],
      read("b.ts"),
      ["replace_in_file", JSON.stringify({ path: "a.ts", old_string: "const a = 1;", new_string: "const a = 2;" })],
      read("a.ts"),
      read("b.ts", { start_line: 1, limit: 1 }),
    ]),
  );
  const h = harness(stream, fs_tools);
  h.session.chat_id = "chat-real-tools";
  h.session.mode = "ask";
  h.session.project_root = project;
  h.session.wait_decision = (call_id, request, on_hold) => wait_for_decision({ key: "chat-real-tools", chat_id: "chat-real-tools", call_id, request, signal: h.controller.signal, on_hold });
  const until = watch(h);
  void until(asked("c0_1"))
    .then(() => until(ended("c0_3")))
    .then(() => resolve_decision("chat-real-tools", "c0_1", { approved: false, grant: "once", feedback: "" }));
  void until(asked("c0_4")).then(() => resolve_decision("chat-real-tools", "c0_4", { approved: true, grant: "once", feedback: "" }));
  await run_turn_loop(h.session, h.messages);
  assert.deepEqual(
    ["c0_0", "c0_1", "c0_2", "c0_3", "c0_4", "c0_5", "c0_6"].map((call_id) => end_status(h.events, call_id)),
    ["done", "denied", "done", "done", "done", "done", "done"],
  );
  const seen = marks(h.events);
  assert.deepEqual(seen.slice(0, 4), ["start:c0_0", "start:c0_1", "start:c0_2", "start:c0_3"]);
  assert.ok(seen.indexOf("end:c0_1") < seen.indexOf("start:c0_4"));
  assert.ok(seen.indexOf("end:c0_4") < seen.indexOf("start:c0_5"));
  assert.ok(seen.indexOf("start:c0_6") < seen.indexOf("end:c0_5"));
  assert.equal(await fs.readFile(path.join(project, "a.ts"), "utf8"), "const a = 2;\n");
  const next = requests[1];
  assert.ok(next);
  assert_tool_protocol(next);
  const contents = tool_contents(next);
  assert.match(contents[0] ?? "", /const a = 1;/);
  assert.doesNotMatch(contents[1] ?? "", /SECRET/);
  assert.match(contents[4] ?? "", /\+1 -1 lines/);
  assert.match(contents[5] ?? "", /const a = 2;/);
  assert.match(contents[6] ?? "", /const b = 1;/);
  assert.equal(ends(h.events).length, 1);
  assert.equal(transcript(h.events).steps.some((step) => step.kind === "tool" && ["queued", "running", "awaiting_approval"].includes(step.status)), false);
});
