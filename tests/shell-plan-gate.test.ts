import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { full_mode_covers, type ApprovalDecision, type ApprovalRequest, type HumanDecision } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import { human_decision, prefix_grants } from "../electron/permissions/decisions.ts";
import { gate_command } from "../electron/tools/shell/gate.ts";
import type { ToolContext, ToolProfile } from "../electron/tools/types.ts";
import { answer, main_review_actor, review_stub } from "./review-stub.ts";
import { set_storage_root } from "../electron/storage/paths.ts";
import { tool_model } from "./tool-model.ts";

set_storage_root("C:\\Users\\user\\AppData\\Roaming\\VantheaX");

let root = "";

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vx-plan-gate-"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const grant_for = (prefix: string, example: string): HumanDecision => ({
  id: "grant-1",
  at: 1,
  actor: "main",
  tool: "run_command",
  subject: example,
  cwd: root,
  approved: true,
  grant: "prefix",
  feedback: "",
  reason: "",
  grant_prefix: prefix,
});

const gate = async (
  profile: ToolProfile,
  mode: PermissionMode,
  command: string,
  decisions: HumanDecision[] = [],
  card: ApprovalDecision = { approved: true, grant: "prefix", feedback: "" },
  answers: string[] = [answer("allow", "part of the requested work")],
) => {
  const requests: ApprovalRequest[] = [];
  const stub = review_stub(answers);
  const ctx: ToolContext = {
    chat_id: `chat-plan-gate-${profile}-${mode}`,
    turn_id: "turn",
    call_id: "call",
    project_root: root,
    user_request: "plan the change",
    human_decisions: async () => decisions,
    mode,
    profile,
    model: tool_model,
    image_fit: [],
    settings: { custom_instructions: "" } as ToolContext["settings"],
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async (request) => {
      requests.push(request);
      return card;
    },
    side_model: async () => "",
    review: stub,
    message_main: null, send_peer: null, context: () => ({ used: 0, limit: 0, compact_at: null }),
  };
  const outcome = await gate_command(ctx, command, root, false);
  return { outcome, requests, stub };
};

test("plan in full mode asks for a command outside the read-only list and offers no prefix grant", async () => {
  const { outcome, requests, stub } = await gate("plan", "full", "npm install left-pad");
  assert.equal(outcome.kind, "run");
  assert.equal(requests.length, 1);
  assert.equal(stub.calls.length, 0);
  const request = requests[0];
  assert.ok(request?.kind === "command");
  assert.equal(request.grant_prefix, null);
  assert.equal(request.plan, true);
  assert.equal(request.plan_rule, true);
  assert.equal(request.review, null);
  assert.equal(full_mode_covers(request), false);
  const recorded = human_decision(request, { approved: true, grant: "prefix", feedback: "" }, main_review_actor, null);
  assert.deepEqual(prefix_grants([recorded], "powershell"), []);
});

test("plan in full mode runs a read-only command without asking", async () => {
  const { outcome, requests } = await gate("plan", "full", "git status");
  assert.deepEqual(outcome, { kind: "run", note: null });
  assert.equal(requests.length, 0);
});

test("in auto mode a read-only plan command needs a classifier allow, a writing one is a review even on allow", async () => {
  const read = await gate("plan", "auto", "git status");
  assert.deepEqual(read.outcome, { kind: "run", note: null });
  assert.equal(read.stub.calls.length, 1);
  const read_review = await gate("plan", "auto", "git status", [], { approved: false, grant: "once", feedback: "" }, [answer("review")]);
  assert.equal(read_review.requests.length, 1);
  const writing = await gate("plan", "auto", "New-Item notes.txt");
  assert.equal(writing.requests.length, 1);
  const request = writing.requests[0];
  assert.ok(request?.kind === "command");
  assert.deepEqual(request.review?.raised_by, ["plan"]);
  assert.equal(request.plan_rule, undefined);
  assert.equal(request.grant_prefix, null);
  const asked = await gate("plan", "ask", "New-Item notes.txt");
  assert.ok(asked.requests[0]?.kind === "command" && asked.requests[0].plan && asked.requests[0].plan_rule === undefined);
});

test("plan ignores an earlier prefix grant for a changing command", async () => {
  const granted = await gate("plan", "auto", "npm install left-pad", [grant_for("npm install", "npm install lodash")], undefined, [answer("review")]);
  assert.equal(granted.requests.length, 1);
  assert.equal(granted.requests[0]?.kind === "command" && granted.requests[0].grant_prefix, null);
  const denied = await gate("plan", "full", "git checkout main", [], { approved: false, grant: "once", feedback: "" });
  assert.equal(denied.outcome.kind, "denied");
});

test("main keeps full mode, and a prefix grant turns a model review into a run", async () => {
  const full = await gate("main", "full", "npm install left-pad");
  assert.deepEqual(full.outcome, { kind: "run", note: null });
  assert.equal(full.requests.length, 0);
  const granted = await gate("main", "auto", "npm install left-pad", [grant_for("npm install", "npm install lodash")], undefined, [answer("review")]);
  assert.deepEqual(granted.outcome, { kind: "run", note: null });
  assert.equal(granted.requests.length, 0);
  assert.equal(granted.stub.records[0]?.granted, true);
});
