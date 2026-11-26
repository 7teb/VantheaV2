import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { command_row, type CommandContext, type CommandIcon, type ComposerCommand } from "../src/features/composer/command-menu.ts";
import { auto_compact_options, chosen_hint, command_options, context_limit_options } from "../src/features/composer/context-options.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";

const t: Translate = (key, vars) => translate("en", key, vars);

const de: Translate = (key, vars) => translate("de", key, vars);

const icon: CommandIcon = () => null;

const model: ModelEntry = {
  id: "vendor/model",
  label: "Model",
  provider: "p",
  provider_order: [],
  efforts: [],
  default_effort: "",
  vision: false,
  context_length: 200_000,
  max_output: 4096,
  reasoning_passback: false,
};

const chat: ChatMeta = {
  id: "c1",
  title: "Chat",
  project_path: "D:\\p",
  workspace: "",
  pinned: false,
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
  message_count: 2,
  streaming: false,
};

const context = (patch: Partial<CommandContext> = {}): CommandContext => ({
  chat_id: "c1",
  project_path: "D:\\p",
  draft_key: "c1",
  chat,
  last_message_id: "m2",
  busy: false,
  compacting: false,
  plan: false,
  visualize: false,
  usage_percent: 40,
  model,
  model_context: undefined,
  pro: false,
  pro_locked: false,
  tier: null,
  t,
  report: () => {},
  ...patch,
});

const applied: string[] = [];

const auto_compact: ComposerCommand = {
  id: "auto_compact",
  needs: "model",
  icon: () => icon,
  label: () => "Auto-compact",
  hint: ({ model: entry, model_context }) => chosen_hint(t, entry, auto_compact_options(t, entry, model_context)),
  options: ({ model: entry, model_context }) =>
    command_options(auto_compact_options(t, entry, model_context), async (option) => void applied.push(`${entry.id}:${option.percent}`)),
};

test("a model command is blocked with a reason while no model is selected", () => {
  const blocked = command_row(auto_compact, context({ model: null }));
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.hint, "No model selected");
  assert.equal(blocked.options, null);
  assert.equal(command_row(auto_compact, context({ model: null, t: de })).hint, "Kein Modell gewählt");
});

test("a model command works without a chat and while a turn runs", () => {
  for (const ctx of [context({ chat_id: null, chat: null }), context({ busy: true })]) {
    const row = command_row(auto_compact, ctx);
    assert.equal(row.disabled, false);
    assert.equal(row.hint, "70% for Model");
    assert.notEqual(row.options, null);
  }
});

const project_runs: (string | null)[] = [];

const project_command: ComposerCommand = {
  id: "init",
  needs: "project",
  icon: () => icon,
  label: () => "Initialize",
  hint: () => "Create or update AGENTS.md",
  run: ({ chat_id }) => void project_runs.push(chat_id),
};

test("a project command runs in a fresh project chat that has no chat id yet", async () => {
  const row = command_row(project_command, context({ chat_id: null, chat: null, last_message_id: null }));
  assert.equal(row.disabled, false);
  assert.equal(row.hint, "Create or update AGENTS.md");
  await row.run?.();
  assert.deepEqual(project_runs.splice(0), [null]);
});

test("a project command is blocked with Needs a project when the chat or the fresh draft has no project", () => {
  for (const ctx of [context({ chat_id: null, chat: null, project_path: "" }), context({ chat: { ...chat, project_path: "" }, project_path: "" })]) {
    const row = command_row(project_command, ctx);
    assert.equal(row.disabled, true);
    assert.equal(row.hint, "Needs a project");
    assert.equal(row.run, null);
    assert.equal(command_row(project_command, { ...ctx, t: de }).hint, "Braucht ein Projekt");
  }
  assert.equal(command_row(project_command, context({ chat: { ...chat, project_path: "" }, project_path: "D:\\p" })).hint, "Needs a project");
});

test("a project command waits while a turn runs in the chat", () => {
  const row = command_row(project_command, context({ busy: true }));
  assert.equal(row.disabled, true);
  assert.equal(row.hint, "Turn running");
});

test("choosing an option applies its value to the current model and marks the current one", async () => {
  const options = command_row(auto_compact, context({ model_context: { limit: null, compact_percent: 80 } })).options?.() ?? [];
  assert.deepEqual(
    options.filter((option) => option.checked).map((option) => option.id),
    ["compact:80"],
  );
  assert.equal(options.find((option) => option.id === "compact:50")?.hint, "at 100k tokens");
  await options.find((option) => option.id === "compact:90")?.run();
  assert.deepEqual(applied.splice(0), ["vendor/model:90"]);
});

test("the row hint names the current value and the model it belongs to", () => {
  assert.equal(chosen_hint(t, model, auto_compact_options(t, model, { limit: null, compact_percent: 60 })), "60% for Model");
  assert.equal(chosen_hint(t, model, context_limit_options(t, model, undefined)), "Model maximum for Model");
  assert.equal(chosen_hint(t, model, context_limit_options(t, model, { limit: 128_000, compact_percent: 70 })), "128k tokens for Model");
  assert.equal(chosen_hint(de, model, auto_compact_options(de, model, undefined)), "70 % für Model");
  assert.equal(chosen_hint(t, model, []), null);
});

test("limit options carry null for the model maximum and the preset value otherwise", async () => {
  const limits: (number | null)[] = [];
  const options = command_options(context_limit_options(t, model, { limit: 64_000, compact_percent: 70 }), async (option) => void limits.push(option.limit));
  assert.deepEqual(
    options.map((option) => [option.id, option.checked]),
    [
      ["limit:max", false],
      ["limit:128000", false],
      ["limit:64000", true],
      ["limit:32000", false],
    ],
  );
  assert.equal(options[0].hint, "200k tokens");
  await options[0].run();
  await options[1].run();
  assert.deepEqual(limits, [null, 128_000]);
});
