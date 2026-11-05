import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { ApprovalDecision, ApprovalRequest } from "../shared/approval.ts";
import type { PermissionMode } from "../shared/chat.ts";
import { chat_meta, create_chat, update_meta } from "../electron/chats/store.ts";
import { load_scheduled, scheduled_task, scheduled_tasks } from "../electron/scheduled/store.ts";
import { get_settings, add_project } from "../electron/settings/store.ts";
import { delete_scheduled_task_tool } from "../electron/tools/scheduled/delete.ts";
import { list_scheduled_tasks_tool } from "../electron/tools/scheduled/list.ts";
import { save_scheduled_task_tool } from "../electron/tools/scheduled/save.ts";
import type { ToolContext } from "../electron/tools/types.ts";
import { start_chats, start_settings, temp_root } from "./hooks-kit.ts";
import { answer, review_stub, type ReviewStub } from "./review-stub.ts";
import { tool_model } from "./tool-model.ts";

let root = "";
let project = "";
let project_chat = "";
let loose_chat = "";

const choice = { model: "test/model", effort: "high", pro: true, tier: "flex" as const };

before(async () => {
  root = await temp_root("scheduled-tools");
  project = path.join(root, "project");
  await fs.mkdir(project);
  await start_settings(root);
  await start_chats(root);
  await add_project(project, "folder-project");
  project_chat = (await create_chat(project)).id;
  loose_chat = (await create_chat("")).id;
  await update_meta(project_chat, { choice });
  await update_meta(loose_chat, { choice: { model: "test/model", effort: "low", pro: false } });
});

beforeEach(async () => {
  await load_scheduled(path.join(root, `scheduled-${Date.now()}-${Math.random()}.json`));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

type Asked = Extract<ApprovalRequest, { kind: "scheduled_task" }>;

const yes: ApprovalDecision = { approved: true, grant: "once", feedback: "" };

const no: ApprovalDecision = { approved: false, grant: "once", feedback: "not hourly" };

const expired: ApprovalDecision = { approved: false, grant: "once", feedback: "", expired: true };

const context = (chat_id: string, mode: PermissionMode, decision: ApprovalDecision = yes, reviewer: ReviewStub = review_stub()) => {
  const asked: Asked[] = [];
  const ctx: ToolContext = {
    chat_id,
    turn_id: "turn-1",
    call_id: `call-${Math.random()}`,
    project_root: project,
    user_request: "watch the heat in Africa every hour",
    mode,
    profile: "main",
    model: tool_model,
    image_fit: [],
    settings: get_settings(),
    signal: new AbortController().signal,
    progress: () => undefined,
    approve: async (request) => {
      assert.equal(request.kind, "scheduled_task");
      asked.push(request as Asked);
      return decision;
    },
    side_model: async () => "",
    review: reviewer,
    message_main: null,
    send_peer: null,
    context: () => ({ used: 0, limit: 1, compact_at: null }),
  };
  return { ctx, asked, reviewer };
};

const create_args = { name: "Africa heat", prompt: "Check how hot it gets in Africa and report records.", schedule: "1h" };

test("ask mode shows a card and creates the task with the creating chat's model, mode and project only after approval", async () => {
  const { ctx, asked } = context(project_chat, "ask");
  const result = await save_scheduled_task_tool.execute(ctx, create_args);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]?.action, "create");
  assert.deepEqual(asked[0]?.task, { name: "Africa heat", prompt: create_args.prompt, interval: "1h", enabled: true, mode: "ask", model: "test/model", effort: "high", project_path: project });
  assert.equal(result.status, "done");
  const [task] = scheduled_tasks();
  assert.ok(task);
  assert.deepEqual(task.choice, choice);
  assert.equal(task.mode, "ask");
  assert.equal(task.next_run_at, task.created_at);
  assert.equal(chat_meta(task.chat_id)?.title, "Africa heat");
  assert.equal(chat_meta(task.chat_id)?.project_path, project);
  assert.notEqual(task.chat_id, project_chat);
  assert.match(result.text, /^Created scheduled task \S+ "Africa heat" every hour, on, test\/model \(high, Pro, flex\), ask mode, project /);
  assert.equal(result.view?.kind === "scheduled_tasks" ? result.view.action : "", "create");
});

test("a declined or unanswered card creates nothing", async () => {
  const declined = context(project_chat, "ask", no);
  const refused = await save_scheduled_task_tool.execute(declined.ctx, create_args);
  assert.equal(refused.status, "denied");
  assert.match(refused.text, /The user declined this scheduled task change\. Nothing was changed\. User feedback: not hourly Do not set up scheduled tasks another way/);
  const unanswered = context(project_chat, "ask", expired);
  assert.equal((await save_scheduled_task_tool.execute(unanswered.ctx, create_args)).status, "denied");
  assert.deepEqual(scheduled_tasks(), []);
});

test("auto and full mode follow the automatic review", async () => {
  const allowed = context(loose_chat, "auto", yes, review_stub([answer("allow")]));
  assert.equal((await save_scheduled_task_tool.execute(allowed.ctx, create_args)).status, "done");
  assert.equal(allowed.asked.length, 0);
  assert.match(allowed.reviewer.calls[0]?.parts.at(-1)?.text ?? "", /A scheduled task is a prompt VantheaX runs on its own, unattended/);
  const [task] = scheduled_tasks();
  assert.equal(task?.mode, "auto");
  assert.equal(chat_meta(task?.chat_id ?? "")?.project_path, "");

  const denied = context(loose_chat, "full", yes, review_stub([answer("deny", "the user never asked for a schedule")]));
  const refused = await save_scheduled_task_tool.execute(denied.ctx, { ...create_args, name: "Other" });
  assert.equal(refused.status, "denied");
  assert.match(refused.text, /^Denied by the automatic review\. The tool call did not run\.\nReason: the user never asked for a schedule/);
  assert.equal(denied.asked.length, 0);

  const reviewed = context(loose_chat, "full", no, review_stub([answer("review", "unclear schedule")]));
  assert.equal((await save_scheduled_task_tool.execute(reviewed.ctx, { ...create_args, name: "Third" })).status, "denied");
  assert.equal(reviewed.asked.length, 1);
  assert.equal(reviewed.asked[0]?.review?.reason, "unclear schedule");
  assert.equal(scheduled_tasks().length, 1);
});

test("changes rename the chat, toggles report enable and disable, and delete keeps the chat", async () => {
  const created = context(project_chat, "ask");
  await save_scheduled_task_tool.execute(created.ctx, create_args);
  const task = scheduled_tasks()[0];
  assert.ok(task);

  const renamed = context(project_chat, "ask");
  const changed = await save_scheduled_task_tool.execute(renamed.ctx, { id: task.id, name: "Sahel heat", schedule: "24h" });
  assert.equal(renamed.asked[0]?.action, "change");
  assert.equal(renamed.asked[0]?.previous?.name, "Africa heat");
  assert.equal(renamed.asked[0]?.task.interval, "24h");
  assert.equal(changed.status, "done");
  assert.equal(chat_meta(task.chat_id)?.title, "Sahel heat");
  assert.equal(scheduled_task(task.id)?.interval, "24h");

  const off = context(project_chat, "ask");
  await save_scheduled_task_tool.execute(off.ctx, { id: task.id, enabled: false });
  assert.equal(off.asked[0]?.action, "disable");
  assert.equal(scheduled_task(task.id)?.enabled, false);
  const on = context(project_chat, "ask");
  await save_scheduled_task_tool.execute(on.ctx, { id: task.id, enabled: true });
  assert.equal(on.asked[0]?.action, "enable");
  assert.equal(scheduled_task(task.id)?.enabled, true);

  const same = context(project_chat, "ask");
  const unchanged = await save_scheduled_task_tool.execute(same.ctx, { id: task.id, name: "Sahel heat", enabled: true });
  assert.match(unchanged.text, /already has these values/);
  assert.equal(same.asked.length, 0);

  const removed = context(project_chat, "ask");
  const deleted = await delete_scheduled_task_tool.execute(removed.ctx, { id: task.id });
  assert.equal(removed.asked[0]?.action, "delete");
  assert.equal(deleted.status, "done");
  assert.match(deleted.text, /Its chat stays as an ordinary chat/);
  assert.equal(scheduled_task(task.id), null);
  assert.equal(chat_meta(task.chat_id)?.title, "Sahel heat");
});

test("a change cannot set the model, mode or project and unknown ids fail without a card", async () => {
  const { ctx, asked } = context(project_chat, "ask");
  await assert.rejects(async () => save_scheduled_task_tool.execute(ctx, { id: "x", mode: "full" }), /unknown parameter mode/);
  await assert.rejects(async () => save_scheduled_task_tool.execute(ctx, { ...create_args, model: "other/model" }), /unknown parameter model/);
  await assert.rejects(async () => save_scheduled_task_tool.execute(ctx, { ...create_args, schedule: "5m" }), /schedule must be one of 1h, 2h, 24h, 7d/);
  const missing = await save_scheduled_task_tool.execute(ctx, { name: "Only a name" });
  assert.match(missing.text, /^prompt, schedule are required when creating a scheduled task/);
  assert.equal((await save_scheduled_task_tool.execute(ctx, { id: "nope", enabled: false })).status, "failed");
  assert.equal((await delete_scheduled_task_tool.execute(ctx, { id: "nope" })).status, "failed");
  assert.equal(asked.length, 0);
});

test("list_scheduled_tasks lists every task without asking", async () => {
  const empty = await list_scheduled_tasks_tool.execute(context(loose_chat, "ask").ctx, {});
  assert.equal(empty.text, "There are no scheduled tasks.");
  await save_scheduled_task_tool.execute(context(project_chat, "ask").ctx, create_args);
  const { ctx, asked } = context(loose_chat, "ask");
  const listed = await list_scheduled_tasks_tool.execute(ctx, {});
  assert.equal(asked.length, 0);
  assert.match(listed.text, /^1 scheduled task \(id "name" schedule/);
  assert.match(listed.text, /"Africa heat" every hour, on, test\/model \(high, Pro, flex\), ask mode, project .+, next run \d{4}-\d{2}-\d{2} \d{2}:\d{2}, last run not run yet/);
  assert.equal(listed.view?.kind === "scheduled_tasks" ? listed.view.tasks.length : 0, 1);
});
