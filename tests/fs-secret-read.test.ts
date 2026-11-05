import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import { human_decision } from "../electron/permissions/decisions.ts";
import { list_files_tool, read_file_tool } from "../electron/tools/fs/read.ts";
import { get_file_outline_tool, grep_files_tool } from "../electron/tools/fs/search.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { answer, main_review_actor, review_stub, type ReviewStub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let root = "";
let storage = "";

let chats = 0;

const put = async (relative: string, content: string) => {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-secret-read-"));
  storage = await fs.mkdtemp(path.join(os.tmpdir(), "vx-secret-read-storage-"));
  set_storage_root(storage);
  await put(".env", "SECRET_TOKEN=abc123\n");
  await put(".ssh/id_rsa", "PRIVATE KEY BODY\n");
  await put("src/app.ts", "export const load_token = () => process.env.SECRET_TOKEN;\n");
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(storage, { recursive: true, force: true });
});

type Asked = { requests: ApprovalRequest[] };

const context = (mode: PermissionMode, stub: ReviewStub, asked: Asked, answers: boolean[] = []): ToolContext => ({
  chat_id: `secret-read-${(chats += 1)}`,
  turn_id: "turn",
  call_id: "call",
  project_root: root,
  user_request: "fix the login",
  mode,
  profile: "main",
  model: tool_model,
  image_fit: [],
  settings: { custom_instructions: "" } as ToolContext["settings"],
  signal: new AbortController().signal,
  progress: () => undefined,
  approve: async (request): Promise<ApprovalDecision> => {
    asked.requests.push(request);
    return { approved: answers.shift() ?? false, grant: "once", feedback: "" };
  },
  side_model: async () => "",
  review: stub,
  message_main: null,
  send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
});

const request_text = (stub: ReviewStub, index: number) => stub.calls[index]?.parts.map((part) => part.text).join("") ?? "";

test("ask mode shows a secret_read card for a named .env file and reads it only after approval", async () => {
  const stub = review_stub();
  const asked: Asked = { requests: [] };
  const ctx = context("ask", stub, asked, [true, false]);
  const approved = await read_file_tool.execute(ctx, { path: ".env" });
  assert.equal(approved.status, "done");
  assert.match(approved.text, /SECRET_TOKEN=abc123/);
  assert.deepEqual(asked.requests[0], { kind: "secret_read", tool: "read_file", path: ".env", query: null });
  const declined = await read_file_tool.execute(ctx, { path: ".env" });
  assert.equal(declined.status, "denied");
  assert.match(declined.text, /^The user denied this tool call\. It did not run\./);
  assert.doesNotMatch(declined.text, /abc123/);
  assert.equal(stub.calls.length, 0);
});

test("auto mode hands a named secret read to the review: a deny refuses it without a card, an allow reads it", async () => {
  const stub = review_stub([answer("deny", "no user message allows reading .env, the agent has to ask the user in chat first"), answer("allow")]);
  const asked: Asked = { requests: [] };
  const ctx = context("auto", stub, asked);
  const denied = await read_file_tool.execute(ctx, { path: ".env" });
  assert.equal(denied.status, "denied");
  assert.match(denied.text, /^Denied by the automatic review\. The tool call did not run\.\nReason: no user message allows reading \.env, the agent has to ask the user in chat first/);
  assert.doesNotMatch(denied.text, /abc123/);
  assert.match(request_text(stub, 0), /tool: read_file\n/);
  assert.match(request_text(stub, 0), /arguments:\n----- BEGIN ARGUMENTS \[tag [0-9a-f]+\] -----\npath: \.env\n/);
  assert.doesNotMatch(request_text(stub, 0), /abc123/);
  const allowed = await read_file_tool.execute(ctx, { path: ".env" });
  assert.equal(allowed.status, "done");
  assert.match(allowed.text, /SECRET_TOKEN=abc123/);
  assert.deepEqual(asked.requests, []);
});

test("full mode reviews a named secret read as well", async () => {
  const stub = review_stub([answer("deny", "the agent has to ask the user in chat first")]);
  const asked: Asked = { requests: [] };
  const denied = await get_file_outline_tool.execute(context("full", stub, asked), { path: ".env" });
  assert.equal(denied.status, "denied");
  assert.match(request_text(stub, 0), /tool: get_file_outline\n/);
  assert.deepEqual(asked.requests, []);
});

test("a review answer of review still shows the secret_read card with the review note", async () => {
  const stub = review_stub([answer("review", "unclear whether the user allows reading the key")]);
  const asked: Asked = { requests: [] };
  const result = await list_files_tool.execute(context("auto", stub, asked, [true]), { path: ".ssh" });
  assert.equal(result.status, "done");
  assert.match(result.text, /\.ssh\/id_rsa/);
  const request = asked.requests[0];
  assert.equal(request?.kind, "secret_read");
  assert.deepEqual(request?.kind === "secret_read" ? [request.tool, request.path, request.query, request.review?.reason] : [], ["list_files", ".ssh", null, "unclear whether the user allows reading the key"]);
});

test("ordinary reads, folder-wide searches and listings need no review and keep secret content out", async () => {
  const stub = review_stub();
  const asked: Asked = { requests: [] };
  const ctx = context("auto", stub, asked);
  assert.equal((await read_file_tool.execute(ctx, { path: "src/app.ts" })).status, "done");
  assert.equal((await get_file_outline_tool.execute(ctx, { path: "src/app.ts" })).status, "done");
  const grep = await grep_files_tool.execute(ctx, { query: "SECRET_TOKEN" });
  assert.equal(grep.status, "done");
  assert.match(grep.text, /src\/app\.ts:1:/);
  assert.doesNotMatch(grep.text, /abc123|\.env:/);
  const listing = await list_files_tool.execute(ctx, {});
  assert.match(listing.text, /^\.env \(/m);
  assert.match(listing.text, /^src\/app\.ts \(/m);
  assert.doesNotMatch(listing.text, /id_rsa/);
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(asked.requests, []);
});

test("grep_files on a named secret file sends path and query to the review and searches it once allowed", async () => {
  const stub = review_stub([answer("allow")]);
  const asked: Asked = { requests: [] };
  const grep = await grep_files_tool.execute(context("auto", stub, asked), { query: "SECRET", path: ".env" });
  assert.equal(grep.status, "done");
  assert.match(grep.text, /\.env:1: SECRET_TOKEN=abc123/);
  assert.match(request_text(stub, 0), /path: \.env\nquery: SECRET\n/);
});

test("an answered secret_read card becomes a human decision with the reviewed subject", () => {
  const request: ApprovalRequest = { kind: "secret_read", tool: "grep_files", path: ".env", query: "SECRET" };
  const decision = human_decision(request, { approved: true, grant: "once", feedback: "" }, main_review_actor, null);
  assert.deepEqual([decision.tool, decision.subject, decision.approved], ["grep_files", "path: .env\nquery: SECRET", true]);
});
