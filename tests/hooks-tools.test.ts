import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { full_mode_covers, type ApprovalDecision, type ApprovalRequest } from "../shared/approval.ts";
import type { HookFields } from "../shared/hooks.ts";
import { create_chat } from "../electron/chats/store.ts";
import { open_chat_window, resolve_decision, wait_for_decision } from "../electron/permissions/approvals.ts";
import { close_full_window } from "../electron/permissions/full-window.ts";
import { add_project, get_settings } from "../electron/settings/store.ts";
import { delete_hook_tool } from "../electron/tools/hooks/delete.ts";
import { list_hooks_tool } from "../electron/tools/hooks/list.ts";
import { save_hook_tool } from "../electron/tools/hooks/save.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { hook, set_hooks, start_chats, start_settings, temp_root } from "./hooks-kit.ts";
import { review_stub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let root = "";
let project = "";
let other = "";
let project_chat = "";
let loose_chat = "";

const reviewer = review_stub();

before(async () => {
  root = await temp_root("tools");
  project = path.join(root, "project");
  other = path.join(root, "other");
  await fs.mkdir(project);
  await fs.mkdir(other);
  await start_settings(root);
  await start_chats(root);
  await add_project(project, "folder-project");
  await add_project(other, "folder-other");
  project_chat = (await create_chat(project)).id;
  loose_chat = (await create_chat("")).id;
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Asked = Extract<ApprovalRequest, { kind: "hook" }>;

const context = (chat_id: string, answer: ApprovalDecision) => {
  const asked: ApprovalRequest[] = [];
  const ctx: ToolContext = {
    chat_id,
    turn_id: "turn-1",
    call_id: "c0_0",
    project_root: project,
    user_request: "set up hooks",
    mode: "ask",
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: get_settings(),
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async (request) => {
      asked.push(request);
      return answer;
    },
    side_model: async () => "",
    review: reviewer,
    message_main: null,
    send_peer: null,
    context: () => ({ used: 0, limit: 1, compact_at: null }),
  };
  return { ctx, asked };
};

const yes: ApprovalDecision = { approved: true, grant: "once", feedback: "" };

const no: ApprovalDecision = { approved: false, grant: "once", feedback: "not this one" };

const only_hook = (asked: ApprovalRequest[]): Asked => {
  assert.equal(asked.length, 1);
  const request = asked[0];
  assert.equal(request?.kind, "hook");
  return request as Asked;
};

test("creating a hook in ask mode asks once and saves only after the approval", async () => {
  await set_hooks({ global: [], projects: {} });
  const { ctx, asked } = context(project_chat, yes);
  const result = await save_hook_tool.execute(ctx, { scope: "project", event: "PreToolUse", matcher: "run_command", shell: "powershell", command: "exit 0" });
  const request = only_hook(asked);
  assert.equal(request.action, "create");
  assert.deepEqual(request.scope, { kind: "project", path: project, name: "project" });
  assert.equal(request.hook.timeout_s, 60);
  assert.equal(request.previous, null);
  assert.equal(result.status, "done");
  const stored = get_settings().hooks.projects[project] ?? [];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.command, "exit 0");
  assert.equal(result.view?.kind === "hooks" && result.view.action, "create");
});

test("changing, turning off, turning on and deleting each ask with the right action", async () => {
  const existing = hook({ id: "change-me", event: "Stop", command: "Write-Output one" });
  await set_hooks({ global: [existing], projects: {} });
  const changed = context(project_chat, yes);
  const result = await save_hook_tool.execute(changed.ctx, { id: "change-me", command: "Write-Output two" });
  const change = only_hook(changed.asked);
  assert.equal(change.action, "change");
  assert.equal(change.previous?.command, "Write-Output one");
  assert.equal(change.hook.command, "Write-Output two");
  assert.equal(result.view?.kind === "hooks" ? result.view.previous?.command : "", "Write-Output one");
  assert.equal(get_settings().hooks.global[0]?.command, "Write-Output two");

  const off = context(project_chat, yes);
  await save_hook_tool.execute(off.ctx, { id: "change-me", enabled: false });
  assert.equal(only_hook(off.asked).action, "disable");
  assert.equal(get_settings().hooks.global[0]?.enabled, false);

  const on = context(project_chat, yes);
  await save_hook_tool.execute(on.ctx, { id: "change-me", enabled: true });
  assert.equal(only_hook(on.asked).action, "enable");
  assert.equal(get_settings().hooks.global[0]?.enabled, true);

  const removed = context(project_chat, yes);
  const deleted = await delete_hook_tool.execute(removed.ctx, { id: "change-me" });
  assert.equal(only_hook(removed.asked).action, "delete");
  assert.equal(deleted.status, "done");
  assert.deepEqual(get_settings().hooks.global, []);
});

test("a declined change leaves the settings as they were", async () => {
  const existing = hook({ id: "keep-me", command: "exit 0" });
  await set_hooks({ global: [existing], projects: {} });
  const before_change = JSON.stringify(get_settings().hooks);
  const changed = context(project_chat, no);
  const result = await save_hook_tool.execute(changed.ctx, { id: "keep-me", command: "exit 2" });
  assert.equal(result.status, "denied");
  assert.match(result.text, /The user declined this hook change\. Nothing was changed\. User feedback: not this one/);
  const created = context(project_chat, no);
  assert.equal((await save_hook_tool.execute(created.ctx, { scope: "global", event: "Stop", shell: "bash", command: "true" })).status, "denied");
  const removed = context(project_chat, no);
  assert.equal((await delete_hook_tool.execute(removed.ctx, { id: "keep-me" })).status, "denied");
  assert.equal(JSON.stringify(get_settings().hooks), before_change);
});

test("Full mode and the open 10-minute window never settle a hook card", async () => {
  const fields: HookFields = { event: "PreToolUse", matcher: "", shell: "powershell", command: "exit 0", timeout_s: 60, enabled: true };
  const request: ApprovalRequest = { kind: "hook", action: "create", scope: { kind: "global" }, hook: fields, previous: null };
  assert.equal(full_mode_covers(request), false);
  const controller = new AbortController();
  open_chat_window(project_chat);
  let settled = false;
  const waiting = wait_for_decision({ key: project_chat, chat_id: project_chat, call_id: "wait-1", request, signal: controller.signal }).then((decision) => {
    settled = true;
    return decision;
  });
  open_chat_window(project_chat);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(settled, false);
  assert.equal(resolve_decision(project_chat, "wait-1", yes), true);
  assert.deepEqual(await waiting, yes);
  close_full_window(project_chat);
});

test("list_hooks asks nothing and lists only the chat's own scopes", async () => {
  await set_hooks({
    global: [hook({ id: "global-1", event: "Stop", command: "Write-Output global" })],
    projects: { [project]: [hook({ id: "mine", command: "Write-Output mine" })], [other]: [hook({ id: "theirs", command: "Write-Output theirs" })] },
  });
  const { ctx, asked } = context(project_chat, yes);
  const result = await list_hooks_tool.execute(ctx, {});
  assert.equal(asked.length, 0);
  assert.equal(result.status, "done");
  assert.match(result.text, /global-1 Stop/);
  assert.match(result.text, /mine PreToolUse/);
  assert.doesNotMatch(result.text, /theirs/);
  assert.deepEqual(result.view?.kind === "hooks" ? result.view.hooks.map((entry) => entry.id) : [], ["global-1", "mine"]);
  const changed = context(project_chat, yes);
  assert.equal((await save_hook_tool.execute(changed.ctx, { id: "theirs", enabled: false })).status, "failed");
  assert.equal(changed.asked.length, 0);
});

test("project scope in a chat without project fails before any card", async () => {
  const { ctx, asked } = context(loose_chat, yes);
  const result = await save_hook_tool.execute(ctx, { scope: "project", event: "Stop", shell: "powershell", command: "exit 0" });
  assert.equal(result.status, "failed");
  assert.equal(result.text, "This chat has no project; use scope global.");
  assert.equal(asked.length, 0);
});

test("identical fields are done without a card and invalid fields fail without one", async () => {
  await set_hooks({ global: [hook({ id: "same", event: "Stop", command: "exit 0" })], projects: {} });
  const same = context(project_chat, yes);
  const result = await save_hook_tool.execute(same.ctx, { id: "same", command: "exit 0", enabled: true });
  assert.equal(result.status, "done");
  assert.match(result.text, /already has these values/);
  assert.equal(same.asked.length, 0);
  const invalid = context(project_chat, yes);
  const bad = await save_hook_tool.execute(invalid.ctx, { scope: "global", event: "PreToolUse", matcher: "(", shell: "powershell", command: "exit 0" });
  assert.equal(bad.status, "failed");
  assert.match(bad.text, /matcher is not a valid pattern/);
  assert.equal(invalid.asked.length, 0);
});

test("the review model is never asked about hook changes", () => {
  assert.equal(reviewer.calls.length, 0);
});
