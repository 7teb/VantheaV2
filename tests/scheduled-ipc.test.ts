import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ModelCatalog } from "../shared/models.ts";
import { load_scheduled, put_task } from "../electron/scheduled/store.ts";
import { parse_scheduled_input, parse_task_id } from "../electron/scheduled/validate.ts";
import { create_chat } from "../electron/chats/store.ts";
import { add_project } from "../electron/settings/store.ts";
import { start_chats, start_settings, temp_root } from "./hooks-kit.ts";
import { tool_model } from "./tool-model.ts";

let root = "";
let project = "";

const catalog = { models: [tool_model], side: {}, side_models: [], image_models: [] } as unknown as ModelCatalog;

const input = (over: Record<string, unknown> = {}) => ({
  name: "  Africa heat  ",
  prompt: " Check how hot it gets in Africa ",
  interval: "1h",
  enabled: true,
  choice: { model: tool_model.id, effort: "", pro: false },
  mode: "auto",
  project_path: "",
  ...over,
});

before(async () => {
  root = await temp_root("scheduled-ipc");
  project = path.join(root, "project");
  await fs.mkdir(project);
  await start_settings(root);
  await start_chats(root);
  await add_project(project, "folder-project");
  await load_scheduled(path.join(root, "scheduled-tasks.json"));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a valid input is trimmed and keeps its project", () => {
  const parsed = parse_scheduled_input(input({ project_path: project }), catalog);
  assert.equal(parsed.name, "Africa heat");
  assert.equal(parsed.prompt, "Check how hot it gets in Africa");
  assert.equal(parsed.project_path, project);
  assert.deepEqual(parsed.choice, { model: tool_model.id, effort: "", pro: false });
  assert.equal(parse_scheduled_input(input(), catalog).project_path, "");
});

test("every invalid field is refused at the boundary", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ name: "   " }, /task name must not be empty/],
    [{ name: "x".repeat(201) }, /task name is longer than 200 characters/],
    [{ prompt: "" }, /task prompt must not be empty/],
    [{ interval: "5m" }, /task schedule must be one of 1h, 2h, 24h, 7d/],
    [{ choice: { model: "missing/model", effort: "", pro: false } }, /model missing\/model is not in the catalog/],
    [{ choice: { effort: "high" } }, /task model choice needs a model id/],
    [{ project_path: path.join(root, "elsewhere") }, /is not a project in VantheaX/],
    [{ mode: "yolo" }, /task permission mode must be one of ask, auto, full/],
    [{ enabled: "yes" }, /task enabled must be a boolean/],
  ];
  for (const [over, pattern] of cases) {
    assert.throws(() => parse_scheduled_input(input(over), catalog), pattern, JSON.stringify(over));
  }
  assert.throws(() => parse_scheduled_input("task", catalog), /scheduled task must be an object/);
});

test("task ids must name a stored task", async () => {
  const chat = await create_chat("");
  put_task({
    id: "known",
    chat_id: chat.id,
    prompt: "check",
    interval: "1h",
    enabled: true,
    choice: { model: tool_model.id, effort: "", pro: false },
    mode: "ask",
    created_at: "2026-11-04T10:00:00.000Z",
    updated_at: "2026-11-04T10:00:00.000Z",
    next_run_at: "2026-11-04T11:00:00.000Z",
    last_run: null,
    runs: [],
  });
  assert.equal(parse_task_id("known"), "known");
  assert.throws(() => parse_task_id("unknown"), /scheduled task unknown not found/);
  assert.throws(() => parse_task_id(7), /scheduled task id must be a string/);
});
