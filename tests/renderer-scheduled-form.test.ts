import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog, ModelEntry } from "../shared/models.ts";
import type { ScheduledTaskView } from "../shared/scheduled.ts";
import type { ProjectEntry } from "../shared/settings.ts";
import { form_input, form_ready, initial_form, with_choice_change, type FormDefaults } from "../src/features/scheduled/scheduled-form.ts";

const model = (id: string, efforts: string[], default_effort: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({
  id,
  label: id,
  provider: "test",
  provider_order: [],
  efforts,
  default_effort,
  vision: false,
  context_length: 100_000,
  max_output: 8_000,
  reasoning_passback: false,
  ...extra,
});

const catalog: ModelCatalog = {
  models: [model("openai/gpt-sol", ["low", "medium", "high"], "medium", { pro: { id: "openai/gpt-sol-pro", label: "Sol Pro" } }), model("google/flash", [], "")],
  side: { title: "", overseer: "", vision: "", memory: "", reasoning_status: "", transcription: "", git_text: "" },
  side_models: [],
  image_models: [],
};

const projects: ProjectEntry[] = [{ path: "D:\\work\\VantheaX", name: "VantheaX", pinned: false, folder_id: "f1" }];

const defaults = (overrides: Partial<FormDefaults["settings"]> = {}, project_path = "d:/work/vantheax/"): FormDefaults => ({
  settings: { model: "openai/gpt-sol", effort: "high", mode: "auto", projects, ...overrides },
  catalog,
  project_path,
});

const task: ScheduledTaskView = {
  id: "task_1",
  chat_id: "chat_1",
  prompt: "Check how hot it gets across Africa today.",
  interval: "2h",
  enabled: false,
  choice: { model: "openai/gpt-sol", effort: "low", pro: true, tier: "flex" },
  mode: "full",
  created_at: "2026-11-04T08:00:00.000Z",
  updated_at: "2026-11-04T08:00:00.000Z",
  next_run_at: "2026-11-04T10:00:00.000Z",
  last_run: null,
  runs: [],
  name: "Africa heat watch",
  project_path: "",
  running: false,
};

test("a new task starts empty, every hour, on the default model and effort, the global mode and the open project", () => {
  const form = initial_form(null, defaults());
  assert.deepEqual(form, {
    name: "",
    prompt: "",
    interval: "1h",
    choice: { model: "openai/gpt-sol", effort: "high", pro: false },
    mode: "auto",
    project_path: "D:\\work\\VantheaX",
  });
});

test("a default effort the model does not offer falls back to the model's own default, and an unknown model to the first catalog model", () => {
  assert.deepEqual(initial_form(null, defaults({ effort: "xhigh" })).choice, { model: "openai/gpt-sol", effort: "medium", pro: false });
  assert.deepEqual(initial_form(null, defaults({ model: "gone/model" })).choice, { model: "openai/gpt-sol", effort: "high", pro: false });
  assert.deepEqual(initial_form(null, defaults({ model: "openai/gpt-sol-pro" })).choice, { model: "openai/gpt-sol", effort: "high", pro: false });
});

test("the open project is the default only when it is one of the projects, otherwise the task starts loose", () => {
  assert.equal(initial_form(null, defaults({}, "D:\\elsewhere")).project_path, "");
  assert.equal(initial_form(null, defaults({}, "")).project_path, "");
});

test("editing fills the form from the task, Pro and Flex included", () => {
  const form = initial_form(task, defaults());
  assert.deepEqual(form, {
    name: "Africa heat watch",
    prompt: task.prompt,
    interval: "2h",
    choice: task.choice,
    mode: "full",
    project_path: "",
  });
});

test("editing maps the chat's project path onto the listed project", () => {
  assert.equal(initial_form({ ...task, project_path: "d:/work/vantheax" }, defaults()).project_path, "D:\\work\\VantheaX");
  assert.equal(initial_form({ ...task, project_path: "D:\\gone" }, defaults()).project_path, "D:\\gone");
});

test("Pro and Flex stay while the model stays and drop when another model is picked", () => {
  const current = task.choice;
  assert.deepEqual(with_choice_change(current, { ...current, effort: "high" }), { model: "openai/gpt-sol", effort: "high", pro: true, tier: "flex" });
  assert.deepEqual(with_choice_change(current, { ...current, model: "google/flash", effort: "" }), { model: "google/flash", effort: "", pro: false });
});

test("the form is ready only with a name and a prompt that are not blank", () => {
  const form = initial_form(null, defaults());
  assert.equal(form_ready(form), false);
  assert.equal(form_ready({ ...form, name: "Heat", prompt: "   " }), false);
  assert.equal(form_ready({ ...form, name: "  ", prompt: "Check" }), false);
  assert.equal(form_ready({ ...form, name: "Heat", prompt: "Check" }), true);
});

test("the saved input trims name and prompt and carries the enabled state it is given", () => {
  const form = { ...initial_form(task, defaults()), name: "  Heat  ", prompt: "\n Check the heat \n" };
  assert.deepEqual(form_input(form, task.enabled), {
    name: "Heat",
    prompt: "Check the heat",
    interval: "2h",
    enabled: false,
    choice: task.choice,
    mode: "full",
    project_path: "",
  });
  assert.equal(form_input(initial_form(null, defaults()), true).enabled, true);
});
