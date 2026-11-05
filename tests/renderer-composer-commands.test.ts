import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMeta } from "../shared/chat.ts";
import type { ModelEntry } from "../shared/models.ts";
import { command_row, type CommandContext, type CommandIcon, type ComposerCommand } from "../src/features/composer/command-menu.ts";
import { auto_compact_options, chosen_hint, command_options, context_limit_options } from "../src/features/composer/context-options.ts";
import { translate, type Translate } from "../src/i18n/translate.ts";
import { css_block, declarations, read } from "./css-kit.ts";

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

const registry = read("features/composer/command-registry.ts");

const entry = (id: string) => {
  const start = registry.indexOf(`id: "${id}",`);
  assert.ok(start >= 0, id);
  const end = registry.indexOf("\n  },", start);
  return registry.slice(start, end);
};

test("the slash menu lists the commands in the agreed order", () => {
  const ids = [...registry.matchAll(/^ {4}id: "(\w+)",$/gm)].map((match) => match[1]);
  assert.deepEqual(ids, ["context", "compact", "auto_compact", "context_limit", "archive", "pin", "fork", "memories", "hooks", "init", "git_init", "review", "plan", "pro", "fast", "ultrafast", "flex", "visualize"]);
});

test("every command shows an icon, and only commands with a value or a serving note keep a hint", () => {
  for (const id of ["context", "compact", "auto_compact", "context_limit", "archive", "pin", "fork", "memories", "hooks", "init", "git_init", "review", "plan", "pro", "fast", "ultrafast", "flex", "visualize"]) {
    assert.match(entry(id), /icon: /, id);
  }
  for (const id of ["context", "compact", "auto_compact", "context_limit", "review", "pro", "fast", "ultrafast", "flex"]) {
    assert.match(entry(id), /hint: /, id);
  }
  for (const id of ["archive", "pin", "fork", "memories", "hooks", "init", "git_init", "plan", "visualize"]) {
    assert.doesNotMatch(entry(id), /hint: /, id);
  }
  assert.match(entry("context"), /hint: \(\{ t, usage_percent \}\) => \(usage_percent === null \? null : t\("commands\.context_used"/);
  assert.match(entry("compact"), /hint: \(\{ t, usage_percent \}\) => \(usage_percent === null \? null : t\("commands\.compact_hint"/);
});

test("each command reaches the action its batch exported", () => {
  assert.match(entry("auto_compact"), /needs: "model"/);
  assert.match(entry("auto_compact"), /set_auto_compact\(model, option\.percent\)/);
  assert.match(entry("context_limit"), /needs: "model"/);
  assert.match(entry("context_limit"), /set_context_limit\(model, option\.limit\)/);
  assert.match(entry("archive"), /set_chat_archived\(chat_id, !chat\.archived\)/);
  assert.match(entry("archive"), /busy && !chat\.archived \? t\("commands\.turn_running"\)/);
  assert.match(entry("archive"), /chat\?\.archived \? ArchiveRestoreIcon : ArchiveIcon/);
  assert.match(entry("pin"), /set_chat_pinned\(chat_id, !chat\.pinned\)/);
  assert.match(entry("pin"), /blocked: \(\{ t, chat \}\) => \(chat\.archived \? t\("commands\.pin_archived"\) : null\)/);
  assert.match(entry("memories"), /needs: "none"/);
  assert.match(entry("memories"), /open_panel\(draft_key, "memories"\)/);
  assert.match(entry("hooks"), /needs: "none"/);
  assert.match(entry("hooks"), /open_settings\("hooks"\)/);
  assert.match(entry("context"), /needs: "none"/);
  assert.match(entry("context"), /open_panel\(draft_key, "context"\)/);
  assert.match(entry("init"), /needs: "project"/);
  assert.match(entry("init"), /run: \(\{ chat_id, project_path \}\) => start_command_turn\(chat_id, project_path, "init"\)/);
  assert.match(entry("git_init"), /needs: "project"/);
  assert.match(entry("git_init"), /run: \(\{ chat_id, project_path \}\) => start_command_turn\(chat_id, project_path, "git_init"\)/);
  assert.match(entry("review"), /needs: "project"/);
  assert.match(entry("review"), /icon: \(\) => FileSearchIcon/);
  assert.match(entry("review"), /run: \(\{ chat_id, project_path \}\) => start_command_turn\(chat_id, project_path, "review"\)/);
});

test("the Review command strings exist in English and German", () => {
  assert.equal(t("commands.review"), "Review");
  assert.equal(de("commands.review"), "Review");
  assert.equal(t("commands.review_hint"), "Current changes, or /review 123 for a pull request");
  assert.equal(de("commands.review_hint"), "Aktuelle Änderungen, oder /review 123 für einen Pull Request");
});

test("the composer checks a typed /review before it sends the draft as a message", () => {
  const composer = read("features/composer/Composer.tsx");
  const send = composer.slice(composer.indexOf("const send = () => {"), composer.indexOf("const on_key_down"));
  assert.match(send, /const review = parse_review_command\(draft\.text\);\s+if \(review !== null && start_typed_review\(context, review\.pr\)\) \{\s+return;\s+\}\s+if \(sendable\)/);
});

test("the composer hands the current model and its context setting to the commands", () => {
  const composer = read("features/composer/Composer.tsx");
  assert.match(composer, /use_command_context\(\{[^}]*\bmodel,\s*model_context: context_setting,/);
});

test("the blur plate behind the dock stack grows with the lifted cards while a menu is open", () => {
  const css = read("features/composer/ComposerPopover.css");
  const grown = declarations(css_block(css, '.composer-slot[data-placement="docked"]:has(> .composer > .composer-popover[data-state="open"])::before {'));
  assert.equal(grown.top, "calc(-1 * var(--composer-popover-lift, 0px))");
  const plate = declarations(css_block(css, '.composer-slot[data-placement="docked"]::before {'));
  assert.equal(plate.transition, "top var(--duration-slow) var(--ease-out)");
});

test("the new command strings exist in English and German", () => {
  const keys = [
    "commands.no_model",
    "commands.model_value",
    "commands.pin_archived",
    "commands.archive",
    "commands.unarchive",
    "commands.init",
    "commands.git_init",
    "commands.needs_project",
  ] as const;
  for (const key of keys) {
    assert.notEqual(t(key), key, key);
    assert.notEqual(de(key), key, key);
    assert.notEqual(de(key), t(key), key);
  }
});
