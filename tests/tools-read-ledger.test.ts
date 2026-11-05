import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import type { ReviewActor } from "../shared/review.ts";
import { forget_chat_reads, read_refusal } from "../electron/project/read-ledger.ts";
import { writes_settled } from "../electron/storage/json-file.ts";
import { path_key, set_storage_root } from "../electron/storage/paths.ts";
import { fs_tools } from "../electron/tools/fs/index.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let root = "";
let storage = "";

const main_actor: ReviewActor = { id: "main", name: "main", kind: "main" };
const agent_actor: ReviewActor = { id: "agent_1", name: "Helper", kind: "agent" };

type CallOptions = { chat?: string; actor?: ReviewActor; mode?: PermissionMode };

const call = async (name: string, args: Record<string, unknown>, options: CallOptions = {}) => {
  const tool = fs_tools.find((entry) => entry.spec.name === name);
  assert.ok(tool, name);
  const requests: ApprovalRequest[] = [];
  const ctx: ToolContext = {
    chat_id: options.chat ?? "chat-ledger",
    turn_id: "turn-ledger",
    call_id: "call",
    project_root: root,
    user_request: "edit the project",
    mode: options.mode ?? "auto",
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: {} as ToolContext["settings"],
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async (request) => {
      requests.push(request);
      return { approved: true, grant: "once", feedback: "" };
    },
    side_model: async () => "",
    review: review_stub([], options.actor ?? main_actor),
    message_main: null,
    send_peer: null,
    context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
  const result = await tool.execute(ctx, args);
  return { result, requests };
};

const file = (relative: string) => path.join(root, relative);

const seed = async (relative: string, text: string) => fs.writeFile(file(relative), text);

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-read-ledger-"));
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "vx-read-ledger-storage-"));
  set_storage_root(storage);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await fs.rm(storage, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test("an existing file that was never read cannot be edited or overwritten, and nothing is written", async () => {
  await seed("unread.ts", "const a = 1;\n");
  const { result: replaced, requests } = await call("replace_in_file", { path: "unread.ts", old_string: "1", new_string: "2" }, { mode: "ask" });
  assert.equal(replaced.status, "failed");
  assert.equal(replaced.text, "You have not read unread.ts yet; read it with read_file before you edit it");
  assert.equal(requests.length, 0, "the refusal comes before any approval card");
  const { result: written } = await call("write_file", { path: "unread.ts", content: "const a = 3;\n" });
  assert.equal(written.status, "failed");
  assert.match(written.text, /You have not read unread\.ts yet/);
  assert.equal(await fs.readFile(file("unread.ts"), "utf8"), "const a = 1;\n");
});

test("after a read the file can be edited, and the agent's own edits keep it editable without another read", async () => {
  await seed("read.ts", "const a = 1;\nconst b = 2;\n");
  assert.equal((await call("read_file", { path: "read.ts", start_line: 2, limit: 1 })).result.status, "done");
  assert.equal((await call("replace_in_file", { path: "read.ts", old_string: "1", new_string: "10" })).result.status, "done");
  assert.equal((await call("replace_in_file", { path: "read.ts", old_string: "2", new_string: "20" })).result.status, "done");
  assert.equal((await call("write_file", { path: "read.ts", content: "const a = 100;\n" })).result.status, "done");
  assert.equal(await fs.readFile(file("read.ts"), "utf8"), "const a = 100;\n");
});

test("a change on disk after the read refuses the edit until the file is read again", async () => {
  await seed("changed.ts", "let x = 1;\n");
  await call("read_file", { path: "changed.ts" });
  await seed("changed.ts", "let x = 1;\nlet y = 2;\n");
  const { result } = await call("replace_in_file", { path: "changed.ts", old_string: "x = 1", new_string: "x = 5" });
  assert.equal(result.status, "failed");
  assert.equal(result.text, "changed.ts changed on disk since you last read it (a command, another agent or the user wrote it); read it again with read_file before you edit it");
  assert.equal(await fs.readFile(file("changed.ts"), "utf8"), "let x = 1;\nlet y = 2;\n");
  await call("read_file", { path: "changed.ts" });
  assert.equal((await call("replace_in_file", { path: "changed.ts", old_string: "x = 1", new_string: "x = 5" })).result.status, "done");
});

test("a change after the agent's own write also refuses the next edit", async () => {
  assert.equal((await call("write_file", { path: "own.ts", content: "a\n" })).result.status, "done");
  await seed("own.ts", "b\n");
  const { result } = await call("write_file", { path: "own.ts", content: "c\n" });
  assert.equal(result.status, "failed");
  assert.match(result.text, /changed on disk since you last read it/);
});

test("reads count per agent and per chat", async () => {
  await seed("shared.ts", "one\n");
  await call("read_file", { path: "shared.ts" });
  const by_agent = await call("replace_in_file", { path: "shared.ts", old_string: "one", new_string: "two" }, { actor: agent_actor });
  assert.equal(by_agent.result.status, "failed");
  assert.match(by_agent.result.text, /You have not read shared\.ts yet/);
  const elsewhere = await call("replace_in_file", { path: "shared.ts", old_string: "one", new_string: "two" }, { chat: "chat-other" });
  assert.equal(elsewhere.result.status, "failed");
  await call("read_file", { path: "shared.ts" }, { actor: agent_actor });
  assert.equal((await call("replace_in_file", { path: "shared.ts", old_string: "one", new_string: "two" }, { actor: agent_actor })).result.status, "done");
  const main_after = await call("replace_in_file", { path: "shared.ts", old_string: "two", new_string: "three" });
  assert.equal(main_after.result.status, "failed", "the agent's write is a change for the main agent");
  assert.match(main_after.result.text, /changed on disk since you last read it/);
});

test("creating a file needs no read, an unchanged write_file counts as a read, and deleting the chat forgets its reads", async () => {
  assert.equal((await call("write_file", { path: "fresh/new.ts", content: "new\n" })).result.status, "done");
  await seed("same.ts", "same\n");
  const unchanged = await call("write_file", { path: "same.ts", content: "same\n" });
  assert.equal(unchanged.result.status, "done");
  assert.match(unchanged.result.text, /already has exactly this content/);
  assert.equal((await call("replace_in_file", { path: "same.ts", old_string: "same", new_string: "other" })).result.status, "done");
  await seed("forgotten.ts", "f\n");
  await call("read_file", { path: "forgotten.ts" });
  await forget_chat_reads("chat-ledger");
  const after_forget = await call("replace_in_file", { path: "forgotten.ts", old_string: "f", new_string: "g" });
  assert.equal(after_forget.result.status, "failed");
  assert.match(after_forget.result.text, /You have not read forgotten\.ts yet/);
});

test("a binary file is not recorded as read", async () => {
  await fs.writeFile(file("blob.bin"), Buffer.from([0, 1, 2, 0, 3]));
  assert.equal((await call("read_file", { path: "blob.bin" })).result.status, "failed");
  const { result } = await call("write_file", { path: "blob.bin", content: "text\n" });
  assert.equal(result.status, "failed");
  assert.doesNotMatch(result.text, /changed on disk/);
});

const ledger_file = (chat_id: string) => path.join(storage, "v2", "reads", `${chat_id}.json`);

const fresh_ledger = async (tag: string): Promise<typeof import("../electron/project/read-ledger.ts")> => import(`../electron/project/read-ledger.ts?${tag}`);

test("reads are saved per chat and still count after a restart, a changed hash still refuses", async () => {
  await seed("kept.ts", "kept\n");
  await seed("moved.ts", "moved\n");
  await call("read_file", { path: "kept.ts" }, { chat: "chat-persist" });
  await call("read_file", { path: "moved.ts" }, { chat: "chat-persist", actor: agent_actor });
  await writes_settled(ledger_file("chat-persist"));
  const saved = JSON.parse(await fs.readFile(ledger_file("chat-persist"), "utf8"));
  assert.equal(saved.version, 1);
  assert.match(saved.actors.main[path_key(await fs.realpath(file("kept.ts")))], /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(saved.actors).sort(), ["agent_1", "main"]);
  await seed("moved.ts", "moved twice\n");
  const restarted = await fresh_ledger("restart");
  const kept_hash = saved.actors.main[path_key(await fs.realpath(file("kept.ts")))];
  assert.equal(await restarted.read_refusal("chat-persist", "main", await fs.realpath(file("kept.ts")), "kept.ts", kept_hash), null);
  assert.match((await restarted.read_refusal("chat-persist", "agent_1", await fs.realpath(file("moved.ts")), "moved.ts", "0".repeat(64))) ?? "", /moved\.ts changed on disk since you last read it/);
  assert.match((await restarted.read_refusal("chat-persist", "main", await fs.realpath(file("moved.ts")), "moved.ts", "0".repeat(64))) ?? "", /You have not read moved\.ts yet/);
});

test("a corrupt ledger file is kept aside and the chat starts with no reads", async () => {
  await fs.mkdir(path.dirname(ledger_file("chat-corrupt")), { recursive: true });
  await fs.writeFile(ledger_file("chat-corrupt"), "{ not json");
  const restarted = await fresh_ledger("corrupt");
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => errors.push(values.join(" "));
  try {
    assert.match((await restarted.read_refusal("chat-corrupt", "main", file("x.ts"), "x.ts", "0".repeat(64))) ?? "", /You have not read x\.ts yet/);
  } finally {
    console.error = original;
  }
  assert.match(String(errors[0]), /read ledger .* is corrupt/);
  const kept = (await fs.readdir(path.dirname(ledger_file("chat-corrupt")))).filter((name) => name.startsWith("chat-corrupt.json.corrupt-"));
  assert.equal(kept.length, 1);
});

test("deleting a chat removes its ledger file and a read that ends afterwards does not bring it back", async () => {
  await seed("gone.ts", "gone\n");
  await call("read_file", { path: "gone.ts" }, { chat: "chat-gone" });
  await writes_settled(ledger_file("chat-gone"));
  await fs.access(ledger_file("chat-gone"));
  await forget_chat_reads("chat-gone");
  await assert.rejects(fs.access(ledger_file("chat-gone")), { code: "ENOENT" });
  await call("read_file", { path: "gone.ts" }, { chat: "chat-gone" });
  await writes_settled(ledger_file("chat-gone"));
  await assert.rejects(fs.access(ledger_file("chat-gone")), { code: "ENOENT" });
  assert.match((await read_refusal("chat-gone", "main", await fs.realpath(file("gone.ts")), "gone.ts", "0".repeat(64))) ?? "", /You have not read gone\.ts yet/);
});
